import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, degrees } from "pdf-lib";
import { organizePdf } from "./organizePdfCore";

async function makePdf(widths: number[], rotations: number[] = []) {
  const doc = await PDFDocument.create();
  widths.forEach((width, index) => {
    const page = doc.addPage([width, 100]);
    if (rotations[index]) page.setRotation(degrees(rotations[index]));
  });
  doc.setTitle("Report");
  return doc.save();
}

async function describePages(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return {
    title: doc.getTitle(),
    pages: doc.getPages().map((page) => [page.getWidth(), page.getRotation().angle]),
  };
}

describe("organizePdf", () => {
  it("reorders, rotates, and drops pages while keeping metadata", async () => {
    const out = await organizePdf(await makePdf([101, 102, 103]), [
      { source: 2 },
      { source: 0, rotation: 90 },
    ]);
    expect(await describePages(out)).toEqual({
      title: "Report",
      pages: [
        [103, 0],
        [101, 90],
      ],
    });
  });

  it("adds to an existing page rotation", async () => {
    const out = await organizePdf(await makePdf([101], [90]), [{ source: 0, rotation: 270 }]);
    expect((await describePages(out)).pages).toEqual([[101, 0]]);
    const back = await organizePdf(await makePdf([101], [90]), [{ source: 0, rotation: -90 }]);
    expect((await describePages(back)).pages).toEqual([[101, 0]]);
  });

  it("validates the page list", async () => {
    const source = await makePdf([101, 102]);
    await expect(organizePdf(source, [])).rejects.toThrow(/at least one page/);
    await expect(organizePdf(source, [{ source: 5 }])).rejects.toThrow(/Page 6 does not exist/);
    await expect(organizePdf(source, [{ source: 0 }, { source: 0 }])).rejects.toThrow(/listed twice/);
  });
});

/** 3 pages; bookmarks: "One" -> p1, "Two" -> p2 (with child "Three" -> p3), "Gone" -> p2. */
async function pdfWithOutlineAndForm() {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([100, 100]), doc.addPage([200, 100]), doc.addPage([300, 100])];
  const context = doc.context;
  const outlines = context.register(context.obj({ Type: "Outlines" }));
  const item = (title: string, page: number) =>
    context.register(context.obj({ Title: title, Parent: outlines, Dest: [pages[page].ref, PDFName.of("Fit")] }));
  const one = item("One", 0);
  const two = item("Two", 1);
  const gone = item("Gone", 1);
  const three = context.register(
    context.obj({ Title: "Three", Parent: two, A: { S: "GoTo", D: [pages[2].ref, PDFName.of("Fit")] } })
  );
  const set = (ref: PDFRef, values: Record<string, unknown>) => {
    const dict = context.lookup(ref) as PDFDict;
    for (const [key, value] of Object.entries(values)) dict.set(PDFName.of(key), value as never);
  };
  set(one, { Next: two });
  set(two, { Prev: one, Next: gone, First: three, Last: three, Count: PDFNumber.of(1) });
  set(gone, { Prev: two });
  set(outlines, { First: one, Last: gone, Count: PDFNumber.of(4) });
  doc.catalog.set(PDFName.of("Outlines"), outlines);

  const form = doc.getForm();
  form.createTextField("onPageTwo").addToPage(pages[1], { x: 10, y: 10 });
  form.createCheckBox("onPageOne").addToPage(pages[0], { x: 10, y: 10 });
  const radio = form.createRadioGroup("split");
  radio.addOptionToPage("a", pages[0], { x: 10, y: 50 });
  radio.addOptionToPage("b", pages[1], { x: 10, y: 50 });
  return doc.save();
}

function outlineTitles(doc: PDFDocument) {
  const walk = (parent: PDFDict): unknown[] => {
    const out: unknown[] = [];
    let ref = parent.get(PDFName.of("First"));
    while (ref instanceof PDFRef) {
      const item = doc.context.lookup(ref) as PDFDict;
      const title = item.lookup(PDFName.of("Title"))?.toString().replace(/^\/|[()]/g, "");
      const children = walk(item);
      const linked = Boolean(item.get(PDFName.of("Dest")) || item.get(PDFName.of("A")));
      out.push(children.length ? [title, linked, children] : [title, linked]);
      ref = item.get(PDFName.of("Next"));
    }
    return out;
  };
  return walk(doc.catalog.lookup(PDFName.of("Outlines")) as PDFDict);
}

describe("organizePdf clean-up after deleting pages", () => {
  it("removes bookmarks to deleted pages and keeps headings with surviving children", async () => {
    const out = await organizePdf(await pdfWithOutlineAndForm(), [{ source: 0 }, { source: 2 }]);
    const doc = await PDFDocument.load(out);
    expect(outlineTitles(doc)).toEqual([
      ["One", true],
      ["Two", false, [["Three", true]]],
    ]);
    const root = doc.catalog.lookup(PDFName.of("Outlines")) as PDFDict;
    expect(root.lookup(PDFName.of("Count"))?.toString()).toBe("3");
  });

  it("removes form fields and widgets that only lived on deleted pages", async () => {
    const out = await organizePdf(await pdfWithOutlineAndForm(), [{ source: 0 }, { source: 2 }]);
    const doc = await PDFDocument.load(out);
    const fields = doc.getForm().getFields();
    expect(fields.map((field) => field.getName()).sort()).toEqual(["onPageOne", "split"]);
    const radio = doc.getForm().getRadioGroup("split");
    expect((radio.acroField.dict.lookup(PDFName.of("Kids")) as PDFArray).size()).toBe(1);
  });

  it("leaves bookmarks and fields alone when no page is deleted", async () => {
    const out = await organizePdf(await pdfWithOutlineAndForm(), [{ source: 2 }, { source: 1 }, { source: 0 }]);
    const doc = await PDFDocument.load(out);
    expect(outlineTitles(doc)).toEqual([
      ["One", true],
      ["Two", true, [["Three", true]]],
      ["Gone", true],
    ]);
    expect(doc.getForm().getFields()).toHaveLength(3);
  });
});
