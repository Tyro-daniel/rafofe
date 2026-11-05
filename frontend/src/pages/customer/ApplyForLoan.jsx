import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { loansApi } from "../../api/loans";
import { Card } from "../../components/ui/Card";
import { Field, TextInput, Select, TextArea } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { formatMoney } from "../../utils/format";
import { estimateMonthlyInstallment } from "../../utils/loanMath";
import { ApiError } from "../../api/client";
import "./ApplyForLoan.css";

export function ApplyForLoan() {
  const navigate = useNavigate();
  const [products, setProducts] = useState(null);
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [tenure, setTenure] = useState("");
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loansApi.listProducts().then((list) => {
      setProducts(list);
      if (list.length > 0) {
        setProductId(String(list[0].id));
        setAmount(String(list[0].min_amount));
        setTenure(String(list[0].min_tenure_months));
      }
    }).catch((err) => setError(err.message));
  }, []);

  const selectedProduct = products?.find((p) => String(p.id) === productId);

  // Live installment estimate — this is client-side arithmetic purely for
  // the user's planning purposes before they submit. It is NOT what
  // determines the real schedule: the backend independently recomputes
  // the authoritative amortization schedule at approval time using the
  // exact same reducing-balance formula (see backend
  // src/utils/amortization.js). Two implementations of the same formula
  // is a deliberate, documented duplication — see utils/loanMath.js.
  const estimate = useMemo(() => {
    if (!selectedProduct || !amount || !tenure) return null;
    return estimateMonthlyInstallment(Number(amount), Number(selectedProduct.monthly_rate_pct), Number(tenure));
  }, [selectedProduct, amount, tenure]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!selectedProduct) return;
    const amt = Number(amount);
    const ten = Number(tenure);
    if (amt < selectedProduct.min_amount || amt > selectedProduct.max_amount) {
      setError(`Amount must be between ${formatMoney(selectedProduct.min_amount)} and ${formatMoney(selectedProduct.max_amount)}.`);
      return;
    }
    if (ten < selectedProduct.min_tenure_months || ten > selectedProduct.max_tenure_months) {
      setError(`Tenure must be between ${selectedProduct.min_tenure_months} and ${selectedProduct.max_tenure_months} months.`);
      return;
    }
    if (purpose.trim().length < 3) {
      setError("Tell us briefly what the loan is for.");
      return;
    }

    setSubmitting(true);
    try {
      await loansApi.submitApplication({
        loanProductId: Number(productId),
        amountRequested: amt,
        tenureMonths: ten,
        purpose: purpose.trim(),
      });
      navigate("/", { replace: true, state: { justApplied: true } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not submit your application. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (products === null) {
    return <Card><Skeleton height="12rem" /></Card>;
  }

  if (products.length === 0) {
    return <Card>No loan products are currently available. Please check back later.</Card>;
  }

  // Large loans (above the highest self-service product's cap) are
  // deliberately NOT handled by this form at all — per the business
  // requirement, they're arranged manually with a loan officer. Deriving
  // the threshold from the actual product data (rather than a hardcoded
  // "P15,000") means this banner automatically stays correct if a future
  // admin changes the Medium Loan's max_amount, with nothing to remember
  // to update in two places.
  const highestSelfServiceCap = Math.max(...products.map((p) => Number(p.max_amount)));

  return (
    <div className="stack gap-5">
      <div>
        <h1>Apply for a loan</h1>
        <p>Choose a product and tell us how much you need — you'll see an estimated repayment before you submit.</p>
      </div>

      <Card className="large-loan-notice">
        Need more than {formatMoney(highestSelfServiceCap)}? Larger loans are arranged directly with a loan
        officer rather than through this form — please contact one of our branches to discuss your requirements.
      </Card>

      <div className="apply-layout">
        <Card className="apply-form">
          <form onSubmit={handleSubmit} noValidate>
            <Field label="Loan product" required>
              <Select value={productId} onChange={(e) => {
                const p = products.find((x) => String(x.id) === e.target.value);
                setProductId(e.target.value);
                if (p) { setAmount(String(p.min_amount)); setTenure(String(p.min_tenure_months)); }
              }}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {p.monthly_rate_pct}% per month</option>
                ))}
              </Select>
            </Field>

            {selectedProduct && (
              <Field
                label={`Amount (${formatMoney(selectedProduct.min_amount)} – ${formatMoney(selectedProduct.max_amount)})`}
                required
              >
                <TextInput
                  type="number"
                  inputMode="decimal"
                  min={selectedProduct.min_amount}
                  max={selectedProduct.max_amount}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
            )}

            {selectedProduct && (
              <Field
                label={`Tenure in months (${selectedProduct.min_tenure_months} – ${selectedProduct.max_tenure_months})`}
                required
              >
                <TextInput
                  type="number"
                  min={selectedProduct.min_tenure_months}
                  max={selectedProduct.max_tenure_months}
                  value={tenure}
                  onChange={(e) => setTenure(e.target.value)}
                />
              </Field>
            )}

            <Field label="What's the loan for?" required hint="A short description helps your loan officer review faster.">
              <TextArea value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Payment of School Fees" />
            </Field>

            {error && <p className="auth-error" role="alert">{error}</p>}

            <Button type="submit" loading={submitting} style={{ width: "100%" }}>Submit application</Button>
          </form>
        </Card>

        <Card className="apply-estimate">
          <h3>Estimated repayment</h3>
          {estimate ? (
            <>
              <div className="estimate-figure">{formatMoney(estimate.monthlyInstallment)}<span>/month</span></div>
              <dl className="estimate-details">
                <div><dt>Total repayable</dt><dd className="figure">{formatMoney(estimate.totalRepayable)}</dd></div>
                <div><dt>Total interest</dt><dd className="figure">{formatMoney(estimate.totalInterest)}</dd></div>
              </dl>
              <p className="estimate-note">This is an estimate for planning purposes. Your exact schedule is confirmed when your loan is approved.</p>
            </>
          ) : (
            <p>Enter an amount and tenure to see your estimated monthly repayment.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
