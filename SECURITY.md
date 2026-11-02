# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub: **Security →
Advisories → Report a vulnerability** on this repository. Do not open a public
issue for them.

Include the affected version, what an attacker could do, and steps or a sample
file to reproduce it. We aim to acknowledge reports within a few working days.

## Supported versions

Fixes go into the latest published version.

## Design notes

- All processing runs on the user's device. The package makes no network
  requests except for loading its own assets (pdf.js worker, qpdf WebAssembly,
  optional pdf.js CMaps), from URLs that the host app configures.
- Certificate signing: the private key from a `.pfx` / `.p12` file is imported
  into WebCrypto as non-extractable, and the decrypted key bytes are cleared
  after import. node-forge is used only to decrypt the file, never to check
  signatures.
- Signature verification checks integrity and coverage only. It does **not**
  check certificate trust, revocation (CRL/OCSP) or timestamps, and the UI says
  so.
