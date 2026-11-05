import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loansApi } from "../../api/loans";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Select } from "../../components/ui/Field";
import { Skeleton } from "../../components/ui/Skeleton";
import { EmptyState } from "../../components/ui/EmptyState";
import { formatMoney, formatDate } from "../../utils/format";

const STATUS_OPTIONS = ["", "submitted", "under_review", "approved", "declined"];

export function ApplicationsList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status") || "";
  const [applications, setApplications] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setApplications(null);
    loansApi.listApplications(status || undefined).then(setApplications).catch((err) => setError(err.message));
  }, [status]);

  return (
    <div className="stack gap-5">
      <div className="row justify-between wrap gap-3">
        <div>
          <h1>Applications</h1>
          <p>Review submitted applications and make decisions.</p>
        </div>
        <div style={{ width: "220px" }}>
          <Select value={status} onChange={(e) => setSearchParams(e.target.value ? { status: e.target.value } : {})}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s ? s.replace(/_/g, " ") : "All statuses"}</option>
            ))}
          </Select>
        </div>
      </div>

      {error && <Card className="dashboard-error">{error}</Card>}

      {applications === null ? (
        <Card><Skeleton height="12rem" /></Card>
      ) : applications.length === 0 ? (
        <Card><EmptyState title="No applications found" description="Try a different status filter." /></Card>
      ) : (
        <Card padded={false}>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Applicant</th><th>Product</th><th>Amount</th><th>Submitted</th><th>Status</th></tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id}>
                    <td><Link to={`/applications/${app.id}`}>{app.applicant_name}</Link></td>
                    <td>{app.product_name}</td>
                    <td className="figure">{formatMoney(app.amount_requested)}</td>
                    <td>{formatDate(app.created_at)}</td>
                    <td><Badge status={app.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
