// Test certificates: a tiny CA plus a signer, packed into .pfx files.
import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";

function rsaKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey: forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs1", format: "pem" }).toString()),
    publicKey: forge.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }).toString()),
  };
}

function certificate(subject: Record<string, string>, keys, issuer, issuerKey, serial: string, ca: boolean) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial;
  // Fixed dates keep tests independent of the day they run.
  cert.validity.notBefore = new Date("2025-01-01T00:00:00Z");
  cert.validity.notAfter = new Date("2045-01-01T00:00:00Z");
  const attrs = Object.entries(subject).map(([shortName, value]) => ({ shortName, value }));
  cert.setSubject(attrs);
  cert.setIssuer(issuer ? issuer.subject.attributes : attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: ca },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: !ca, keyCertSign: ca },
  ]);
  cert.sign(issuerKey, forge.md.sha256.create());
  return cert;
}

const der = (cert) => Uint8Array.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), (c) => c.charCodeAt(0));

let cached = null;
export function testIdentity() {
  if (cached) return cached;
  const caKeys = rsaKeys();
  const ca = certificate({ CN: "Test Root CA", O: "Kitsy Test" }, caKeys, null, caKeys.privateKey, "01", true);
  const keys = rsaKeys();
  const leaf = certificate({ CN: "Asha Verma", O: "Kitsy Test", C: "IN" }, keys, ca, caKeys.privateKey, "0a1b2c", false);

  const pfx = (algorithm: "3des" | "aes256", password: string) =>
    Uint8Array.from(
      forge.asn1
        .toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [leaf, ca], password, { algorithm, generateLocalKeyId: true }))
        .getBytes(),
      (c) => c.charCodeAt(0)
    );

  cached = {
    leafDer: der(leaf),
    caDer: der(ca),
    pfx3des: pfx("3des", "pass-3des"),
    pfxAes: pfx("aes256", "pass-aes"),
  };
  return cached;
}
