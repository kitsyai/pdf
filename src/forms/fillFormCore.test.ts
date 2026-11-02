import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, StandardFonts, decodePDFRawStream } from "pdf-lib";
import { fillForm, readFormFields } from "./fillFormCore";

async function makeForm() {
  const doc = await PDFDocument.create();
  const [first, second] = [doc.addPage([400, 400]), doc.addPage([400, 400])];
  const form = doc.getForm();
  const name = form.createTextField("name");
  name.setText("Old");
  name.addToPage(first, { x: 20, y: 300, width: 200, height: 24 });
  const notes = form.createTextField("notes");
  notes.enableMultiline();
  notes.setMaxLength(20);
  notes.addToPage(second, { x: 20, y: 200, width: 200, height: 60 });
  form.createCheckBox("agree").addToPage(first, { x: 20, y: 250 });
  const plan = form.createRadioGroup("plan");
  plan.addOptionToPage("basic", first, { x: 20, y: 200 });
  plan.addOptionToPage("pro", first, { x: 60, y: 200 });
  const country = form.createDropdown("country");
  country.addOptions(["India", "Japan"]);
  country.addToPage(second, { x: 20, y: 300 });
  const topics = form.createOptionList("topics");
  topics.addOptions(["pdf", "ai", "web"]);
  topics.enableMultiselect();
  topics.addToPage(second, { x: 20, y: 100, height: 60 });
  const locked = form.createTextField("locked");
  locked.setText("Keep");
  locked.enableReadOnly();
  locked.addToPage(second, { x: 250, y: 300 });
  return doc.save();
}

describe("readFormFields", () => {
  it("describes each field with its kind, value, options, and page", async () => {
    const { fields, hasXfa } = await readFormFields(await makeForm());
    expect(hasXfa).toBe(false);
    const byName = Object.fromEntries(fields.map((field) => [field.name, field]));
    expect(byName.name).toMatchObject({ kind: "text", value: "Old", page: 1, multiline: false, readOnly: false });
    expect(byName.notes).toMatchObject({ kind: "text", multiline: true, maxLength: 20, page: 2 });
    expect(byName.agree).toMatchObject({ kind: "checkbox", value: false, page: 1 });
    expect(byName.plan).toMatchObject({ kind: "radio", options: ["basic", "pro"], value: "" });
    expect(byName.country).toMatchObject({ kind: "dropdown", options: ["India", "Japan"], page: 2 });
    expect(byName.topics).toMatchObject({ kind: "list", multiSelect: true, value: [] });
    expect(byName.locked).toMatchObject({ readOnly: true, value: "Keep" });
  });

  it("returns no fields for a PDF without a form", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    expect((await readFormFields(await doc.save())).fields).toEqual([]);
  });
});

describe("fillForm", () => {
  it("fills every kind of field and skips read-only ones", async () => {
    const out = await fillForm(await makeForm(), {
      name: "Jane Doe",
      notes: "Line one\nLine two",
      agree: true,
      plan: "pro",
      country: "Japan",
      topics: ["pdf", "web"],
      locked: "Changed",
      unknownField: "ignored",
    });
    const { fields } = await readFormFields(out);
    const values = Object.fromEntries(fields.map((field) => [field.name, field.value]));
    expect(values).toEqual({
      name: "Jane Doe",
      notes: "Line one\nLine two",
      agree: true,
      plan: "pro",
      country: "Japan",
      topics: ["pdf", "web"],
      locked: "Keep",
    });
  });

  it("clears values when given empty input", async () => {
    const out = await fillForm(await makeForm(), { name: "", agree: false });
    const { fields } = await readFormFields(out);
    expect(fields.find((field) => field.name === "name")?.value).toBe("");
  });

  it("flattens answers into the page and removes the form", async () => {
    const out = await fillForm(await makeForm(), { name: "Jane" }, { flatten: true });
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getFields()).toHaveLength(0);
    for (const page of doc.getPages()) {
      const annots = page.node.lookup(PDFName.of("Annots"));
      const subtypes = annots instanceof PDFArray
        ? annots.asArray().map((ref) => (doc.context.lookup(ref) as PDFDict).lookup(PDFName.of("Subtype"))?.toString())
        : [];
      expect(subtypes).not.toContain("/Widget");
    }
  });

  it("names the field in validation errors", async () => {
    const bytes = await makeForm();
    await expect(fillForm(bytes, { notes: "x".repeat(21) })).rejects.toThrow('Field "notes": at most 20 characters are allowed.');
    await expect(fillForm(bytes, { country: "Peru" })).rejects.toThrow('Field "country": "Peru" is not one of its options.');
    await expect(fillForm(bytes, { name: "नमस्ते" })).rejects.toThrow(/standard PDF font/);
  });
});

/** "name" (blank) plus an untouched field "other" with its own appearance. */
async function formWithStyledField(otherValue: "courier" | "hindi") {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  form.createTextField("name").addToPage(page, { x: 20, y: 300, width: 200, height: 24 });
  const other = form.createTextField("other");
  other.addToPage(page, { x: 20, y: 250, width: 200, height: 24 });
  if (otherValue === "courier") {
    other.setText("Typed elsewhere");
    other.updateAppearances(await doc.embedFont(StandardFonts.Courier));
  } else {
    // As written by an app with a Unicode font: /V set, appearance already drawn.
    other.acroField.setValue(PDFHexString.fromText("नमस्ते"));
  }
  return doc.save({ updateFieldAppearances: false });
}

function normalAppearance(doc: PDFDocument, name: string) {
  const [widget] = doc.getForm().getTextField(name).acroField.getWidgets();
  const raw = widget.getNormalAppearance();
  const ap = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
  return ap instanceof PDFRawStream
    ? new TextDecoder("latin1").decode(decodePDFRawStream(ap).decode())
    : String(ap);
}

describe("fillForm leaves untouched fields alone", () => {
  it("keeps the original appearance of fields the user did not change", async () => {
    const bytes = await formWithStyledField("courier");
    const before = normalAppearance(await PDFDocument.load(bytes), "other");
    // The UI sends every field, changed or not.
    const { fields } = await readFormFields(bytes);
    const values = Object.fromEntries(fields.map((field) => [field.name, field.value]));
    expect(before).toContain("Courier");
    const out = await fillForm(bytes, { ...values, name: "Jane" });
    expect(normalAppearance(await PDFDocument.load(out), "other")).toBe(before);
  });

  it("saves when an untouched field already holds non-Latin text", async () => {
    const bytes = await formWithStyledField("hindi");
    const { fields } = await readFormFields(bytes);
    const values = Object.fromEntries(fields.map((field) => [field.name, field.value]));
    expect(values.other).toBe("नमस्ते");
    for (const flatten of [false, true]) {
      const out = await fillForm(bytes, { ...values, name: "Jane" }, { flatten });
      expect(out.byteLength).toBeGreaterThan(0);
    }
    const kept = await readFormFields(await fillForm(bytes, { ...values, name: "Jane" }));
    expect(Object.fromEntries(kept.fields.map((field) => [field.name, field.value]))).toEqual({
      name: "Jane",
      other: "नमस्ते",
    });
  });
});
