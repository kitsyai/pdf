import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "index": "src/index.ts",
    "react": "src/react.ts",
    "vite": "src/vite.ts",
    "react/merge": "src/merge/MergePdf.tsx",
    "react/split": "src/split/SplitPdf.tsx",
    "react/images-to-pdf": "src/images/ImagesToPdf.tsx",
    "react/watermark": "src/stamp/WatermarkPdf.tsx",
    "react/metadata": "src/metadata/PdfMetadata.tsx",
    "react/organize": "src/organize/OrganizePdf.tsx",
    "react/sign": "src/sign/SignPdf.tsx",
    "react/pdf-to-images": "src/toimages/PdfToImages.tsx",
    "react/compress": "src/compress/CompressPdf.tsx",
    "react/fill-form": "src/forms/FillPdfForm.tsx",
    "react/protect": "src/protect/ProtectPdf.tsx",
    "react/certificate-sign": "src/certsign/CertSignPdf.tsx",
    "react/verify-signatures": "src/certsign/VerifyPdfSignatures.tsx",
  },
  format: ["esm"],
  target: "es2022",
  platform: "browser",
  dts: true,
  splitting: true,
  treeshake: true,
  clean: true,
  sourcemap: true,
  // Dependencies stay external; @fontsource CSS imports are left for the host bundler.
  external: [/^@fontsource\//, /\?url$/, "react", "react/jsx-runtime"],
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
});
