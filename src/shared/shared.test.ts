import { describe, expect, it } from "vitest";
import { formatBytes, toBaseName } from "./files";
import { parsePageGroups, parsePageSelection } from "./pageRanges";
import { crc32, createZip } from "./zip";

describe("parsePageGroups", () => {
  it("returns one group per comma part", () => {
    expect(parsePageGroups("1-2, 4, 5-", 6)).toEqual([[0, 1], [3], [4, 5]]);
  });

  it("rejects empty and malformed input", () => {
    expect(() => parsePageGroups("", 3)).toThrow(/empty/);
    expect(() => parsePageGroups("1 3", 3)).toThrow(/Invalid/);
  });

  it("flattens to the same result as parsePageSelection", () => {
    expect(parsePageSelection("3, 1-2", 5)).toEqual(parsePageGroups("3, 1-2", 5).flat());
  });
});

describe("file helpers", () => {
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("builds safe base names", () => {
    expect(toBaseName("report.pdf", "x")).toBe("report");
    expect(toBaseName("a/b:c", "x")).toBe("a-b-c");
    expect(toBaseName("   ", "fallback")).toBe("fallback");
  });
});

function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const endOffset = zip.length - 22;
  expect(view.getUint32(endOffset, true)).toBe(0x06054b50);
  const count = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);
  const files: Record<string, Uint8Array> = {};

  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const dataStart = localOffset + 30 + localNameLength;
    const data = zip.subarray(dataStart, dataStart + size);
    expect(crc32(data)).toBe(crc);
    files[name] = data;
    cursor += 46 + nameLength;
  }
  return files;
}

describe("createZip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("round-trips entries, including UTF-8 names", () => {
    const encoder = new TextEncoder();
    const zip = createZip([
      { name: "a.pdf", bytes: encoder.encode("first") },
      { name: "résumé.pdf", bytes: encoder.encode("second file") },
    ]);
    const files = readZip(zip);
    expect(Object.keys(files)).toEqual(["a.pdf", "résumé.pdf"]);
    expect(new TextDecoder().decode(files["résumé.pdf"])).toBe("second file");
  });
});
