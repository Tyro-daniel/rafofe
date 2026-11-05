import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { FiArrowLeft, FiCheckCircle, FiXCircle } from "react-icons/fi";
import { loansApi } from "../../api/loans";
import { kycApi } from "../../api/kyc";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Select, Field, TextArea } from "../../components/ui/Field";
import { Skeleton } from "../../components/ui/Skeleton";
import { formatMoney, formatDate } from "../../utils/format";
import { ApiError } from "../../api/client";
import "./ApplicationDetail.css";

const DECLINE_REASONS = [
  ["insufficient_income", "Insufficient income"],
  ["incomplete_documents", "Incomplete documents"],
  ["failed_kyc", "Failed KYC/identity check"],
  ["existing_delinquency", "Existing delinquency on record"],
  ["amount_exceeds_policy", "Amount exceeds policy limit"],
  ["other", "Other"],
];

export function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [application, setApplication] = useState(null);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [declineReason, setDeclineReason] = useState(DECLINE_REASONS[0][0]);
  const [declineNotes, setDeclineNotes] = useState("");
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function refresh() {
    loansApi.getApplication(id).then(setApplication).catch((err) => setError(err.message));
  }
  useEffect(refresh, [id]);

  async function handleDocDecision(docId, status, rejectionReason) {
    try {
      await kycApi.setStatus(docId, status, rejectionReason);
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleApprove() {
    setSubmitting(true);
    setDecisionError("");
    try {
      const result = await loansApi.decideApplication(id, "approved");
      setBanner(`Approved — loan account #${result.loanAccount.id} created with a ${result.schedule.length}-month repayment schedule.`);
      refresh();
    } catch (err) {
      setDecisionError(err instanceof ApiError ? err.message : "Could not approve this application.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecline(e) {
    e.preventDefault();
    setSubmitting(true);
    setDecisionError("");
    try {
      await loansApi.decideApplication(id, "declined", { declineReasonCode: declineReason, declineNotes });
      setShowDeclineForm(false);
      refresh();
    } catch (err) {
      setDecisionError(err instanceof ApiError ? err.message : "Could not decline this application.");
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return <Card className="dashboard-error">{error}</Card>;
  if (!application) return <Card><Skeleton height="20rem" /></Card>;

  const canDecide = application.status === "submitted" || application.status === "under_review";
  const allDocsVerified = application.documents.length > 0 && application.documents.every((d) => d.status === "verified");

  return (
    <div className="stack gap-5">
      <div>
        <Link to="/applications" className="back-link"><FiArrowLeft /> Back to applications</Link>
        <div className="row justify-between wrap gap-3">
          <h1>Application #{application.id}</h1>
          <Badge status={application.status} />
        </div>
      </div>

      {banner && <Card className="banner-success">{banner}</Card>}

      <div className="app-detail-grid">
        <div className="stack gap-4">
          <Card>
            <h3>Applicant</h3>
            <dl className="detail-list">
              <div><dt>Name</dt><dd>{application.applicant_name}</dd></div>
              <div><dt>Email</dt><dd>{application.applicant_email}</dd></div>
              <div><dt>Phone</dt><dd>{application.phone || "—"}</dd></div>
              <div><dt>Marital status</dt><dd>{(application.marital_status || "unknown").replace(/_/g, " ")}</dd></div>
            </dl>
          </Card>

          <Card>
            <h3>Loan request</h3>
            <dl className="detail-list">
              <div><dt>Product</dt><dd>{application.product_name}</dd></div>
              <div><dt>Amount</dt><dd className="figure">{formatMoney(application.amount_requested)}</dd></div>
              <div><dt>Tenure</dt><dd>{application.tenure_months} months</dd></div>
              <div><dt>Interest rate (monthly)</dt><dd>{application.monthly_rate_pct}% per month</dd></div>
              <div><dt>Purpose</dt><dd>{application.purpose}</dd></div>
              <div><dt>Submitted</dt><dd>{formatDate(application.created_at)}</dd></div>
            </dl>
            {application.spousal_consent_required && (
              <p className={`consent-flag ${application.spousal_consent_provided ? "consent-ok" : "consent-missing"}`}>
                {application.spousal_consent_provided
                  ? "Spousal consent form verified."
                  : "Spousal consent form required before approval (married in community of property) — not yet verified."}
              </p>
            )}
          </Card>

          <Card>
            <h3>Documents</h3>
            {application.documents.length === 0 ? (
              <p>No documents uploaded yet.</p>
            ) : (
              <div className="stack gap-3">
                {application.documents.map((doc) => (
                  <DocumentRow key={doc.id} doc={doc} onDecide={handleDocDecision} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="stack gap-4">
          <Card className="decision-card">
            <h3>Decision</h3>
            {!canDecide ? (
              <p>This application has already been {application.status}.</p>
            ) : (
              <>
                {!allDocsVerified && (
                  <p className="decision-warning">Not all documents are verified yet. You can still decide, but review documents first where possible.</p>
                )}
                {decisionError && <p className="auth-error" role="alert">{decisionError}</p>}

                {!showDeclineForm ? (
                  <div className="stack gap-2">
                    <Button onClick={handleApprove} loading={submitting}>
                      <FiCheckCircle /> Approve &amp; disburse
                    </Button>
                    <Button variant="danger" onClick={() => setShowDeclineForm(true)} disabled={submitting}>
                      <FiXCircle /> Decline
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleDecline} className="stack gap-2">
                    <Field label="Reason" required>
                      <Select value={declineReason} onChange={(e) => setDeclineReason(e.target.value)}>
                        {DECLINE_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </Select>
                    </Field>
                    <Field label="Notes (optional)">
                      <TextArea value={declineNotes} onChange={(e) => setDeclineNotes(e.target.value)} />
                    </Field>
                    <Button type="submit" variant="danger" loading={submitting}>Confirm decline</Button>
                    <Button type="button" variant="ghost" onClick={() => setShowDeclineForm(false)} disabled={submitting}>Cancel</Button>
                  </form>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function DocumentRow({ doc, onDecide }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="doc-review-row">
      <div className="doc-review-info">
        <span className="doc-review-type">{doc.doc_type.replace(/_/g, " ")}</span>
        <span className="doc-review-name">{doc.original_name}</span>
      </div>
      <Badge status={doc.status} />
      {doc.status !== "verified" && !rejecting && (
        <div className="row gap-2">
          <Button size="sm" onClick={() => onDecide(doc.id, "verified")}>Verify</Button>
          <Button size="sm" variant="danger" onClick={() => setRejecting(true)}>Reject</Button>
        </div>
      )}
      {rejecting && (
        <form
          className="row gap-2"
          onSubmit={(e) => { e.preventDefault(); onDecide(doc.id, "rejected", reason); setRejecting(false); }}
        >
          <input
            className="text-input"
            placeholder="Reason for rejection"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            style={{ minWidth: "180px" }}
          />
          <Button size="sm" variant="danger" type="submit">Confirm</Button>
        </form>
      )}
    </div>
  );
}
