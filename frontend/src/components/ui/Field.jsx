import React, { useId } from "react";
import "./Field.css";

/**
 * Labeled form field wrapper — every input in the app should go through
 * this so label association, error messaging, and spacing stay consistent
 * without every page re-implementing them (and potentially getting the
 * label/input `for`/`id` accessibility link wrong).
 */
export function Field({ label, error, hint, required, children }) {
  const id = useId();
  const child = React.cloneElement(children, {
    id,
    "aria-invalid": error ? "true" : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  });

  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
        {required && <span className="field-required" aria-hidden="true"> *</span>}
      </label>
      {child}
      {error ? (
        <p id={`${id}-error`} className="field-error" role="alert">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput(props) {
  return <input className="text-input" {...props} />;
}

export function Select({ children, ...props }) {
  return (
    <select className="text-input" {...props}>
      {children}
    </select>
  );
}

export function TextArea(props) {
  return <textarea className="text-input" rows={4} {...props} />;
}
