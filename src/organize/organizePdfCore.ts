import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFPage, PDFRef, degrees } from "pdf-lib";
import { loadPdf } from "../shared/files";
import { normalizeRotation } from "../shared/pageGeometry";

/** One page of the output: which source page (0-based) and extra rotation. */
export type PageEdit = { source: number; rotation?: number };

/**
 * Reorder, rotate, and delete pages. Pages not listed are deleted. Edits the
 * document in place so metadata and document-level settings are kept.
 */
export async function organizePdf(bytes: ArrayBuffer | Uint8Array, edits: PageEdit[]) {
  if (!edits.length) {
    throw new Error("Keep at least one page.");
  }

  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const seen = new Set<number>();
  for (const edit of edits) {
    if (!Number.isInteger(edit.source) || edit.source < 0 || edit.source >= pages.length) {
      throw new Error(`Page ${edit.source + 1} does not exist.`);
    }
    if (seen.has(edit.source)) {
      throw new Error(`Page ${edit.source + 1} is listed twice.`);
    }
    seen.add(edit.source);
  }

  const removed = pages.filter((_, index) => !seen.has(index));

  for (let index = pages.length - 1; index >= 0; index -= 1) {
    doc.removePage(index);
  }

  for (const edit of edits) {
    const page = pages[edit.source];
    const turn = normalizeRotation(edit.rotation || 0);
    if (turn) {
      page.setRotation(degrees(normalizeRotation(page.getRotation().angle + turn)));
    }
    doc.addPage(page);
  }

  pruneDanglingReferences(doc, removed);
  return doc.save();
}

const N = (name: string) => PDFName.of(name);

/** Page a destination points at, if it is an explicit [page ...] array. */
function destinationPage(item: PDFDict) {
  let dest = item.lookup(N("Dest"));
  const action = item.lookup(N("A"));
  if (!dest && action instanceof PDFDict && action.lookup(N("S")) === N("GoTo")) {
    dest = action.lookup(N("D"));
  }
  if (dest instanceof PDFArray && dest.size() > 0) {
    const target = dest.get(0);
    return target instanceof PDFRef ? target.toString() : null;
  }
  return null;
}

/**
 * Rebuild one level of the outline (bookmark) tree without items that point
 * at deleted pages. An item that still has children keeps them and only loses
 * its dead link. Returns the number of items visible when this level is open.
 */
function pruneOutlineLevel(doc: PDFDocument, parent: PDFDict, removed: Set<string>): number {
  const kept: Array<{ ref: PDFRef; item: PDFDict }> = [];
  let ref = parent.get(N("First"));
  const visited = new Set<string>();
  while (ref instanceof PDFRef && !visited.has(ref.toString())) {
    visited.add(ref.toString());
    const item = doc.context.lookup(ref);
    if (!(item instanceof PDFDict)) break;
    const next = item.get(N("Next"));

    const childCount = pruneOutlineLevel(doc, item, removed);
    const hasChildren = item.get(N("First")) instanceof PDFRef;
    const target = destinationPage(item);
    if (target && removed.has(target)) {
      if (hasChildren) {
        item.delete(N("Dest"));
        item.delete(N("A"));
        kept.push({ ref, item });
      }
    } else {
      kept.push({ ref, item });
    }

    // Count > 0 means open (children visible); < 0 closed.
    const previous = item.lookup(N("Count"));
    if (hasChildren) {
      const open = !(previous instanceof PDFNumber) || previous.asNumber() >= 0;
      item.set(N("Count"), PDFNumber.of(open ? childCount : -childCount));
    } else {
      item.delete(N("Count"));
    }
    ref = next;
  }

  kept.forEach(({ item }, index) => {
    if (index > 0) item.set(N("Prev"), kept[index - 1].ref);
    else item.delete(N("Prev"));
    if (index < kept.length - 1) item.set(N("Next"), kept[index + 1].ref);
    else item.delete(N("Next"));
  });
  if (kept.length) {
    parent.set(N("First"), kept[0].ref);
    parent.set(N("Last"), kept[kept.length - 1].ref);
  } else {
    parent.delete(N("First"));
    parent.delete(N("Last"));
  }

  return kept.reduce((sum, { item }) => {
    const count = item.lookup(N("Count"));
    return sum + 1 + (count instanceof PDFNumber && count.asNumber() > 0 ? count.asNumber() : 0);
  }, 0);
}

/** Drop form fields whose widgets were all on deleted pages; trim the rest. */
function pruneField(doc: PDFDocument, ref: unknown, removedWidgets: Set<string>): boolean {
  if (!(ref instanceof PDFRef)) return true;
  const field = doc.context.lookup(ref);
  if (!(field instanceof PDFDict)) return true;
  const kids = field.lookup(N("Kids"));
  if (kids instanceof PDFArray) {
    const keptKids = kids.asArray().filter((kid) => pruneField(doc, kid, removedWidgets));
    if (!keptKids.length) return false;
    field.set(N("Kids"), doc.context.obj(keptKids));
    return true;
  }
  return !removedWidgets.has(ref.toString());
}

/**
 * Deleting pages leaves bookmarks and form fields pointing at pages that no
 * longer exist. Remove those references so viewers don't show dead entries.
 */
export function pruneDanglingReferences(doc: PDFDocument, removedPages: PDFPage[]) {
  if (!removedPages.length) return;
  const removedRefs = new Set(removedPages.map((page) => page.ref.toString()));

  const outlines = doc.catalog.lookup(N("Outlines"));
  if (outlines instanceof PDFDict) {
    const visible = pruneOutlineLevel(doc, outlines, removedRefs);
    if (visible) outlines.set(N("Count"), PDFNumber.of(visible));
    else outlines.delete(N("Count"));
  }

  const removedWidgets = new Set<string>();
  for (const page of removedPages) {
    const annots = page.node.lookup(N("Annots"));
    if (annots instanceof PDFArray) {
      annots.asArray().forEach((annot) => annot instanceof PDFRef && removedWidgets.add(annot.toString()));
    }
  }
  const acroForm = doc.catalog.lookup(N("AcroForm"));
  const fields = acroForm instanceof PDFDict ? acroForm.lookup(N("Fields")) : null;
  if (removedWidgets.size && acroForm instanceof PDFDict && fields instanceof PDFArray) {
    acroForm.set(N("Fields"), doc.context.obj(fields.asArray().filter((field) => pruneField(doc, field, removedWidgets))));
  }
}
