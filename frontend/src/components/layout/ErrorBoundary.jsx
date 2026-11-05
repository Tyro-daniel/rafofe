import React from "react";

/**
 * Without this, any uncaught error in a component's render path unmounts
 * the entire React tree — the user sees a blank white screen with no
 * explanation and no way to recover short of a manual refresh. This is a
 * hard requirement for a financial app, not a nice-to-have: a customer
 * mid-application should never hit a silent blank page.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // In production, send this to a real error-tracking service (e.g.
    // Sentry) — logging to console is the honest MVP baseline, not a
    // final answer. See README "Moving to production".
    console.error("Uncaught error in component tree:", error, info);
  }

  handleReload = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.wrap}>
          <div style={styles.card}>
            <h1 style={styles.title}>Something went wrong</h1>
            <p style={styles.text}>
              We hit an unexpected error. Your data is safe — nothing was lost. Try returning to the overview page.
            </p>
            <button style={styles.button} onClick={this.handleReload}>Back to overview</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Inline styles here deliberately — this component must render correctly
// even if the CSS pipeline itself is implicated in whatever broke.
const styles = {
  wrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F5F0", padding: "24px" },
  card: { maxWidth: "420px", textAlign: "center", background: "#fff", borderRadius: "16px", padding: "32px", boxShadow: "0 12px 32px rgba(22,33,28,0.14)" },
  title: { fontFamily: "system-ui, sans-serif", color: "#16211C", marginBottom: "12px" },
  text: { color: "#5B6B63", marginBottom: "20px", lineHeight: 1.5 },
  button: { background: "#0B4F3A", color: "#fff", border: "none", borderRadius: "10px", padding: "10px 20px", fontWeight: 600, cursor: "pointer" },
};
