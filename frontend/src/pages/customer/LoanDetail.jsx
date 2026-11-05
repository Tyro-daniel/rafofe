import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { FiArrowLeft } from "react-icons/fi";
import { loansApi } from "../../api/loans";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Skeleton } from "../../components/ui/Skeleton";
import { formatMoney, formatDate } from "../../utils/format";
import "./LoanDetail.css";

export function LoanDetail() {
  const { id } = useParams();
  const [statement, setStatement] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loansApi.getStatement(id).then(setStatement).catch((err) => setError(err.message));
  }, [id]);

  if (error) return <Card className="dashboard-error">{error}</Card>;
  if (!statement) return <Card><Skeleton height="20rem" /></Card>;

  const { account, schedule, summary } = statement;

  return (
    <div className="stack gap-5">
      <div>
        <Link to="/" className="back-link"><FiArrowLeft /> Back to overview</Link>
        <div className="row justify-between wrap gap-3">
          <h1>Loan #{account.id}</h1>
          <Badge status={account.status} />
        </div>
      </div>

      <div className="summary-grid">
        <Card className="summary-card">
          <span className="summary-label">Principal</span>
          <span className="summary-value figure">{formatMoney(account.principal)}</span>
        </Card>
        <Card className="summary-card">
          <span className="summary-label">Outstanding</span>
          <span className="summary-value figure">{formatMoney(summary.outstandingPrincipal)}</span>
        </Card>
        <Card className="summary-card">
          <span className="summary-label">Total paid</span>
          <span className="summary-value figure">{formatMoney(summary.totalPaid)}</span>
        </Card>
      </div>

      <section>
        <h2>Repayment schedule</h2>
        <Card padded={false}>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th><th>Due date</th><th>Principal</th><th>Interest</th><th>Total due</th><th>Balance after</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((row) => (
                  <tr key={row.id}>
                    <td>{row.installment_no}</td>
                    <td>{formatDate(row.due_date)}</td>
                    <td className="figure">{formatMoney(row.principal_due)}</td>
                    <td className="figure">{formatMoney(row.interest_due)}</td>
                    <td className="figure">{formatMoney(row.total_due)}</td>
                    <td className="figure">{formatMoney(row.closing_balance)}</td>
                    <td><Badge status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  );
}
