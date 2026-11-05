import React, { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Field, TextInput } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Logo } from "../../components/layout/Logo";
import { ApiError } from "../../api/client";
import "./AuthPages.css";

export function Login() {
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
    <div className="auth-page">
      <div className="auth-page-brand">
        <Logo size={140} showWordmark={false} />
        <h1>CREDIT MANAGEMENT SYSTEM</h1>
        <p>Loan management, built for clarity.</p>
      </div>

      <Card className="auth-card">
        <h2>Welcome back</h2>
        <p className="auth-subtitle">Log in to manage your loans and applications.</p>

        <form onSubmit={handleSubmit} noValidate>
          <Field label="Email address" required>
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
            {mfaRequired ? "Verify and log in" : "Log in"}
          </Button>
        </form>

        <p className="auth-switch">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </Card>

      <p className="auth-page-footer-links">
        <Link to="/">← Back to the public site</Link>
        <span aria-hidden="true"> · </span>
        <Link to="/staff/login">Are you an employee? Staff Portal</Link>
      </p>
    </div>
  );
}
