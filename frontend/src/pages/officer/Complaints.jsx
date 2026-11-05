import React, { useEffect, useState } from "react";
import { officerApi } from "../../api/officer";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Select } from "../../components/ui/Field";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { formatDate } from "../../utils/format";

const STATUSES = ["open", "in_progress", "resolved", "escalated_nbfira"];

export function Complaints() {
  const [complaints, setComplaints] = useState(null);
  const [error, setError] = useState("");

  function refresh() {
    officerApi.complaints().then(setComplaints).catch((err) => setError(err.message));
  }
  useEffect(refresh, []);

  async function updateStatus(id, status) {
    try {
      await officerApi.updateComplaint(id, { status });
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="stack gap-5">
      <div>
        <h1>Complaints</h1>
        <p>Track and resolve customer complaints — required under NBFIRA's complaints-handling policy.</p>
      </div>

      {error && <Card className="dashboard-error">{error}</Card>}

      {complaints === null ? (
        <Card><Skeleton height="10rem" /></Card>
      ) : complaints.length === 0 ? (
        <Card><EmptyState title="No complaints on file" description="Customer complaints will show up here as they're submitted." /></Card>
      ) : (
        <div className="stack gap-3">
          {complaints.map((c) => (
            <Card key={c.id} className="complaint-card">
              <div className="row justify-between wrap gap-3">
                <div>
                  <strong>{c.subject}</strong>
                  <p style={{ margin: "4px 0" }}>{c.description}</p>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
                    {c.complainant} · {formatDate(c.created_at)}
                  </span>
                </div>
                <div className="stack gap-2" style={{ minWidth: "180px" }}>
                  <Badge status={c.status} />
                  <Select value={c.status} onChange={(e) => updateStatus(c.id, e.target.value)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </Select>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
