import React, { useEffect, useState, useRef } from "react";
import { FiUploadCloud, FiCheckCircle, FiClock, FiXCircle } from "react-icons/fi";
import { kycApi } from "../../api/kyc";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { formatDate } from "../../utils/format";
import "./Documents.css";

const DOC_TYPES = [
  { type: "national_id", label: "National ID", hint: "A clear photo or scan of your Omang or passport." },
  { type: "payslip", label: "Most recent payslip", hint: "Used to confirm your income for the application." },
  { type: "proof_of_address", label: "Proof of address", hint: "A recent utility bill or bank statement." },
];

export function Documents() {
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState("");
  const [uploadingType, setUploadingType] = useState(null);
  const fileInputRefs = useRef({});

  function refresh() {
    kycApi.myDocuments().then(setDocuments).catch((err) => setError(err.message));
  }

  useEffect(refresh, []);

  function latestFor(type) {
    return documents?.find((d) => d.doc_type === type);
  }

  async function handleFileChange(type, file) {
    if (!file) return;
    setError("");
    setUploadingType(type);
    try {
      await kycApi.upload(file, type);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingType(null);
    }
  }

  return (
    <div className="stack gap-5">
      <div>
        <h1>Your documents</h1>
        <p>
          Upload clear photos or PDFs. Per Botswana microlending regulations, we keep verified digital copies only —
          please don't hand over your original physical documents to anyone.
        </p>
      </div>

      {error && <Card className="dashboard-error">{error}</Card>}

      <div className="doc-grid">
        {DOC_TYPES.map(({ type, label, hint }) => {
          const doc = latestFor(type);
          return (
            <Card key={type} className="doc-card">
              <div className="doc-card-header">
                <h3>{label}</h3>
                <StatusPill status={doc?.status} />
              </div>
              <p className="doc-hint">{hint}</p>

              {doc && (
                <div className="doc-current">
                  <span>{doc.original_name}</span>
                  <span className="doc-date">Uploaded {formatDate(doc.uploaded_at)}</span>
                  {doc.status === "rejected" && doc.rejection_reason && (
                    <p className="doc-rejection">Reason: {doc.rejection_reason}</p>
                  )}
                </div>
              )}

              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                ref={(el) => (fileInputRefs.current[type] = el)}
                onChange={(e) => handleFileChange(type, e.target.files?.[0])}
                className="visually-hidden"
                aria-label={`Upload ${label}`}
              />
              <Button
                variant="secondary"
                size="sm"
                loading={uploadingType === type}
                onClick={() => fileInputRefs.current[type]?.click()}
              >
                <FiUploadCloud /> {doc ? "Replace file" : "Upload file"}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ status }) {
  if (!status) return <span className="status-pill status-pill-neutral"><FiClock /> Not uploaded</span>;
  if (status === "verified") return <span className="status-pill status-pill-success"><FiCheckCircle /> Verified</span>;
  if (status === "rejected") return <span className="status-pill status-pill-danger"><FiXCircle /> Rejected</span>;
  return <span className="status-pill status-pill-warning"><FiClock /> Pending review</span>;
}
