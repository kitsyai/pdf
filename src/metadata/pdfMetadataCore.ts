import { PDFName } from "pdf-lib";
import { loadPdf } from "../shared/files";

export type PdfMetadataFields = {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
};

export type PdfMetadata = PdfMetadataFields & {
  pageCount: number;
  creationDate: Date | null;
  modificationDate: Date | null;
  hasXmp: boolean;
};

export const METADATA_FIELDS: Array<keyof PdfMetadataFields> = [
  "title",
  "author",
  "subject",
  "keywords",
  "creator",
  "producer",
];

export async function readPdfMetadata(bytes: ArrayBuffer | Uint8Array): Promise<PdfMetadata> {
  // updateMetadata: false so we read what is in the file, not pdf-lib defaults.
  const doc = await loadPdf(bytes, { updateMetadata: false });
  return {
    title: doc.getTitle() || "",
    author: doc.getAuthor() || "",
    subject: doc.getSubject() || "",
    keywords: doc.getKeywords() || "",
    creator: doc.getCreator() || "",
    producer: doc.getProducer() || "",
    pageCount: doc.getPageCount(),
    creationDate: doc.getCreationDate() || null,
    modificationDate: doc.getModificationDate() || null,
    hasXmp: Boolean(doc.catalog.get(PDFName.of("Metadata"))),
  };
}

export function splitKeywords(value: string) {
  return (value || "")
    .split(/[,;]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export async function writePdfMetadata(
  bytes: ArrayBuffer | Uint8Array,
  fields: Partial<PdfMetadataFields>,
  { stripXmp = false, now = new Date() }: { stripXmp?: boolean; now?: Date } = {}
) {
  const doc = await loadPdf(bytes, { updateMetadata: false });

  if (fields.title !== undefined) doc.setTitle(fields.title.trim());
  if (fields.author !== undefined) doc.setAuthor(fields.author.trim());
  if (fields.subject !== undefined) doc.setSubject(fields.subject.trim());
  if (fields.keywords !== undefined) doc.setKeywords(splitKeywords(fields.keywords));
  if (fields.creator !== undefined) doc.setCreator(fields.creator.trim());
  if (fields.producer !== undefined) doc.setProducer(fields.producer.trim());
  doc.setModificationDate(now);

  // XMP is a second copy of the metadata that some apps prefer over the Info
  // dictionary. Dropping it keeps viewers from showing the old values.
  if (stripXmp) doc.catalog.delete(PDFName.of("Metadata"));

  return doc.save();
}
