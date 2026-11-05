import React, { useEffect, useState } from "react";
import { officerApi } from "../../api/officer";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { Skeleton } from "../../components/ui/Skeleton";
import { formatMoney } from "../../utils/format";

export function PortfolioAtRisk() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    officerApi.portfolioAtRisk().then(setRows).catch((err) => setError(err.message));
  }, []);

  return (
    <div className="stack gap-5">
      <div>
        <h1>Portfolio at risk</h1>
        <p>Active loans with at least one overdue installment, ranked by amount overdue.</p>
      </div>

      {error && <Card className="dashboard-error">{error}</Card>}

      {rows === null ? (
        <Card><Skeleton height="12rem" /></Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState title="Nothing at risk right now" description="No active loans currently have an overdue installment." /></Card>
      ) : (
        <Card padded={false}>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Loan</th><th>Borrower</th><th>Principal</th><th>Overdue installments</th><th>Overdue amount</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.loan_account_id}>
                    <td>#{r.loan_account_id}</td>
                    <td>{r.borrower}</td>
                    <td className="figure">{formatMoney(r.principal)}</td>
                    <td>{r.overdue_installments}</td>
                    <td className="figure" style={{ color: "var(--color-danger)" }}>{formatMoney(r.overdue_amount)}</td>
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
