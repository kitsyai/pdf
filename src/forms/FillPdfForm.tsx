import React, { useCallback, useEffect, useMemo, useState } from "react";
import { downloadBlob, formatBytes, toBaseName } from "../shared/files";
import {
  BackToPdfTools,
  FileDropzone,
  PdfToolColumns,
  PdfToolPage,
  SelectedPdfCard,
  SideTips,
  StatusBanner,
  SummaryList,
  cardClass,
  fieldLabelClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../shared/ToolLayout";
import { useSinglePdf } from "../shared/useSinglePdf";
import { fillForm, readFormFields } from "./fillFormCore";

/** "topmostSubform[0].Page1[0].FirstName[0]" -> "FirstName". */
function friendlyName(name) {
  const last = name.split(".").pop() || name;
  return last.replace(/\[\d+\]$/, "").replace(/[_-]+/g, " ").trim() || name;
}

function initialValues(fields) {
  return Object.fromEntries(fields.map((field) => [field.name, field.value]));
}

function FieldInput({ field, value, onChange, disabled }) {
  const id = `field-${field.name}`;
  const locked = disabled || field.readOnly;

  if (field.kind === "checkbox") {
    return (
      <label htmlFor={id} className="flex items-center gap-3 text-sm text-slate-800 dark:text-slate-200">
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          disabled={locked}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 accent-[#1F8CFF]"
        />
        {friendlyName(field.name)}
        {field.required ? <span className="text-rose-600">*</span> : null}
      </label>
    );
  }

  const label = (
    <span className={fieldLabelClass} title={field.name}>
      {friendlyName(field.name)}
      {field.required ? <span className="ml-1 text-rose-600">*</span> : null}
      {field.readOnly ? <span className="ml-2 normal-case tracking-normal text-slate-400">(read-only)</span> : null}
    </span>
  );

  if (field.kind === "radio") {
    return (
      <fieldset disabled={locked}>
        <legend>{label}</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {field.options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
              <input
                type="radio"
                name={id}
                checked={value === option}
                onChange={() => onChange(option)}
                className="h-4 w-4 accent-[#1F8CFF]"
              />
              {option}
            </label>
          ))}
          <button type="button" onClick={() => onChange("")} className="text-xs text-slate-500 underline">
            Clear
          </button>
        </div>
      </fieldset>
    );
  }

  if (field.kind === "dropdown") {
    return (
      <label htmlFor={id} className="block">
        {label}
        <select id={id} value={value} disabled={locked} onChange={(event) => onChange(event.target.value)} className={`mt-2 ${inputClass}`}>
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.kind === "list") {
    return (
      <label htmlFor={id} className="block">
        {label}
        <select
          id={id}
          multiple={field.multiSelect}
          value={field.multiSelect ? value : value[0] ?? ""}
          disabled={locked}
          onChange={(event) =>
            onChange(Array.from(event.target.selectedOptions, (option) => option.value).filter(Boolean))
          }
          className={`mt-2 ${inputClass}`}
        >
          {field.multiSelect ? null : <option value="">—</option>}
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.kind === "text") {
    const props = {
      id,
      value,
      disabled: locked,
      maxLength: field.maxLength,
      onChange: (event) => onChange(event.target.value),
      className: `mt-2 ${inputClass}`,
    };
    return (
      <label htmlFor={id} className="block">
        {label}
        {field.multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}
        {field.maxLength ? (
          <span className="mt-1 block text-right text-[11px] text-slate-400">
            {String(value).length}/{field.maxLength}
          </span>
        ) : null}
      </label>
    );
  }

  return (
    <div>
      {label}
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {field.kind === "signature"
          ? "Signature field: use Sign PDF to add a visible signature."
          : "Button: nothing to fill."}
      </p>
    </div>
  );
}

export default function FillPdfForm() {
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [hasXfa, setHasXfa] = useState(false);
  const [flatten, setFlatten] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState({
    tone: "info",
    text: "Add a PDF form to fill in its fields.",
  });

  useEffect(() => {
    document.title = "Fill PDF Forms | Apps";
  }, []);

  const onError = useCallback((text) => setStatus({ tone: "error", text }), []);
  const onLoaded = useCallback(async ({ file, bytes }) => {
    try {
      const result = await readFormFields(bytes);
      setFields(result.fields);
      setValues(initialValues(result.fields));
      setHasXfa(result.hasXfa);
      setStatus(
        result.fields.length
          ? { tone: "success", text: `${file.name} has ${result.fields.length} field${result.fields.length === 1 ? "" : "s"}. Fill them in and download.` }
          : { tone: "info", text: `${file.name} has no fillable form fields. Use Sign PDF or Watermark to add text instead.` }
      );
    } catch (error) {
      setStatus({ tone: "error", text: error?.message || "Could not read this PDF." });
    }
  }, []);
  const pdf = useSinglePdf({ onError, onLoaded });

  const groups = useMemo(() => {
    const byPage = new Map();
    for (const field of fields) {
      const key = field.page ?? 0;
      if (!byPage.has(key)) byPage.set(key, []);
      byPage.get(key).push(field);
    }
    return [...byPage.entries()].sort(([a], [b]) => (a || Infinity) - (b || Infinity));
  }, [fields]);

  const editable = fields.filter((field) => !field.readOnly && field.kind !== "button" && field.kind !== "signature");
  const missingRequired = editable.filter((field) => {
    const value = values[field.name];
    return field.required && (Array.isArray(value) ? !value.length : !value);
  });

  const clearFile = () => {
    pdf.clear();
    setFields([]);
    setValues({});
    setHasXfa(false);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!pdf.bytes || !editable.length) return;
    setIsSaving(true);
    setStatus({ tone: "info", text: "Filling your PDF..." });
    try {
      const bytes = await fillForm(pdf.bytes, values, { flatten });
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, `${toBaseName(pdf.file.name, "form")}-filled.pdf`);
      setStatus({
        tone: "success",
        text: `Saved (${formatBytes(blob.size)})${flatten ? " with answers locked in" : ""}. Your download has started.${
          missingRequired.length ? ` Note: ${missingRequired.length} required field${missingRequired.length === 1 ? " is" : "s are"} still empty.` : ""
        }`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: `Could not fill the form: ${error?.message || "Please try again."}` });
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isSaving || pdf.isReading;

  return (
    <PdfToolPage
      title="Fill PDF Forms"
      description="Fill in the text boxes, checkboxes, and choices of a PDF form, then download it, optionally locked so answers can't be changed. Runs in your browser; your answers never leave your device."
      stats={[
        { value: fields.length || "-", label: "Fields" },
        { value: pdf.pageCount || "-", label: "Pages" },
      ]}
    >
      <PdfToolColumns
        main={
          <form onSubmit={handleSave}>
            {pdf.file ? (
              <SelectedPdfCard
                signed={pdf.signed} file={pdf.file} pageCount={pdf.pageCount} onRemove={clearFile} disabled={isSaving} />
            ) : (
              <FileDropzone
                accept=".pdf,application/pdf"
                disabled={busy}
                onFiles={pdf.selectFiles}
                title="Drag and drop a PDF form here"
                hint="or click to browse from your device"
              />
            )}

            {hasXfa ? (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                This form also contains an XFA (Adobe LiveCycle) version. It is removed when you save so every viewer shows
                the answers you enter here.
              </p>
            ) : null}

            {groups.map(([page, pageFields]) => (
              <section key={page} className={`mt-5 ${cardClass}`}>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {page ? `Page ${page}` : "Not on a page"}
                </h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {pageFields.map((field) => (
                    <div key={field.name} className={field.multiline || field.kind === "radio" ? "sm:col-span-2" : ""}>
                      <FieldInput
                        field={field}
                        value={values[field.name]}
                        disabled={busy}
                        onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}

            {fields.length ? (
              <label className="mt-5 flex items-start gap-3 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={flatten}
                  onChange={(event) => setFlatten(event.target.checked)}
                  disabled={busy}
                  className="mt-0.5 h-4 w-4 accent-[#1F8CFF]"
                />
                <span>
                  Lock answers (flatten)
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Draws your answers into the page and removes the form, so they can't be edited.
                  </span>
                </span>
              </label>
            ) : null}

            <StatusBanner status={status} />

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="submit" disabled={busy || !editable.length} className={primaryButtonClass}>
                <i className={`fa-solid ${isSaving ? "fa-spinner fa-spin" : "fa-pen-to-square"}`} />
                {isSaving ? "Saving..." : "Fill & Download"}
              </button>
              <button
                type="button"
                onClick={() => setValues(initialValues(fields))}
                disabled={busy || !fields.length}
                className={secondaryButtonClass}
              >
                <i className="fa-solid fa-arrow-rotate-left" />
                Reset
              </button>
              <BackToPdfTools />
            </div>
          </form>
        }
        side={
          <>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Summary</h2>
            <SummaryList
              items={[
                { label: "Fillable fields", value: pdf.file ? editable.length : "-" },
                { label: "Required, still empty", value: pdf.file ? missingRequired.length : "-" },
              ]}
            />
            <SideTips
              tips={[
                "Hover a field label to see its full internal name.",
                "Answers use Helvetica, so basic Latin characters only.",
                "Scanned forms without real fields can be filled with Sign PDF → Type.",
              ]}
            />
          </>
        }
      />
    </PdfToolPage>
  );
}
