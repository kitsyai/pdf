import "@fontsource/dancing-script/400.css";
import "@fontsource/great-vibes/400.css";
import React, { useEffect, useRef, useState } from "react";
import { canvasToBlob } from "../shared/pdfRender";
import { fieldLabelClass, inputClass, primaryButtonClass, secondaryButtonClass } from "../shared/ToolLayout";
import { opaqueBounds, whiteToTransparent } from "./signatureImage";

const TABS = [
  { id: "draw", label: "Draw", icon: "fa-solid fa-pen-nib" },
  { id: "type", label: "Type", icon: "fa-solid fa-keyboard" },
  { id: "upload", label: "Upload", icon: "fa-solid fa-upload" },
];

const FONTS = [
  { family: "Dancing Script", label: "Handwritten" },
  { family: "Great Vibes", label: "Elegant" },
  { family: "Helvetica, Arial, sans-serif", label: "Plain (dates, initials)" },
];

const INKS = [
  { value: "#0f172a", label: "Black" },
  { value: "#1d4ed8", label: "Blue" },
];

/** Crop a canvas to its visible pixels (plus padding) and encode as PNG. */
async function trimToPng(canvas, padding = 8) {
  const context = canvas.getContext("2d");
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const bounds = opaqueBounds(data, canvas.width, canvas.height);
  if (!bounds) return null;

  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const width = Math.min(canvas.width - x, bounds.width + padding * 2);
  const height = Math.min(canvas.height - y, bounds.height + padding * 2);

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  out.getContext("2d").drawImage(canvas, x, y, width, height, 0, 0, width, height);
  const blob = await canvasToBlob(out, "image/png");
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    url: URL.createObjectURL(blob),
    aspect: width / height,
  };
}

function DrawPad({ ink, onReady }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    context.lineCap = "round";
    context.lineJoin = "round";
  }, []);

  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event) => {
    event.preventDefault();
    canvasRef.current.setPointerCapture(event.pointerId);
    drawing.current = true;
    last.current = point(event);
  };

  const moveTo = (event) => {
    if (!drawing.current) return;
    const context = canvasRef.current.getContext("2d");
    const next = point(event);
    // Slightly thinner strokes when moving fast, like a real pen.
    const distance = Math.hypot(next.x - last.current.x, next.y - last.current.y);
    context.strokeStyle = ink;
    context.lineWidth = Math.max(1.6, 3.2 - distance / 18);
    context.beginPath();
    context.moveTo(last.current.x, last.current.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    last.current = next;
    setHasInk(true);
  };

  const stop = () => {
    drawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={moveTo}
        onPointerUp={stop}
        onPointerCancel={stop}
        aria-label="Signature drawing area"
        className="h-40 w-full touch-none rounded-xl border border-dashed border-slate-300 bg-white dark:border-slate-600"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onReady(canvasRef.current)} disabled={!hasInk} className={primaryButtonClass}>
          <i className="fa-solid fa-check" />
          Use signature
        </button>
        <button type="button" onClick={clear} disabled={!hasInk} className={secondaryButtonClass}>
          <i className="fa-solid fa-eraser" />
          Clear
        </button>
      </div>
    </>
  );
}

function TypePad({ ink, onReady }) {
  const [text, setText] = useState("");
  const [font, setFont] = useState(FONTS[0].family);

  const render = async () => {
    const size = 120;
    const cssFont = `${size}px ${font.includes(",") ? font : `"${font}"`}`;
    await document.fonts.load(cssFont, text);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    context.font = cssFont;
    const width = Math.ceil(context.measureText(text).width) + size;
    canvas.width = width;
    canvas.height = Math.ceil(size * 1.8);
    context.font = cssFont;
    context.fillStyle = ink;
    context.textBaseline = "middle";
    context.fillText(text, size / 2, canvas.height / 2);
    onReady(canvas);
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={fieldLabelClass}>
          Your name or text
          <input
            type="text"
            value={text}
            maxLength={60}
            onChange={(event) => setText(event.target.value)}
            placeholder="Jane Doe"
            className={`mt-2 ${inputClass}`}
          />
        </label>
        <label className={fieldLabelClass}>
          Style
          <select value={font} onChange={(event) => setFont(event.target.value)} className={`mt-2 ${inputClass}`}>
            {FONTS.map((option) => (
              <option key={option.family} value={option.family}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="mt-3 flex h-24 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white px-4 text-4xl dark:border-slate-600"
        style={{ fontFamily: font.includes(",") ? font : `"${font}"`, color: ink }}
      >
        {text || <span className="text-base text-slate-400">Preview</span>}
      </div>
      <button type="button" onClick={render} disabled={!text.trim()} className={`mt-3 ${primaryButtonClass}`}>
        <i className="fa-solid fa-check" />
        Use signature
      </button>
    </>
  );
}

function UploadPad({ onReady, onError }) {
  const [removeBackground, setRemoveBackground] = useState(true);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1200 / bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      if (removeBackground) {
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        whiteToTransparent(image.data);
        context.putImageData(image, 0, 0);
      }
      onReady(canvas);
    } catch {
      onError("That image could not be read. Try a PNG or JPG.");
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <button type="button" onClick={() => inputRef.current?.click()} className={secondaryButtonClass}>
        <i className="fa-solid fa-image" />
        Choose signature image
      </button>
      <label className="mt-3 flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          checked={removeBackground}
          onChange={(event) => setRemoveBackground(event.target.checked)}
          className="h-4 w-4 accent-[#1F8CFF]"
        />
        Remove white background (for photos or scans of paper)
      </label>
    </>
  );
}

export default function SignatureCreator({ onCreate, onError }) {
  const [tab, setTab] = useState("draw");
  const [ink, setInk] = useState(INKS[0].value);

  const finish = async (canvas) => {
    const result = await trimToPng(canvas);
    if (!result) {
      onError("The signature is empty.");
      return;
    }
    onCreate(result);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
          {TABS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={tab === option.id}
              onClick={() => setTab(option.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition ${
                tab === option.id
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
              }`}
            >
              <i className={option.icon} />
              {option.label}
            </button>
          ))}
        </div>
        {tab !== "upload" ? (
          <div className="flex items-center gap-2" aria-label="Ink colour">
            {INKS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setInk(option.value)}
                aria-label={`${option.label} ink`}
                aria-pressed={ink === option.value}
                className={`h-6 w-6 rounded-full border-2 ${ink === option.value ? "border-[#1F8CFF]" : "border-transparent"}`}
                style={{ backgroundColor: option.value }}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        {tab === "draw" ? <DrawPad ink={ink} onReady={finish} /> : null}
        {tab === "type" ? <TypePad ink={ink} onReady={finish} /> : null}
        {tab === "upload" ? <UploadPad onReady={finish} onError={onError} /> : null}
      </div>
    </div>
  );
}
