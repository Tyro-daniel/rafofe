import React from "react";
import "./EmptyState.css";

// Per the design skill's writing guidance: an empty screen is an
// invitation to act, not just an absence notice — every usage should
// pass an `action` where there's something the user can actually do next.
export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon" aria-hidden="true">{icon}</div>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
