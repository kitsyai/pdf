import {
  PDFArray,
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFField,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFTextField,
} from "pdf-lib";
import { loadPdf } from "../shared/files";

export type FieldKind = "text" | "checkbox" | "radio" | "dropdown" | "list" | "button" | "signature";

export type FormFieldInfo = {
  name: string;
  kind: FieldKind;
  /** text: string; checkbox: boolean; radio/dropdown: string; list: string[] */
  value: string | boolean | string[];
  options?: string[];
  multiline?: boolean;
  maxLength?: number;
  multiSelect?: boolean;
  /** Dropdowns that accept a typed value as well as the listed options. */
  editable?: boolean;
  readOnly: boolean;
  required: boolean;
  /** 1-based page of the field's first widget, or null if not on a page. */
  page: number | null;
};

export type FormValues = Record<string, string | boolean | string[]>;

function kindOf(field: PDFField): FieldKind {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "list";
  if (field instanceof PDFSignature) return "signature";
  return "button";
}

/** Map each annotation ref to its 1-based page number. */
function widgetPages(doc: PDFDocument) {
  const pages = new Map<string, number>();
  doc.getPages().forEach((page, index) => {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (annots instanceof PDFArray) {
      annots.asArray().forEach((annot) => {
        if (annot instanceof PDFRef) pages.set(annot.toString(), index + 1);
      });
    }
  });
  return pages;
}

function firstWidgetPage(doc: PDFDocument, field: PDFField, pages: Map<string, number>) {
  for (const widget of field.acroField.getWidgets()) {
    const ref = doc.context.getObjectRef(widget.dict);
    const page = ref && pages.get(ref.toString());
    if (page) return page;
  }
  return null;
}

function currentValue(field: PDFField): string | boolean | string[] {
  if (field instanceof PDFTextField) return field.getText() ?? "";
  if (field instanceof PDFCheckBox) return field.isChecked();
  if (field instanceof PDFRadioGroup) return field.getSelected() ?? "";
  if (field instanceof PDFDropdown) return field.getSelected()[0] ?? "";
  if (field instanceof PDFOptionList) return field.getSelected();
  return "";
}

function sameValue(a: string | boolean | string[], b: string | boolean | string[]) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = [a].flat().map(String);
    const right = [b].flat().map(String);
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }
  return a === b;
}

function describe(doc: PDFDocument, field: PDFField, pages: Map<string, number>): FormFieldInfo {
  const info: FormFieldInfo = {
    name: field.getName(),
    kind: kindOf(field),
    readOnly: field.isReadOnly(),
    required: field.isRequired(),
    page: firstWidgetPage(doc, field, pages),
    value: currentValue(field),
  };

  if (field instanceof PDFTextField) {
    info.multiline = field.isMultiline();
    info.maxLength = field.getMaxLength();
  } else if (field instanceof PDFRadioGroup) {
    info.options = field.getOptions();
  } else if (field instanceof PDFDropdown) {
    info.options = field.getOptions();
    info.editable = field.isEditable();
  } else if (field instanceof PDFOptionList) {
    info.options = field.getOptions();
    info.multiSelect = field.isMultiselect();
  }
  return info;
}

export async function readFormFields(bytes: ArrayBuffer | Uint8Array) {
  const doc = await loadPdf(bytes, { updateMetadata: false });
  const form = doc.getForm();
  const pages = widgetPages(doc);
  const hasXfa = form.acroForm.dict.has(PDFName.of("XFA"));
  return {
    fields: form.getFields().map((field) => describe(doc, field, pages)),
    hasXfa,
  };
}

function applyValue(field: PDFField, value: string | boolean | string[]) {
  if (field instanceof PDFTextField) {
    const text = String(value ?? "");
    const max = field.getMaxLength();
    if (max !== undefined && text.length > max) {
      throw new Error(`at most ${max} characters are allowed.`);
    }
    field.setText(text || undefined);
  } else if (field instanceof PDFCheckBox) {
    if (value) field.check();
    else field.uncheck();
  } else if (field instanceof PDFRadioGroup) {
    if (value) field.select(String(value));
    else field.clear();
  } else if (field instanceof PDFDropdown) {
    if (!value) field.clear();
    else if (field.getOptions().includes(String(value)) || field.isEditable()) field.select(String(value));
    else throw new Error(`"${value}" is not one of its options.`);
  } else if (field instanceof PDFOptionList) {
    const selected = (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
    const options = field.getOptions();
    const unknown = selected.find((option) => !options.includes(option));
    if (unknown) throw new Error(`"${unknown}" is not one of its options.`);
    if (selected.length) field.select(selected);
    else field.clear();
  }
}

/**
 * Fill form fields by name. Read-only, button, and signature fields are left
 * alone. With flatten, answers are drawn into the pages and the form removed.
 */
export async function fillForm(
  bytes: ArrayBuffer | Uint8Array,
  values: FormValues,
  { flatten = false }: { flatten?: boolean } = {}
) {
  const doc = await loadPdf(bytes);
  const form = doc.getForm();

  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field || field.isReadOnly()) continue;
    const kind = kindOf(field);
    if (kind === "button" || kind === "signature") continue;
    // Untouched fields keep their existing appearance (font, non-Latin text).
    if (sameValue(currentValue(field), value)) continue;
    try {
      applyValue(field, value);
    } catch (error) {
      throw new Error(`Field "${name}": ${(error as Error).message}`);
    }
  }

  // XFA forms carry a second copy of the form that some viewers prefer; it
  // would hide the values set here.
  form.deleteXFA();

  try {
    if (flatten) form.flatten();
    else form.updateFieldAppearances();
  } catch (error) {
    if (/cannot encode/i.test((error as Error).message || "")) {
      throw new Error(
        "Some answers contain characters the standard PDF font cannot draw. Use basic Latin letters, numbers, and punctuation."
      );
    }
    throw error;
  }

  if (flatten) dropDeletedAnnotations(doc);
  return doc.save();
}

/**
 * pdf-lib's flatten() deletes widget objects but can leave their refs in each
 * page's /Annots, which would point at nothing in the saved file.
 */
function dropDeletedAnnotations(doc: PDFDocument) {
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    const kept = annots
      .asArray()
      .filter((annot) => !(annot instanceof PDFRef) || doc.context.lookup(annot) !== undefined);
    if (kept.length === annots.size()) continue;
    if (kept.length) page.node.set(PDFName.of("Annots"), doc.context.obj(kept));
    else page.node.delete(PDFName.of("Annots"));
  }
}
