import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { AppShell } from "./components/layout/AppShell";

import { LandingPage } from "./pages/LandingPage";
import { Login } from "./pages/auth/Login";
import { Register } from "./pages/auth/Register";
import { StaffLogin } from "./pages/auth/StaffLogin";

import { CustomerDashboard } from "./pages/customer/CustomerDashboard";
import { ApplyForLoan } from "./pages/customer/ApplyForLoan";
import { Documents } from "./pages/customer/Documents";
import { LoanDetail } from "./pages/customer/LoanDetail";

import { OfficerDashboard } from "./pages/officer/OfficerDashboard";
import { ApplicationsList } from "./pages/officer/ApplicationsList";
import { ApplicationDetail } from "./pages/officer/ApplicationDetail";
import { PortfolioAtRisk } from "./pages/officer/PortfolioAtRisk";
import { Complaints } from "./pages/officer/Complaints";

/**
 * ROUTING ARCHITECTURE — "two front doors", implemented as routes within
 * one app rather than literal separate subdomains (see the Support &
 * Maintenance Manual for how to promote this to real subdomains, e.g.
 * portal.example.com / staff.example.com, via Nginx server_name blocks +
 * DNS, once that's warranted):
 *
 *   "/"            — PUBLIC marketing landing page (LandingPage). No auth
 *                    required. If an already-authenticated user lands
 *                    here (e.g. a bookmark), RootRoute below sends them
 *                    straight to their dashboard instead of showing them
 *                    marketing content they don't need.
 *   "/login"        — Borrower login (customer-facing chrome/copy).
 *   "/register"     — Borrower self-registration.
 *   "/staff/login"  — Internal staff login (loan officers/admins) — same
 *                    underlying auth API, deliberately different chrome,
 *                    no marketing nav, security-notice framing.
 *   "/dashboard"    — The authenticated app shell. Resolves to a
 *                    different dashboard by role (RoleHome), exactly as
 *                    "/" used to before this restructure.
 */
function RoleHome() {
  const { user } = useAuth();
  if (user?.role === "customer") return <CustomerDashboard />;
  return <OfficerDashboard />;
}

function AuthedLayout({ children }) {
  return (
    <ProtectedRoute>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  );
}

/** "/" — public landing page, UNLESS already logged in, then straight to the dashboard. */
function RootRoute() {
  const { isAuthenticated, initializing } = useAuth();
  if (initializing) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RootRoute />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/staff/login" element={<StaffLogin />} />

          <Route path="/dashboard" element={<AuthedLayout><RoleHome /></AuthedLayout>} />

          {/* Customer-only */}
          <Route path="/apply" element={
            <ProtectedRoute roles={["customer"]}><AppShell><ApplyForLoan /></AppShell></ProtectedRoute>
          } />
          <Route path="/documents" element={
            <ProtectedRoute roles={["customer"]}><AppShell><Documents /></AppShell></ProtectedRoute>
          } />
          <Route path="/loans/:id" element={
            <ProtectedRoute roles={["customer"]}><AppShell><LoanDetail /></AppShell></ProtectedRoute>
          } />

          {/* Officer/Admin-only */}
          <Route path="/applications" element={
            <ProtectedRoute roles={["loan_officer", "admin"]}><AppShell><ApplicationsList /></AppShell></ProtectedRoute>
          } />
          <Route path="/applications/:id" element={
            <ProtectedRoute roles={["loan_officer", "admin"]}><AppShell><ApplicationDetail /></AppShell></ProtectedRoute>
          } />
          <Route path="/portfolio-at-risk" element={
            <ProtectedRoute roles={["loan_officer", "admin"]}><AppShell><PortfolioAtRisk /></AppShell></ProtectedRoute>
          } />
          <Route path="/complaints" element={
            <ProtectedRoute roles={["loan_officer", "admin"]}><AppShell><Complaints /></AppShell></ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
