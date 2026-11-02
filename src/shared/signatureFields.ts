import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString, PDFHexString } from "pdf-lib";

const N = (name: string) => PDFName.of(name);

export type SignatureField = {
  /** Fully qualified field name, e.g. "Signature1". */
  name: string;
  field: PDFDict;
  /** The signature dictionary (/V), when the field has been signed. */
  value: PDFDict | null;
};

function text(value: unknown) {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : "";
}

/** Every signature field in the AcroForm tree (FT is inheritable). */
export function signatureFields(doc: PDFDocument): SignatureField[] {
  const acroForm = doc.catalog.lookup(N("AcroForm"));
  const fields = acroForm instanceof PDFDict ? acroForm.lookup(N("Fields")) : null;
  if (!(fields instanceof PDFArray)) return [];

  const found: SignatureField[] = [];
  const seen = new Set<string>();
  const walk = (ref: unknown, parentName: string, inheritedType: unknown) => {
    if (ref instanceof PDFRef) {
      if (seen.has(ref.toString())) return;
      seen.add(ref.toString());
    }
    const field = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (!(field instanceof PDFDict)) return;
    const partial = text(field.lookup(N("T")));
    const name = [parentName, partial].filter(Boolean).join(".");
    const type = field.lookup(N("FT")) ?? inheritedType;
    const kids = field.lookup(N("Kids"));
    const kidFields = kids instanceof PDFArray
      ? kids.asArray().filter((kid) => {
          const dict = kid instanceof PDFRef ? doc.context.lookup(kid) : kid;
          return dict instanceof PDFDict && dict.has(N("T"));
        })
      : [];
    if (kidFields.length) {
      kidFields.forEach((kid) => walk(kid, name, type));
      return;
    }
    if (type === N("Sig")) {
      const value = field.lookup(N("V"));
      found.push({ name, field, value: value instanceof PDFDict ? value : null });
    }
  };
  fields.asArray().forEach((ref) => walk(ref, "", undefined));
  return found;
}

/** True when the PDF carries at least one applied digital signature. */
export function hasDigitalSignatures(doc: PDFDocument) {
  return signatureFields(doc).some((field) => field.value);
}
