function parseRangePart(part: string, pageCount: number) {
  const match = part.match(/^(\d*)\s*(?:(-)\s*(\d*))?$/);
  if (!match || (!match[1] && !match[3])) {
    throw new Error(`Invalid page range "${part}".`);
  }

  const start = match[1] ? Number(match[1]) : 1;
  const end = match[2] ? (match[3] ? Number(match[3]) : pageCount) : start;

  if (start < 1 || end < 1 || start > pageCount || end > pageCount) {
    throw new Error(`Page range "${part}" is outside 1-${pageCount}.`);
  }

  const indices: number[] = [];
  const step = start <= end ? 1 : -1;
  for (let page = start; step > 0 ? page <= end : page >= end; page += step) {
    indices.push(page - 1);
  }
  return indices;
}

/**
 * Parse a 1-based page selection ("1-3, 5, 8-") into groups of 0-based page
 * indices, one group per comma-separated part, in the order typed.
 */
export function parsePageGroups(selection: string | undefined, pageCount: number) {
  const groups = (selection || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parseRangePart(part, pageCount));

  if (!groups.length) {
    throw new Error("Page selection is empty.");
  }
  return groups;
}

/**
 * Parse a 1-based page selection ("1-3, 5, 8-") into 0-based page indices,
 * preserving the order the user typed. Empty means every page. Throws on
 * out-of-range or malformed input.
 */
export function parsePageSelection(selection: string | undefined, pageCount: number) {
  if (!(selection || "").trim()) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }
  return parsePageGroups(selection, pageCount).flat();
}
