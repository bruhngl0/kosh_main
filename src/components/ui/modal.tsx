"use client";

import { useEffect, type ReactNode } from "react";

/** Shared modal shell. Closes on backdrop click and on Escape. */
export function Modal({
  title,
  subtitle,
  onClose,
  onSubmit,
  saving,
  submitLabel = "Save",
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit?: (form: HTMLFormElement) => void;
  saving?: boolean;
  submitLabel?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className={`form-modal inventory-modal${wide ? " form-modal-wide" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(event.currentTarget);
        }}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <small className="form-intro">{subtitle}</small>}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {onSubmit && (
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-copper" type="submit" disabled={saving}>
              {saving ? "Saving…" : submitLabel}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

type FieldProps = {
  label: string;
  name: string;
  as?: "select" | "textarea";
  full?: boolean;
  hint?: string;
  children?: ReactNode;
} & Record<string, unknown>;

export function Field({ label, name, as, full, hint, children, ...props }: FieldProps) {
  const className = `form-field${full ? " form-field-full" : ""}`;
  const control =
    as === "textarea" ? (
      <textarea name={name} className="form-textarea" {...(props as object)} />
    ) : as === "select" ? (
      <select name={name} className="form-select" {...(props as object)}>
        {children}
      </select>
    ) : (
      <input name={name} className="form-input" {...(props as object)} />
    );

  return (
    <label className={className}>
      <span>{label}</span>
      {control}
      {hint && <small>{hint}</small>}
    </label>
  );
}
