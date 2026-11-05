import React, { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Field, TextInput } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Logo } from "../../components/layout/Logo";
import { ApiError } from "../../api/client";
import "./StaffLogin.css";

/**
 * Deliberately separate from the borrower Login page (pages/auth/Login.jsx)
 * — same underlying auth flow (calls the same POST /auth/login the
 * borrower login uses; the backend doesn't distinguish "portal type", it
 * just issues a JWT carrying whatever role the account actually has), but
 * different chrome, copy, and security framing, per the "two front doors"
 * architecture: staff shouldn't see marketing content, and this screen
 * should read as an internal enterprise tool, not a consumer app.
 *
 * NOTE ON SSO: real fintech staff portals typically offer "Sign in with
 * Microsoft / Google Workspace SSO" here. That requires a real identity
 * provider integration (Entra ID / Google Workspace app registration,
 * OAuth callback handling, etc.) that does not exist in this codebase
 * yet. Deliberately NOT shown as a button here — a button that looks
 * functional but does nothing is worse than not having it. See the
 * Technical Support & Maintenance Manual, "Future integrations" section,
 * for what real SSO would require to add.
 */
export function StaffLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await login(email, password, mfaRequired ? mfaCode : undefined);
      if (result.mfaRequired) {
        setMfaRequired(true);
        return;
      }
      const dest = location.state?.from?.pathname || "/dashboard";
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="staff-login-page">
      <div className="staff-login-brand">
        <Logo size={120} showWordmark={false} />
      </div>

      <Card className="staff-login-card">
        <span className="staff-login-tag"><span aria-hidden="true">🔒</span> Internal System Portal</span>
        <h2>Employee access only</h2>
        <p className="staff-login-subtitle">Sign in with your corporate credentials.</p>

        <form onSubmit={handleSubmit} noValidate>
          <Field label="Corporate email" required>
            <TextInput type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} disabled={mfaRequired} />
          </Field>
          <Field label="Password" required>
            <TextInput type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={mfaRequired} />
          </Field>

          {mfaRequired && (
            <Field label="6-digit authentication code" required hint="Open your authenticator app to get this code.">
              <TextInput
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
              />
            </Field>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          <Button type="submit" loading={loading} style={{ width: "100%" }}>
            {mfaRequired ? "Verify and sign in" : "Sign in"}
          </Button>
        </form>
      </Card>

      <p className="staff-login-notice">
        Unauthorized access is prohibited and monitored. This system is for authorized personnel only.
      </p>
      <Link to="/" className="staff-login-back">← Back to the public site</Link>
    </div>
  );
}
