# @kitsy/pdf

PDF tools that run entirely in the browser. Files, certificates and passwords
never leave the user's device.

- **Core** (`@kitsy/pdf`): framework-free functions that take and return bytes.
- **React UIs** (`@kitsy/pdf/react`): a ready-made page for each tool.

| Tool | Core function | React component | Subpath |
| --- | --- | --- | --- |
| Merge | `mergePdfs` | `MergePdf` | `@kitsy/pdf/react/merge` |
| Split | `splitPdf` | `SplitPdf` | `@kitsy/pdf/react/split` |
| Images to PDF | `imagesToPdf` | `ImagesToPdf` | `@kitsy/pdf/react/images-to-pdf` |
| Watermark & page numbers | `stampPdf` | `WatermarkPdf` | `@kitsy/pdf/react/watermark` |
| Edit metadata | `readPdfMetadata`, `writePdfMetadata` | `PdfMetadata` | `@kitsy/pdf/react/metadata` |
| Organize pages | `organizePdf` | `OrganizePdf` | `@kitsy/pdf/react/organize` |
| Sign (visible) | `applySignatures` | `SignPdf` | `@kitsy/pdf/react/sign` |
| PDF to images | `renderPageToCanvas` + helpers | `PdfToImages` | `@kitsy/pdf/react/pdf-to-images` |
| Compress | `compressPdf` | `CompressPdf` | `@kitsy/pdf/react/compress` |
| Fill forms | `readFormFields`, `fillForm` | `FillPdfForm` | `@kitsy/pdf/react/fill-form` |
| Protect / unlock (AES-256) | `protectPdf`, `unlockPdf` | `ProtectPdf` | `@kitsy/pdf/react/protect` |
| Digital signature (`.pfx` / `.p12`, PAdES) | `readPkcs12`, `signPdfWithCertificate` | `CertSignPdf` | `@kitsy/pdf/react/certificate-sign` |
| Verify signatures | `verifyPdfSignatures` | `VerifyPdfSignatures` | `@kitsy/pdf/react/verify-signatures` |

## Install

```sh
npm install @kitsy/pdf
# React UIs also need React 18 or later
```

The package is ESM only. It works with any modern bundler (Vite, webpack 5,
Rollup, esbuild) and in Node 20 or later for the operations that don't need a
browser.

## Configure assets (once, at start-up)

Page previews use the pdf.js worker, and Protect / Unlock uses qpdf compiled
to WebAssembly. Your bundler has to serve these files, so tell the package where
they are.

**Vite:**

```js
import { configurePdf } from "@kitsy/pdf";
import { viteAssets } from "@kitsy/pdf/vite";

configurePdf({ ...viteAssets, producer: "My App" });
```

`viteAssets` resolves both files from `@kitsy/pdf`'s own dependencies, so the
worker always matches the pdf.js version in use.

**Other bundlers:** copy these files into your public folder, then pass their
URLs:

- `node_modules/pdfjs-dist/build/pdf.worker.min.mjs`
- `node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm`

Use the `pdfjs-dist` copy that `@kitsy/pdf` itself resolves (`npm ls pdfjs-dist`).
pdf.js requires the worker and the library to be the same version.

```js
configurePdf({
  pdfjsWorkerSrc: "/pdf.worker.min.mjs",
  qpdfWasmUrl: "/qpdf.wasm",
});
```

| Option | Needed for | Notes |
| --- | --- | --- |
| `pdfjsWorkerSrc` | Previews, Organize, PDF to images, visible-signature preview | Required for those tools |
| `qpdfWasmUrl` | Protect / unlock | Required for that tool |
| `pdfjsAssetsBase` | Rendering CJK text and unembedded standard fonts | Optional. A folder containing `cmaps/` and `standard_fonts/` copied from `pdfjs-dist` |
| `producer` | The Producer field of PDFs created from scratch | Default `"@kitsy/pdf"` |

Tools that need a missing URL throw an error naming the option.

## Core usage

Every function takes `ArrayBuffer` or `Uint8Array` input and returns
`Uint8Array` output.

```js
import { mergePdfs, splitPdf, stampPdf, protectPdf, browserQpdf } from "@kitsy/pdf";

const merged = await mergePdfs([
  { name: "a.pdf", bytes: aBytes },
  { name: "b.pdf", bytes: bBytes, pages: "1-3, 5" },
]);

const parts = await splitPdf(merged, { mode: "every", every: 2 });
// parts: [{ name, pageIndices, bytes }, ...]

const stamped = await stampPdf(merged, {
  watermark: { text: "CONFIDENTIAL", opacity: 0.15 },
  pageNumbers: { format: "Page {n} of {total}", position: "bottom-center" },
});

const { bytes: locked } = await protectPdf(stamped, { userPassword: "s3cret", print: "low" }, browserQpdf);
```

### Digital signatures with a certificate

```js
import { readPkcs12, webCryptoSigner, signPdfWithCertificate, verifyPdfSignatures } from "@kitsy/pdf";

const identity = readPkcs12(pfxBytes, password); // throws CertificatePasswordError on a wrong password
const signer = await webCryptoSigner(identity); // private key becomes a non-extractable CryptoKey
identity.privateKeyPkcs8.fill(0);

const signed = await signPdfWithCertificate(pdfBytes, signer, {
  reason: "I approve this document",
  location: "Bengaluru",
  visible: { pageIndex: 0, x: 0.6, y: 0.88, width: 0.38, height: 0.09 }, // or null
});

const [check] = await verifyPdfSignatures(signed);
// { intact: true, coversWholeFile: true, signer: { commonName, ... }, signingTime, ... }
```

Details:

- Signatures are PAdES baseline B (`ETSI.CAdES.detached`) using SHA-256 and
  RSA. Adobe Reader, poppler (`pdfsig`) and OpenSSL validate them.
- `.pfx` / `.p12` files with modern (AES) or legacy (3DES / RC2) encryption are
  supported. Only RSA keys are supported.
- `signer` is any object of the form `{ certificate, chain?, sign(bytes) }`
  (`RawSigner`). You can plug in a hardware token or remote signer by
  implementing `sign`.
- `verifyPdfSignatures` checks integrity, whether anything was added after
  signing, and the certificate details. It does **not** check whether the
  certificate is trusted or revoked.

## React usage

Each component is a full page. Load them lazily through the per-tool subpaths:

```jsx
import { lazy, Suspense } from "react";
import { PdfToolsProvider } from "@kitsy/pdf/react";

const MergePdf = lazy(() => import("@kitsy/pdf/react/merge"));

export function MergePage() {
  return (
    <PdfToolsProvider
      backLink={{ href: "/tools", label: "All tools" }}
      renderLink={({ href, className, children }) => (
        <RouterLink to={href} className={className}>{children}</RouterLink>
      )}
    >
      <Suspense fallback={null}>
        <MergePdf />
      </Suspense>
    </PdfToolsProvider>
  );
}
```

`PdfToolsProvider` is optional. It accepts:

- `backLink`: `{ href, label? }`, shown under each tool. Omit it to hide the
  link.
- `renderLink`: renders links with your router. The default is a plain `<a>`.
- `header`: a React node shown above the title card, such as your app's
  navigation.
- `className`: classes for the outer wrapper. The default is `py-8 sm:py-12`.

### Styling

The components use [Tailwind CSS](https://tailwindcss.com) utility classes.
Dark mode is driven by a `dark` class on `<html>` or any ancestor element.

- **Your app uses Tailwind v4:** add the package to your sources, and use a
  class-based dark variant:

  ```css
  @import "tailwindcss";
  @source "../node_modules/@kitsy/pdf/dist";
  @custom-variant dark (&:where(.dark, .dark *));
  ```

- **Your app doesn't use Tailwind:** import the prebuilt stylesheet. It is
  about 32 KB, and its reset applies only inside the tools' root element.

  ```js
  import "@kitsy/pdf/styles.css";
  ```

Icons use [Font Awesome 6 Free](https://fontawesome.com) class names
(`fa-solid ...`). Load Font Awesome in your app if you want them. Without it,
the tools still work but show no icons.

## Browser support

Current Chrome, Edge, Firefox and Safari. These APIs are required:

- WebCrypto (`crypto.subtle`)
- WebAssembly
- `DecompressionStream`
- `createImageBitmap`

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build   # dist/ with JS, type definitions and styles.css
pnpm pack        # inspect exactly what would be published
```

## Publishing

1. Update the version in `package.json` and `CHANGELOG.md`.
2. `pnpm run check` (typecheck, tests, build). `prepublishOnly` runs it
   again.
3. `npm publish`. `publishConfig.registry` in `package.json` always sends
   it to the public npm registry (registry.npmjs.org), even if your `.npmrc`
   maps the `@kitsy` scope to a private registry. Log in there first with
   `npm login --registry=https://registry.npmjs.org/`, as a member of the
   `kitsy` npm organisation (with 2FA if the organisation requires it).

## License

[Apache-2.0](LICENSE). Copyright 2026 HEYPKV INNOVATIONS PRIVATE LIMITED.
Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
