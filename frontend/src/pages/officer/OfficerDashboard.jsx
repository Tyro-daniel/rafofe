import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { officerApi } from "../../api/officer";
import { Card } from "../../components/ui/Card";
import { Skeleton } from "../../components/ui/Skeleton";
import { formatMoney } from "../../utils/format";
import "./OfficerDashboard.css";

export function OfficerDashboard() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    officerApi.dashboardSummary().then(setSummary).catch((err) => setError(err.message));
  }, []);

  return (
    <div className="stack gap-5">
      <div>
        <h1>Portfolio overview</h1>
        <p>A snapshot of applications, active loans, and collections.</p>
      </div>

      {error && <Card className="dashboard-error">{error}</Card>}

      <div className="metrics-grid">
        <MetricCard label="Pending applications" value={summary?.pendingApplications} to="/applications?status=submitted" loading={!summary} />
        <MetricCard label="Active loans" value={summary?.activeLoans} loading={!summary} />
        <MetricCard label="Delinquent loans" value={summary?.delinquentLoans} tone="danger" to="/portfolio-at-risk" loading={!summary} />
        <MetricCard label="Outstanding portfolio" value={summary && formatMoney(summary.outstandingPortfolio)} loading={!summary} money />
        <MetricCard label="Total disbursed" value={summary && formatMoney(summary.totalDisbursed)} loading={!summary} money />
        <MetricCard label="Total collected" value={summary && formatMoney(summary.totalCollected)} loading={!summary} money tone="success" />
      </div>
    </div>
  );
}

function MetricCard({ label, value, to, tone, loading, money }) {
  const content = (
    <Card className={`metric-card ${tone ? `metric-card-${tone}` : ""}`}>
      <span className="metric-label">{label}</span>
      {loading ? <Skeleton width="4rem" height="1.75rem" /> : <span className={`metric-value ${money ? "figure" : ""}`}>{value}</span>}
    </Card>
  );
  return to ? <Link to={to} className="metric-link">{content}</Link> : content;
}
