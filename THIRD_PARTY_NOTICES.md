# Third-party notices

`@kitsy/pdf` is licensed under the [Apache License 2.0](LICENSE). It uses the
open-source packages below. They are installed from npm as dependencies; this
package does not copy or modify their code. When you bundle an app that uses
`@kitsy/pdf`, your bundle includes code from these packages, so their licenses
apply to that bundle too.

## Runtime dependencies

| Package | License | Used for |
| --- | --- | --- |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT | Reading and writing PDFs |
| [@pdf-lib/standard-fonts](https://github.com/Hopding/standard-fonts), [@pdf-lib/upng](https://github.com/Hopding/upng) | MIT | pdf-lib internals |
| [pako](https://github.com/nodeca/pako) | MIT AND Zlib | Compression (via pdf-lib) |
| [pdfjs-dist](https://github.com/mozilla/pdf.js) (pdf.js) | Apache-2.0 | Page previews, PDF to images |
| [@neslinesli93/qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm) | ISC | Encryption and decryption (Protect / Unlock) |
| [qpdf](https://github.com/qpdf/qpdf) (inside the WebAssembly above) | Apache-2.0 | Encryption and decryption |
| [pkijs](https://github.com/PeculiarVentures/PKI.js) | BSD-3-Clause | CMS signatures and X.509 certificates |
| [asn1js](https://github.com/PeculiarVentures/ASN1.js) | BSD-3-Clause | ASN.1 encoding (via pkijs) |
| [bytestreamjs](https://github.com/PeculiarVentures/ByteStream.js) | BSD-3-Clause | pkijs internals |
| [pvtsutils](https://github.com/PeculiarVentures/pvtsutils), [pvutils](https://github.com/PeculiarVentures/pvutils) | MIT | pkijs internals |
| [@noble/hashes](https://github.com/paulmillr/noble-hashes) | MIT | pkijs internals |
| [tslib](https://github.com/microsoft/tslib) | 0BSD | Helpers used by dependencies |
| [node-forge](https://github.com/digitalbazaar/forge) | BSD-3-Clause OR GPL-2.0 (used under BSD-3-Clause) | Decrypting `.pfx` / `.p12` certificate files only |
| [@fontsource/dancing-script](https://github.com/fontsource/font-files) | OFL-1.1 (font), MIT (packaging) | Typed signature style (React UI) |
| [@fontsource/great-vibes](https://github.com/fontsource/font-files) | OFL-1.1 (font), MIT (packaging) | Typed signature style (React UI) |

`pdfjs-dist` also lists `@napi-rs/canvas` (MIT) as an optional dependency for
Node. Browsers do not use it.

## Optional peer dependency

| Package | License |
| --- | --- |
| [react](https://github.com/facebook/react) | MIT |

## Not included

- Font Awesome: the React UI uses its class names (`fa-solid ...`) for icons
  but does not ship it. If you load it, its own license applies (icons
  CC BY 4.0, fonts SIL OFL 1.1, code MIT).
- pdf.js CMaps and standard fonts are not shipped. If you serve them (see
  `pdfjsAssetsBase` in the README), they come from `pdfjs-dist` under its
  licenses.

The full license text of each package is in its folder under `node_modules`
after install, and at the links above.
