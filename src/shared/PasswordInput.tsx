import React, { useState } from "react";
import { fieldLabelClass, inputClass } from "./ToolLayout";

/** A password field with a show/hide toggle; the hint is linked via aria-describedby. */
export function PasswordInput({ id, label, value, onChange, disabled, autoComplete = "new-password", hint = "", inputRef = undefined }) {
  const [visible, setVisible] = useState(false);
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <input
          id={id}
          ref={inputRef}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-describedby={hint ? hintId : undefined}
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          className="shrink-0 text-xs font-semibold normal-case tracking-normal text-[#1F8CFF]"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
