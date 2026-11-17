# Changelog

All notable changes to this package are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/). Before 1.0.0, minor versions may
include breaking changes.

## [0.2.2] - Unreleased

### Added

- Long-term validation (PAdES LTV) for USB-token signatures:
  `fetchValidationData` gets the certificate's chain and OCSP responses or
  CRLs through hey's `dsc` (0.1.4+), and `signPdfWithCertificate({ ltv })`
  embeds the chain in the signature and appends a DSS as an incremental
  update. Adobe Reader can then confirm the signature offline instead of
  showing "validity unknown". `appendDss` is exported.
- `verifyPdfSignatures` reports `hasValidationData` and
  `laterChangesAreValidationData`: a revision that only adds a DSS (catalog
  /DSS and /Extensions, objects reachable from the DSS) keeps the signature
  "valid"; any other later change is still flagged.
- `CertSignPdf` (USB token) fetches validation data before signing, stops on
  a revoked certificate, and says when LTV data couldn't be added.

## [0.2.1] - 2026-11-17

### Fixed

- USB-token signing with tokens that hash on the card, such as the
  ePass2003: the signing-certificate-v2 attribute no longer includes
  issuerSerial (as ETSI EN 319 122-1 recommends), so the signed attributes
  are 135 bytes instead of several hundred. Those tokens fail with
  CKR_DEVICE_ERROR on inputs above about 128-255 bytes.

## [0.2.0] - 2026-11-07

### Added

- USB-token DSC signing through hey's `dsc` service: `findTokenCertificates`,
  `heyTokenSigner`, `HeyDscError` and `HEY_HUB_URL`. The private key stays on
  the token, and the user confirms each signature in a native dialog.
- `CertSignPdf` has a "USB token" mode next to "Certificate file", with
  one-time setup steps for users who haven't installed hey yet.

## [0.1.0] - 2026-11-02

First public release.

### Added

- Framework-free core (`@kitsy/pdf`): merge, split, images to PDF, watermark
  and page numbers, metadata, organize pages, visible signatures, PDF to
  images, compress, fill forms, protect / unlock (AES-256), PAdES digital
  signatures with `.pfx` / `.p12` certificates, and signature verification.
- React UIs (`@kitsy/pdf/react` and `@kitsy/pdf/react/<tool>`), with
  `PdfToolsProvider` for navigation and page chrome.
- `configurePdf()` for asset URLs and the Producer name; `@kitsy/pdf/vite`
  with ready-made asset URLs for Vite apps.
- Prebuilt `@kitsy/pdf/styles.css` for apps that do not use Tailwind CSS.
