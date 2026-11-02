// Read a .pfx / .p12 certificate file. node-forge is used only to decrypt
// the container: Windows and many CA exports use legacy PKCS#12 encryption
// (3DES / RC2 with SHA-1), which WebCrypto cannot decrypt. All signing and
// verification happens in WebCrypto/pkijs, never in forge.
import forge from "node-forge/lib/forge.js";
import "node-forge/lib/asn1.js";
import "node-forge/lib/pki.js";
import "node-forge/lib/pkcs12.js";

export class CertificatePasswordError extends Error {
  constructor() {
    super("That password does not open this certificate file.");
    this.name = "CertificatePasswordError";
  }
}

export type CertificateIdentity = {
  /** DER of the signer certificate, byte-for-byte as stored in the file. */
  certificate: Uint8Array;
  /** DER of the other certificates in the file (issuers), if any. */
  chain: Uint8Array[];
  /** PKCS#8 DER of the RSA private key, for WebCrypto importKey. */
  privateKeyPkcs8: Uint8Array;
};

const toBinary = (bytes: Uint8Array) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
};

const fromBinary = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

/**
 * forge rebuilds parts of a certificate when re-encoding it, which can change
 * its bytes (e.g. an omitted NULL algorithm parameter) and so break the CA's
 * signature on it. Capture each certificate's original ASN.1 while parsing and
 * DER-encode that instead.
 */
function parseKeepingCertificateBytes(p12Asn1, password: string) {
  const derByCert = new Map();
  const original = forge.pki.certificateFromAsn1;
  forge.pki.certificateFromAsn1 = (asn1, computeHash) => {
    const cert = original(asn1, computeHash);
    derByCert.set(cert, fromBinary(forge.asn1.toDer(asn1).getBytes()));
    return cert;
  };
  try {
    return { p12: forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password), derByCert };
  } finally {
    forge.pki.certificateFromAsn1 = original;
  }
}

export function readPkcs12(bytes: ArrayBuffer | Uint8Array, password: string): CertificateIdentity {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  let p12Asn1;
  try {
    p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(toBinary(data)), false);
  } catch {
    throw new Error("This is not a .pfx / .p12 certificate file.");
  }

  let parsed;
  try {
    parsed = parseKeepingCertificateBytes(p12Asn1, password);
  } catch (error) {
    const message = String(error?.message || "");
    if (/MAC could not be verified|Invalid password|wrong password|decrypt/i.test(message)) {
      throw new CertificatePasswordError();
    }
    throw new Error(`Could not read this certificate file (${message || "unknown format"}).`);
  }
  const { p12, derByCert } = parsed;

  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];

  const key = keyBags.find((bag) => bag.key)?.key;
  if (!key) {
    if (keyBags.length) {
      throw new Error("Only RSA certificates are supported. This file holds a different key type.");
    }
    throw new Error("This file has no private key. Export the certificate together with its private key.");
  }

  const certs = certBags.filter((bag) => bag.cert);
  const leaf = certs.find(
    (bag) => bag.cert.publicKey?.n && bag.cert.publicKey.n.equals(key.n) && bag.cert.publicKey.e.equals(key.e)
  );
  if (!leaf) {
    throw new Error("No certificate in this file matches its private key.");
  }

  const pkcs8 = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key));
  return {
    certificate: derByCert.get(leaf.cert),
    chain: certs.filter((bag) => bag !== leaf).map((bag) => derByCert.get(bag.cert)),
    privateKeyPkcs8: fromBinary(forge.asn1.toDer(pkcs8).getBytes()),
  };
}
