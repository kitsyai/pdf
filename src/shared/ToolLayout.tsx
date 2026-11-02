import React, { createContext, useContext, useRef, useState, type ReactNode } from "react";

export type PdfToolsLinkProps = { href: string; className: string; children: ReactNode };

export type PdfToolsOptions = {
  /** Link shown at the bottom of each tool, e.g. back to your tool list. Omit to hide it. */
  backLink?: { href: string; label?: string } | null;
  /** Render links with your router (defaults to a plain <a>). */
  renderLink?: (props: PdfToolsLinkProps) => ReactNode;
  /** Rendered above the tool's title card, e.g. your app's navigation. */
  header?: ReactNode;
  /** Extra classes for the outer page wrapper (spacing, background). */
  className?: string;
};

const PdfToolsContext = createContext<PdfToolsOptions>({});

/** Optional: configures navigation and page chrome for every tool inside it. */
export function PdfToolsProvider({ children, ...options }: PdfToolsOptions & { children: ReactNode }) {
  return <PdfToolsContext.Provider value={options}>{children}</PdfToolsContext.Provider>;
}

const pageShellClass =
  "relative overflow-hidden bg-[radial-gradient(circle_at_top_left,_#e0f2fe_0%,_#f8fafc_42%,_#eef2ff_100%)] dark:bg-none dark:bg-slate-950";
const pageContainerClass = "relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10";
const glassPanelClass =
  "rounded-3xl border border-slate-200/80 bg-white/80 shadow-lg shadow-slate-200/60 backdrop-blur dark:border-white/8 dark:bg-slate-950/72 dark:shadow-none";

export const primaryButtonClass =
  "inline-flex items-center gap-2 rounded-xl border border-[#1F8CFF] bg-[#1F8CFF] px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-[#1579E6] disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800";

export const iconButtonClass =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800";

export const inputClass =
  "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm normal-case tracking-normal text-slate-900 outline-none focus:border-[#1F8CFF] disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

export const fieldLabelClass =
  "block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300";

export const cardClass =
  "rounded-2xl border border-slate-200 bg-white/90 p-3 sm:p-4 dark:border-slate-700 dark:bg-slate-900/80";

export function PdfToolPage({ title, description, stats = [], children }) {
  const { header, className = "py-8 sm:py-12" } = useContext(PdfToolsContext);
  return (
    <div className={`kitsy-pdf ${pageShellClass} ${className}`}>
      <div className={pageContainerClass}>
        {header}

        <section className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-gradient-to-br from-slate-900 via-slate-800 to-rose-900 p-8 text-white shadow-2xl shadow-slate-300/40 sm:p-10">
          <div className="absolute -right-20 -top-16 h-52 w-52 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -left-16 bottom-0 h-36 w-36 rounded-full bg-rose-300/20 blur-3xl" />

          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-rose-200/90">
                PDF Utility
              </p>
              <h1 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">{title}</h1>
              <p className="mt-4 text-base text-slate-200">{description}</p>
            </div>

            {stats.length ? (
              <div className="grid grid-cols-2 gap-3">
                {stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center backdrop-blur"
                  >
                    <p className="text-2xl font-semibold">{stat.value}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-200">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        {children}
      </div>
    </div>
  );
}

/** Main form panel plus a 20rem side panel, matching the other app pages. */
export function PdfToolColumns({ main, side }) {
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className={`${glassPanelClass} p-5 sm:p-6`}>{main}</section>
      <section className={`${glassPanelClass} p-5 sm:p-6`}>{side}</section>
    </div>
  );
}

export function SideTips({ tips }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300">
      <p className="font-semibold text-slate-800 dark:text-slate-200">Tips</p>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        {tips.map((tip, index) => (
          <li key={index}>{tip}</li>
        ))}
      </ul>
    </div>
  );
}

export function SummaryList({ items }) {
  return (
    <dl className="mt-4 space-y-2 text-sm">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex justify-between gap-3 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/80"
        >
          <dt className="text-slate-600 dark:text-slate-300">{item.label}</dt>
          <dd className="truncate font-semibold text-slate-900 dark:text-slate-100">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatusBanner({ status }) {
  let toneClass =
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300";
  if (status.tone === "error") {
    toneClass =
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300";
  } else if (status.tone === "success") {
    toneClass =
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
  }

  return (
    <div role="status" className={`mt-4 rounded-xl border px-4 py-3 text-sm ${toneClass}`}>
      {status.text}
    </div>
  );
}

export function FileDropzone({
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  title,
  hint,
  icon = "fa-solid fa-file-pdf",
}) {
  const inputRef = useRef(null);
  const [isDropActive, setIsDropActive] = useState(false);

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDropActive(false);
    if (!disabled) onFiles(Array.from(event.dataTransfer.files || []));
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDropActive(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setIsDropActive(false);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event) => {
          onFiles(Array.from(event.target.files || []));
          event.target.value = "";
        }}
        disabled={disabled}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        disabled={disabled}
        className={`group w-full rounded-2xl border-2 border-dashed p-8 text-left transition ${
          isDropActive
            ? "border-[#1F8CFF] bg-blue-50 dark:bg-blue-500/10"
            : "border-slate-300 bg-white hover:border-[#1F8CFF] hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/70 dark:hover:border-[#1F8CFF] dark:hover:bg-slate-800"
        }`}
      >
        <div className="flex flex-col items-center text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1F8CFF]/10 text-[#1F8CFF]">
            <i className={`${icon} text-xl`} />
          </span>
          <p className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</p>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{hint}</p>
        </div>
      </button>
    </>
  );
}

export function BackToPdfTools() {
  const { backLink, renderLink } = useContext(PdfToolsContext);
  if (!backLink) return null;
  const children = (
    <>
      <i className="fa-solid fa-arrow-left" />
      {backLink.label || "Back to PDF Tools"}
    </>
  );
  return renderLink ? (
    <>{renderLink({ href: backLink.href, className: secondaryButtonClass, children })}</>
  ) : (
    <a href={backLink.href} className={secondaryButtonClass}>
      {children}
    </a>
  );
}

export function SelectedPdfCard({ file, pageCount, onRemove, disabled, detail = undefined, signed = false }) {
  const card = (
    <div className={`mt-5 flex items-center gap-3 ${cardClass}`}>
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-300">
        <i className="fa-solid fa-file-pdf" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{file.name}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {detail ?? (pageCount ? `${pageCount} page${pageCount === 1 ? "" : "s"}` : "reading...")}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className={iconButtonClass}
        aria-label={`Remove ${file.name}`}
      >
        <i className="fa-solid fa-xmark" />
      </button>
    </div>
  );
  if (!signed) return card;
  return (
    <>
      {card}
      <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
        <i className="fa-solid fa-triangle-exclamation mr-1" />
        This PDF is digitally signed. Saving a changed copy will invalidate its signature; the original file is not changed.
      </p>
    </>
  );
}
