// CMS (PKCS#7) signatures for PDF, PAdES baseline style (ETSI.CAdES.detached).
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

export const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  sha256: "2.16.840.1.101.3.4.2.1",
  sha256WithRSA: "1.2.840.113549.1.1.11",
  commonName: "2.5.4.3",
  organization: "2.5.4.10",
  organizationalUnit: "2.5.4.11",
  country: "2.5.4.6",
  email: "1.2.840.113549.1.9.1",
};

/**
 * Whatever holds the private key: a .pfx in the browser today, a USB token
 * behind a local signer later. It signs the DER-encoded signed attributes
 * with RSASSA-PKCS1-v1_5 / SHA-256 and never exposes the key.
 */
export type RawSigner = {
  certificate: Uint8Array;
  chain?: Uint8Array[];
  sign(toBeSigned: Uint8Array): Promise<Uint8Array>;
};

const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

export async function sha256(data: Uint8Array) {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data as BufferSource));
}

function compareBytes(a: Uint8Array, b: Uint8Array) {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function parseCertificate(der: Uint8Array) {
  try {
    return pkijs.Certificate.fromBER(buffer(der));
  } catch {
    throw new Error("Could not read the signing certificate.");
  }
}

/** ESS signing-certificate-v2: binds the signature to this exact certificate. */
async function signingCertificateV2(der: Uint8Array, cert: pkijs.Certificate) {
  const issuerSerial = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 4 }, value: [cert.issuer.toSchema()] })],
      }),
      cert.serialNumber,
    ],
  });
  // hashAlgorithm defaults to SHA-256 in ESSCertIDv2, so it is omitted.
  const essCertId = new asn1js.Sequence({
    value: [new asn1js.OctetString({ valueHex: buffer(await sha256(der)) }), issuerSerial],
  });
  return new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertId] })] });
}

/**
 * Build a detached CMS SignedData over a document digest. The signed
 * attributes are DER-sorted and the exact bytes signed are the ones embedded.
 */
export async function buildCmsSignature(documentDigest: Uint8Array, signer: RawSigner) {
  const cert = parseCertificate(signer.certificate);
  const chain = (signer.chain || []).map(parseCertificate);

  const attributes = [
    new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
    new pkijs.Attribute({
      type: OID.messageDigest,
      values: [new asn1js.OctetString({ valueHex: buffer(documentDigest) })],
    }),
    new pkijs.Attribute({
      type: OID.signingCertificateV2,
      values: [await signingCertificateV2(signer.certificate, cert)],
    }),
  ]
    .map((attribute) => ({ attribute, der: new Uint8Array(attribute.toSchema().toBER()) }))
    .sort((a, b) => compareBytes(a.der, b.der))
    .map(({ attribute }) => attribute);

  // What gets signed is the SET OF attributes; the CMS stores the same bytes
  // under an implicit [0] tag.
  const toBeSigned = new Uint8Array(new asn1js.Set({ value: attributes.map((a) => a.toSchema()) }).toBER());
  const signature = await signer.sign(toBeSigned);

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
    signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes }),
    signatureAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256WithRSA, algorithmParams: new asn1js.Null() }),
    signature: new asn1js.OctetString({ valueHex: buffer(signature) }),
  });

  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID.data }),
    digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 })],
    certificates: [cert, ...chain],
    signerInfos: [signerInfo],
  });

  const contentInfo = new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) });
  return new Uint8Array(contentInfo.toSchema().toBER());
}

/** A RawSigner backed by a PKCS#8 RSA key held in WebCrypto (non-extractable). */
export async function webCryptoSigner(identity: { certificate: Uint8Array; chain?: Uint8Array[]; privateKeyPkcs8: Uint8Array }): Promise<RawSigner> {
  const key = await globalThis.crypto.subtle.importKey(
    "pkcs8",
    identity.privateKeyPkcs8 as BufferSource,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return {
    certificate: identity.certificate,
    chain: identity.chain,
    sign: async (data) => new Uint8Array(await globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, data as BufferSource)),
  };
}

function nameValue(name: pkijs.RelativeDistinguishedNames, oid: string) {
  const entry = name.typesAndValues.find((item) => item.type === oid);
  return entry ? String(entry.value.valueBlock.value) : "";
}

export type CertificateSummary = {
  commonName: string;
  organization: string;
  organizationalUnit: string;
  email: string;
  issuerCommonName: string;
  issuerOrganization: string;
  serialNumber: string;
  notBefore: Date;
  notAfter: Date;
  selfSigned: boolean;
  keyBits: number;
};

export function describeCertificate(der: Uint8Array): CertificateSummary {
  const cert = parseCertificate(der);
  const hex = (bytes: ArrayBuffer) =>
    Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(":");
  let keyBits = 0;
  try {
    const rsa = cert.subjectPublicKeyInfo.parsedKey as pkijs.RSAPublicKey | undefined;
    const modulus = new Uint8Array(rsa?.modulus?.valueBlock?.valueHexView || []);
    keyBits = (modulus[0] === 0 ? modulus.length - 1 : modulus.length) * 8;
  } catch {
    keyBits = 0;
  }
  return {
    commonName: nameValue(cert.subject, OID.commonName),
    organization: nameValue(cert.subject, OID.organization),
    organizationalUnit: nameValue(cert.subject, OID.organizationalUnit),
    email: nameValue(cert.subject, OID.email),
    issuerCommonName: nameValue(cert.issuer, OID.commonName),
    issuerOrganization: nameValue(cert.issuer, OID.organization),
    serialNumber: hex(cert.serialNumber.valueBlock.valueHexView.slice().buffer),
    notBefore: cert.notBefore.value,
    notAfter: cert.notAfter.value,
    selfSigned: cert.subject.isEqual(cert.issuer),
    keyBits,
  };
}
