import { describe, expect, it } from "vitest";
import { dpiToScale, imageFileName, renderedSize } from "./pdfToImagesCore";

describe("pdf to images helpers", () => {
  it("converts DPI to a render scale", () => {
    expect(dpiToScale(72)).toBe(1);
    expect(dpiToScale(144)).toBe(2);
    expect(dpiToScale(0)).toBe(1);
  });

  it("zero-pads page numbers so files sort in order", () => {
    expect(imageFileName("report", 7, 12, "png")).toBe("report-page-07.png");
    expect(imageFileName("report", 3, 9, "jpeg")).toBe("report-page-3.jpg");
  });

  it("computes the rendered pixel size", () => {
    expect(renderedSize(612, 792, 150)).toEqual({ width: 1275, height: 1650 });
  });
});
