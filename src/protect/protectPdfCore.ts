import { PDFDocument } from "pdf-lib";

/** The parts of an Emscripten qpdf instance we use. */
export type QpdfInstance = {
  callMain(args: string[]): number;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
};

/** Create a fresh qpdf module (browser: fetches the .wasm; tests: from disk). */
export type QpdfFactory = (options: Record<string, unknown>) => Promise<QpdfInstance>;

type Sink = { out: string[]; err: string[] } | null;

/** Module creations run one at a time, so console patches never overlap. */
let creationQueue: Promise<unknown> = Promise.resolve();

/**
 * qpdf binds console.log / console.error once, when the module is created,
 * and ignores Emscripten's print hooks. Install forwarding functions just
 * while it is created so its output can be captured per run.
 */
async function createCaptured(factory: QpdfFactory) {
  const turn = creationQueue.then(() => createPatched(factory));
  creationQueue = turn.catch(() => undefined);
  return turn;
}

async function createPatched(factory: QpdfFactory) {
  let sink: Sink = null;
  const original = { log: console.log, error: console.error, warn: console.warn };
  const forward = (kind: "out" | "err", fallback: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      if (sink) sink[kind].push(args.map(String).join(" "));
      else fallback(...args);
    };
  console.log = forward("out", original.log);
  console.error = forward("err", original.error);
  console.warn = forward("err", original.warn);
  let qpdf: QpdfInstance;
  try {
    qpdf = await factory({});
  } finally {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
  }

  function run(args: string[]) {
    sink = { out: [], err: [] };
    let code: number;
    try {
      code = qpdf.callMain(args);
    } catch (error) {
      code = typeof error?.status === "number" ? error.status : 2;
    }
    const result = { code, stdout: sink.out.join("\n"), stderr: sink.err.join("\n") };
    sink = null;
    return result;
  }

  return { qpdf, run };
}

export class PasswordError extends Error {
  constructor(message = "That password is not correct.") {
    super(message);
    this.name = "PasswordError";
  }
}

export type PrintPermission = "full" | "low" | "none";

export type ProtectOptions = {
  /** Needed to open the file. Empty means anyone can open it (restrictions only). */
  userPassword?: string;
  /** Needed to change permissions. Generated when left empty. */
  ownerPassword?: string;
  print?: PrintPermission;
  /** Copying text and images. */
  extract?: boolean;
  /** Any editing: content, pages, annotations, forms. */
  modify?: boolean;
};

const INPUT = "/input.pdf";
const OUTPUT = "/output.pdf";

/** qpdf exit codes: 0 ok, 3 ok with warnings, 2 error. */
const succeeded = (code: number) => code === 0 || code === 3;

/** "this.program: /input.pdf: invalid password" -> "invalid password" */
function cleanError(stderr: string) {
  const line = stderr.split("\n").map((text) => text.trim()).find(Boolean) || "";
  return line.replace(/^[^:]*:\s*/, "").replace(/^\/input\.pdf:\s*/, "").trim();
}

export function randomPassword(length = 32) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const values = new Uint32Array(length);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

export async function isEncrypted(bytes: ArrayBuffer | Uint8Array) {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.isEncrypted;
  } catch {
    throw new Error("This file is not a readable PDF.");
  }
}

function toBytes(bytes: ArrayBuffer | Uint8Array) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/** Encrypt with AES-256. Returns the bytes and the owner password used. */
export async function protectPdf(
  bytes: ArrayBuffer | Uint8Array,
  options: ProtectOptions,
  factory: QpdfFactory
) {
  const userPassword = options.userPassword ?? "";
  const print = options.print ?? "full";
  const extract = options.extract ?? true;
  const modify = options.modify ?? true;
  const restricted = print !== "full" || !extract || !modify;
  if (!userPassword && !restricted) {
    throw new Error("Set a password to open the file, or turn off at least one permission.");
  }
  if (await isEncrypted(bytes)) {
    throw new Error("This PDF is already protected. Unlock it first, then protect it again.");
  }

  // An empty owner password would let anyone open the file without a password.
  const ownerPassword = options.ownerPassword || randomPassword();
  if (userPassword && ownerPassword === userPassword && restricted) {
    throw new Error("Use a different owner password, or the restrictions can be lifted with the open password.");
  }

  const { qpdf, run } = await createCaptured(factory);
  qpdf.FS.writeFile(INPUT, toBytes(bytes));
  const result = run([
    "--encrypt",
    `--user-password=${userPassword}`,
    `--owner-password=${ownerPassword}`,
    "--bits=256",
    `--print=${print}`,
    `--extract=${extract ? "y" : "n"}`,
    `--modify=${modify ? "all" : "none"}`,
    "--",
    INPUT,
    OUTPUT,
  ]);
  if (!succeeded(result.code)) {
    throw new Error(cleanError(result.stderr) || "Could not protect this PDF.");
  }
  return { bytes: qpdf.FS.readFile(OUTPUT), ownerPassword };
}

/**
 * Remove encryption. Tries without a password first, which works for files
 * that only restrict printing or editing. Throws PasswordError when a
 * password is needed or the one given is wrong.
 */
export async function unlockPdf(
  bytes: ArrayBuffer | Uint8Array,
  password: string,
  factory: QpdfFactory
) {
  if (!(await isEncrypted(bytes))) {
    throw new Error("This PDF is not password protected.");
  }

  const { qpdf, run } = await createCaptured(factory);
  qpdf.FS.writeFile(INPUT, toBytes(bytes));
  const result = run([`--password=${password}`, "--decrypt", INPUT, OUTPUT]);
  if (!succeeded(result.code)) {
    const message = cleanError(result.stderr);
    if (/invalid password/i.test(message)) {
      throw new PasswordError(password ? "That password is not correct." : "This PDF needs a password to open.");
    }
    throw new Error(message || "Could not unlock this PDF.");
  }
  return qpdf.FS.readFile(OUTPUT);
}
