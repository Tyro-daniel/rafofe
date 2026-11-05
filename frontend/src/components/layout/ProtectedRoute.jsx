import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

/**
 * Pure decision logic, deliberately separated from the component below so
 * it can be unit tested directly without needing a real browser (React's
 * server-side rendering never runs useEffect, which is what flips
 * AuthContext's `initializing` flag — so a full-component render in a
 * non-browser test harness can't reliably exercise this path; testing
 * the decision function directly can).
 */
export function resolveUnauthenticatedRedirect(roles) {
  const isStaffOnlyRoute = Array.isArray(roles) && roles.length > 0 && roles.every((r) => r === "loan_officer" || r === "admin");
  return isStaffOnlyRoute ? "/staff/login" : "/login";
}

/**
 * Gate for any route requiring auth. `roles`, if given, further restricts
 * to specific roles (e.g. officer-only pages) — mirrors the backend's
 * requireRole() so a customer can't even see an officer page flash before
 * redirecting, let alone call the underlying API (which independently
 * enforces this again server-side; this is UX, not the security boundary).
 */
export function ProtectedRoute({ roles, children }) {
  const { isAuthenticated, initializing, user } = useAuth();
  const location = useLocation();

  if (initializing) return null; // AuthContext is still verifying a stored token

  if (!isAuthenticated) {
    // A route restricted to staff roles (loan_officer/admin) sends an
    // unauthenticated visitor to the staff portal's own login, not the
    // borrower one — consistent with the "two front doors" split: an
    // officer's bookmarked /applications link, hit after a session
    // expires, should land back on the staff-branded login, not the
    // consumer-facing one.
    return <Navigate to={resolveUnauthenticatedRedirect(roles)} state={{ from: location }} replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}
