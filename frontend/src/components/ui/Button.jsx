import React from "react";
import "./Button.css";

/**
 * variant: "primary" | "secondary" | "ghost" | "danger"
 * size: "md" | "sm"
 */
export function Button({ variant = "primary", size = "md", loading = false, disabled, children, ...rest }) {
  return (
    <button
      className={`btn btn-${variant} btn-${size}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="btn-spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}
