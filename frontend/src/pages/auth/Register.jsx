import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Field, TextInput, Select } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Logo } from "../../components/layout/Logo";
import { ApiError } from "../../api/client";
import "./AuthPages.css";

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ fullName: "", email: "", phone: "", password: "", maritalStatus: "single" });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function validate() {
    const next = {};
    if (form.fullName.trim().length < 2) next.fullName = "Enter your full name.";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) next.email = "Enter a valid email address.";
    if (form.password.length < 8) next.password = "Password must be at least 8 characters.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    if (!validate()) return;

    setLoading(true);
    try {
      await register(form);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
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
        <h2>Create your account</h2>
        <p className="auth-subtitle">Takes about a minute — you can apply for a loan right after.</p>

        <form onSubmit={handleSubmit} noValidate>
          <Field label="Full name" required error={errors.fullName}>
            <TextInput required value={form.fullName} onChange={(e) => update("fullName", e.target.value)} />
          </Field>
          <Field label="Email address" required error={errors.email}>
            <TextInput type="email" required autoComplete="username" value={form.email} onChange={(e) => update("email", e.target.value)} />
          </Field>
          <Field label="Phone number" hint="Optional, but helps us reach you about your application.">
            <TextInput type="tel" value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+267 71 234 567" />
          </Field>
          <Field label="Password" required error={errors.password} hint="At least 8 characters.">
            <TextInput type="password" required autoComplete="new-password" value={form.password} onChange={(e) => update("password", e.target.value)} />
          </Field>
          <Field
            label="Marital status"
            hint="Botswana microlending rules require a signed spousal consent form for applicants married in community of property — we'll ask for it during your application if this applies to you."
          >
            <Select value={form.maritalStatus} onChange={(e) => update("maritalStatus", e.target.value)}>
              <option value="single">Single</option>
              <option value="married_in_community">Married in community of property</option>
              <option value="married_out_of_community">Married out of community of property</option>
            </Select>
          </Field>

          {submitError && <p className="auth-error" role="alert">{submitError}</p>}

          <Button type="submit" loading={loading} style={{ width: "100%" }}>
            Create account
          </Button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </Card>

      <p className="auth-page-footer-links">
        <Link to="/">← Back to the public site</Link>
      </p>
    </div>
  );
}
