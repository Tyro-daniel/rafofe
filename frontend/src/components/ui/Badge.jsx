import React from "react";
import "./Badge.css";

// Central place mapping a domain status string -> visual tone, so a new
// page never has to re-decide what color "declined" should be.
const STATUS_TONES = {
  submitted: "info", under_review: "info", pending: "info", upcoming: "info",
  approved: "success", active: "success", verified: "success", paid: "success", resolved: "success",
  declined: "danger", written_off: "danger", rejected: "danger", overdue: "danger",
  delinquent: "warning", partially_paid: "warning", due: "warning", in_progress: "warning",
  closed: "neutral", escalated_nbfira: "danger",
};

export function Badge({ status, children, tone }) {
  const resolvedTone = tone || STATUS_TONES[status] || "neutral";
  const label = children || (status ? status.replace(/_/g, " ") : "");
  return <span className={`badge badge-${resolvedTone}`}>{label}</span>;
}
