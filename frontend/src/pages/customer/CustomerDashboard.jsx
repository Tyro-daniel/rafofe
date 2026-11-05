import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiArrowRight, FiFileText } from "react-icons/fi";
import { loansApi } from "../../api/loans";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { formatMoney, formatDate } from "../../utils/format";
import "./CustomerDashboard.css";

export function CustomerDashboard() {
  const [applications, setApplications] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([loansApi.myApplications(), loansApi.myAccounts()])
      .then(([apps, accts]) => {
        if (cancelled) return;
        setApplications(apps);
        setAccounts(accts);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, []);

  const loading = applications === null || accounts === null;
  const activeAccounts = accounts?.filter((a) => a.status === "active" || a.status === "delinquent") || [];
  const totalOutstanding = activeAccounts.reduce((sum, a) => sum + Number(a.principal), 0);

  return (
    <div className="stack gap-5">
      <div>
        <h1>Your loans</h1>
        <p>Track your applications, active loans, and repayment schedules.</p>
      </div>

      {error && <Card className="dashboard-error">{error}</Card>}

      <div className="summary-grid">
        <Card className="summary-card">
          <span className="summary-label">Active loans</span>
          {loading ? <Skeleton width="3rem" height="2rem" /> : <span className="summary-value">{activeAccounts.length}</span>}
        </Card>
        <Card className="summary-card">
          <span className="summary-label">Outstanding principal</span>
          {loading ? <Skeleton width="6rem" height="2rem" /> : <span className="summary-value figure">{formatMoney(totalOutstanding)}</span>}
        </Card>
        <Card className="summary-card summary-card-accent">
          <span className="summary-label">Need funds?</span>
          <Link to="/apply">
            <Button size="sm" style={{ marginTop: "0.5rem" }}>Apply for a loan <FiArrowRight /></Button>
          </Link>
        </Card>
      </div>

      <section>
        <h2>Active loans</h2>
        {loading ? (
          <Card><Skeleton height="4rem" /></Card>
        ) : activeAccounts.length === 0 ? (
          <Card>
            <EmptyState
              icon={<FiFileText />}
              title="No active loans yet"
              description="Once an application is approved, your loan and repayment schedule will show up here."
            />
          </Card>
        ) : (
          <div className="stack gap-3">
            {activeAccounts.map((acct) => (
              <Link to={`/loans/${acct.id}`} key={acct.id} className="loan-row-link">
                <Card className="loan-row">
                  <div>
                    <div className="loan-row-title">Loan #{acct.id}</div>
                    <div className="loan-row-meta">{acct.tenure_months} months · {acct.monthly_rate_pct}% per month</div>
                  </div>
                  <div className="loan-row-amount">
                    <span className="figure">{formatMoney(acct.principal)}</span>
                    <Badge status={acct.status} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>Application history</h2>
        {loading ? (
          <Card><Skeleton height="3rem" /></Card>
        ) : applications.length === 0 ? (
          <Card>
            <EmptyState title="No applications yet" description="Your submitted applications will appear here." />
          </Card>
        ) : (
          <Card padded={false}>
            <table className="data-table">
              <thead>
                <tr><th>Product</th><th>Amount</th><th>Submitted</th><th>Status</th></tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id}>
                    <td>{app.product_name}</td>
                    <td className="figure">{formatMoney(app.amount_requested)}</td>
                    <td>{formatDate(app.created_at)}</td>
                    <td><Badge status={app.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
