// Sign with a DSC on a USB token through hey (https://github.com/kitsyai/hey)
// and its dsc service (https://github.com/kitsyai/dsc). The page never sees
// the private key: dsc asks the user in a native dialog, and the token signs.
import type { RawSigner } from "./cms";
import { describeCertificate, type CertificateSummary } from "./cms";

export const HEY_HUB_URL = "http://127.0.0.1:8525";
const CLIENT = "kitsy-pdf";

export type TokenCertificate = {
  id: string;
  certificate: Uint8Array;
  /** Where the key lives, e.g. the token label or "Windows certificate store". */
  label: string;
  source: string;
  summary: CertificateSummary;
};

export type HeyDscErrorCode =
  | "no_hub" // hey's hub is not running (or the browser blocked the request)
  | "not_set_up" // the hub runs, but dsc was never started on this computer
  | "not_running" // dsc was set up but is stopped
  | "declined"
  | "not_found"
  | "pin_incorrect"
  | "pin_locked"
  | "unsupported_key"
  | "no_dialog"
  | "failed";

const MESSAGES: Record<HeyDscErrorCode, string> = {
  no_hub:
    "Couldn't reach hey on this computer. Make sure it's running (hey up dsc), and if your browser asked about access to your local network, allow it.",
  not_set_up: "The token signer isn't set up yet. Run: hey up dsc",
  not_running: "The token signer is stopped. Run: hey up dsc",
  declined: "The signature was cancelled.",
  not_found: "The certificate wasn't found. Is the token plugged in?",
  pin_incorrect: "The PIN was not correct.",
  pin_locked: "The token PIN is locked. Unlock it with the token's own software.",
  unsupported_key: "Only RSA certificates are supported.",
  no_dialog: "The signer couldn't show its confirmation dialog on this computer.",
  failed: "The token couldn't sign.",
};

export class HeyDscError extends Error {
  code: HeyDscErrorCode;
  constructor(code: HeyDscErrorCode, message?: string) {
    super(message || MESSAGES[code]);
    this.name = "HeyDscError";
    this.code = code;
  }
}

type Options = { hubUrl?: string; fetch?: typeof fetch; signal?: AbortSignal };

const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function call(path: string, init: RequestInit, options: Options) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const url = `${(options.hubUrl ?? HEY_HUB_URL).replace(/\/+$/, "")}/svc/dsc${path}`;
  let response: Response;
  try {
    response = await doFetch(url, {
      ...init,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal: options.signal,
      headers: { "X-Hey-Client": CLIENT, ...(init.headers || {}) },
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new HeyDscError("no_hub");
  }
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // The hub answers 404/503 with plain text.
  }
  if (response.ok) return body;
  const code = body?.error as HeyDscErrorCode | undefined;
  if (code && code in MESSAGES) throw new HeyDscError(code, body?.message);
  if (response.status === 404) throw new HeyDscError("not_set_up");
  if (response.status === 503) throw new HeyDscError("not_running");
  throw new HeyDscError("failed", body?.message);
}

/** Lists the signing certificates on connected tokens. No PIN is asked. */
export async function findTokenCertificates(options: Options = {}): Promise<TokenCertificate[]> {
  const body = await call("/certificates", { method: "GET" }, options);
  const out: TokenCertificate[] = [];
  for (const item of body?.certificates ?? []) {
    try {
      const certificate = base64ToBytes(item.certificate);
      out.push({
        id: String(item.id),
        certificate,
        label: String(item.label || "Token"),
        source: String(item.source || ""),
        summary: describeCertificate(certificate),
      });
    } catch {
      // Skip anything that isn't a readable certificate.
    }
  }
  return out;
}

/**
 * A RawSigner backed by the token. Each sign() call makes dsc show its
 * consent dialog (and, on macOS/Linux, ask for the PIN); `document` is the
 * file name shown there.
 */
export function heyTokenSigner(token: TokenCertificate, { document = "", ...options }: Options & { document?: string } = {}): RawSigner {
  return {
    certificate: token.certificate,
    async sign(toBeSigned: Uint8Array) {
      const body = await call(
        "/sign",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ certificateId: token.id, data: bytesToBase64(toBeSigned), document }),
        },
        options
      );
      if (!body?.signature) throw new HeyDscError("failed");
      return base64ToBytes(body.signature);
    },
  };
}
