import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import createModule from "@neslinesli93/qpdf-wasm";
import { PDFDict, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { PasswordError, isEncrypted, protectPdf, randomPassword, unlockPdf, type QpdfFactory } from "./protectPdfCore";

const wasmPath = createRequire(import.meta.url).resolve("@neslinesli93/qpdf-wasm/dist/qpdf.wasm");
const factory: QpdfFactory = (options) =>
  (createModule as unknown as QpdfFactory)({ ...options, locateFile: () => wasmPath });

async function plainPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  doc.addPage([400, 300]);
  doc.setTitle("Quarterly report");
  return doc.save();
}

/** Encryption dictionary values, read without decrypting. */
async function encryption(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const dict = doc.context.lookup(doc.context.trailerInfo.Encrypt) as PDFDict;
  const number = (key: string) => (dict.lookup(PDFName.of(key)) as PDFNumber).asNumber();
  const p = number("P");
  return {
    revision: number("R"),
    print: Boolean(p & 4),
    printHigh: Boolean(p & 2048),
    modify: Boolean(p & 8),
    extract: Boolean(p & 16),
  };
}

describe("protectPdf", () => {
  it("encrypts with AES-256 and opens again with the password", async () => {
    const { bytes, ownerPassword } = await protectPdf(await plainPdf(), { userPassword: "open sesame" }, factory);
    expect(await isEncrypted(bytes)).toBe(true);
    await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i);
    expect((await encryption(bytes)).revision).toBe(6);
    expect(ownerPassword).toHaveLength(32);

    const unlocked = await PDFDocument.load(await unlockPdf(bytes, "open sesame", factory));
    expect(unlocked.getTitle()).toBe("Quarterly report");
    expect(unlocked.getPageCount()).toBe(2);
  });

  it("applies permission restrictions", async () => {
    const { bytes } = await protectPdf(
      await plainPdf(),
      { userPassword: "u", ownerPassword: "o", print: "low", extract: false, modify: false },
      factory
    );
    expect(await encryption(bytes)).toMatchObject({ print: true, printHigh: false, modify: false, extract: false });

    const open = await protectPdf(await plainPdf(), { userPassword: "u" }, factory);
    expect(await encryption(open.bytes)).toMatchObject({ print: true, printHigh: true, modify: true, extract: true });
  });

  it("supports restrictions without an open password", async () => {
    const { bytes } = await protectPdf(await plainPdf(), { print: "none" }, factory);
    expect(await encryption(bytes)).toMatchObject({ print: false });
    // No password needed to unlock: the file only restricts what you can do.
    const unlocked = await PDFDocument.load(await unlockPdf(bytes, "", factory));
    expect(unlocked.getPageCount()).toBe(2);
  });

  it("passes passwords that look like options through safely", async () => {
    const { bytes } = await protectPdf(await plainPdf(), { userPassword: "--decrypt -x" }, factory);
    await expect(unlockPdf(bytes, "--decrypt -x", factory)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("validates options", async () => {
    const bytes = await plainPdf();
    await expect(protectPdf(bytes, {}, factory)).rejects.toThrow(/Set a password/);
    await expect(
      protectPdf(bytes, { userPassword: "same", ownerPassword: "same", modify: false }, factory)
    ).rejects.toThrow(/different owner password/);
    const { bytes: locked } = await protectPdf(bytes, { userPassword: "u" }, factory);
    await expect(protectPdf(locked, { userPassword: "v" }, factory)).rejects.toThrow(/already protected/);
  });
});

describe("unlockPdf", () => {
  it("reports a missing or wrong password without printing to the console", async () => {
    const { bytes } = await protectPdf(await plainPdf(), { userPassword: "right" }, factory);
    const errors = vi.spyOn(console, "error");
    await expect(unlockPdf(bytes, "", factory)).rejects.toThrow(new PasswordError("This PDF needs a password to open."));
    await expect(unlockPdf(bytes, "wrong", factory)).rejects.toBeInstanceOf(PasswordError);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("refuses files that are not protected or not PDFs", async () => {
    await expect(unlockPdf(await plainPdf(), "", factory)).rejects.toThrow(/not password protected/);
    await expect(unlockPdf(new TextEncoder().encode("nope"), "", factory)).rejects.toThrow(/not a readable PDF/);
  });
});

describe("console capture", () => {
  it("restores the real console even when runs overlap", async () => {
    const realLog = console.log;
    const realError = console.error;
    const bytes = await plainPdf();
    const results = await Promise.all([
      protectPdf(bytes, { userPassword: "a" }, factory),
      protectPdf(bytes, { userPassword: "b" }, factory),
      unlockPdf((await protectPdf(bytes, { userPassword: "c" }, factory)).bytes, "wrong", factory).catch((error) => error),
    ]);
    expect(results[2]).toBeInstanceOf(PasswordError);
    expect(console.log).toBe(realLog);
    expect(console.error).toBe(realError);
  });
});

describe("randomPassword", () => {
  it("is long, varied, and unambiguous", () => {
    const a = randomPassword();
    expect(a).toMatch(/^[A-HJ-NP-Za-km-z2-9]{32}$/);
    expect(randomPassword()).not.toBe(a);
  });
});
