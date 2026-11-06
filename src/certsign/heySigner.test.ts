import { describe, expect, it } from "vitest";
import { testIdentity } from "../test-utils/certificates";
import { HeyDscError, findTokenCertificates, heyTokenSigner } from "./heySigner";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(body === undefined ? "nope" : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("hey token signer", () => {
  it("lists token certificates through the hub", async () => {
    const { leafDer } = testIdentity();
    const { fn, calls } = fakeFetch(() => ({
      status: 200,
      body: { certificates: [{ id: "abc", certificate: b64(leafDer), label: "ePass2003", source: "pkcs11" }, { id: "bad", certificate: "!!" }] },
    }));
    const certs = await findTokenCertificates({ fetch: fn });
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({ id: "abc", label: "ePass2003", source: "pkcs11" });
    expect(certs[0].summary.commonName).toBe("Asha Verma");
    expect(calls[0].url).toBe("http://127.0.0.1:8525/svc/dsc/certificates");
    expect((calls[0].init.headers as Record<string, string>)["X-Hey-Client"]).toBe("kitsy-pdf");
  });

  it("sends the bytes to sign and returns the token's signature", async () => {
    const { leafDer } = testIdentity();
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: { signature: b64(new Uint8Array([1, 2, 3])) } }));
    const signer = heyTokenSigner(
      { id: "abc", certificate: leafDer, label: "T", source: "pkcs11", summary: null as never },
      { fetch: fn, document: "lease.pdf" }
    );
    expect(Array.from(await signer.sign(new Uint8Array([9, 8, 7])))).toEqual([1, 2, 3]);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ certificateId: "abc", data: b64(new Uint8Array([9, 8, 7])), document: "lease.pdf" });
    expect(signer.certificate).toBe(leafDer);
  });

  it("maps hub and signer failures to clear errors", async () => {
    const cases: [ReturnType<typeof fakeFetch>["fn"], string][] = [
      [(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch, "no_hub"],
      [fakeFetch(() => ({ status: 404 })).fn, "not_set_up"],
      [fakeFetch(() => ({ status: 503 })).fn, "not_running"],
      [fakeFetch(() => ({ status: 403, body: { error: "declined", message: "The signature was cancelled." } })).fn, "declined"],
      [fakeFetch(() => ({ status: 401, body: { error: "pin_incorrect", message: "The PIN was not correct." } })).fn, "pin_incorrect"],
    ];
    for (const [fn, code] of cases) {
      const error = await findTokenCertificates({ fetch: fn }).catch((e) => e);
      expect(error).toBeInstanceOf(HeyDscError);
      expect(error.code).toBe(code);
    }
  });
});
