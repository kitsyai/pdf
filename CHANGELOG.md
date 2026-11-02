# Changelog

All notable changes to this package are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/). Before 1.0.0, minor versions may
include breaking changes.

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
