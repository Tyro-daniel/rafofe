import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  FiHome, FiFileText, FiUpload, FiCreditCard, FiUsers, FiPieChart,
  FiAlertCircle, FiLogOut, FiMenu, FiX,
} from "react-icons/fi";
import { useAuth } from "../../context/AuthContext";
import { MofenyiAssistant } from "../assistant/MofenyiAssistant";
import { Logo } from "./Logo";
import "./AppShell.css";

const CUSTOMER_NAV = [
  { to: "/dashboard", label: "Overview", icon: FiHome, end: true },
  { to: "/apply", label: "Apply for a loan", icon: FiFileText },
  { to: "/documents", label: "Documents", icon: FiUpload },
];

const OFFICER_NAV = [
  { to: "/dashboard", label: "Overview", icon: FiHome, end: true },
  { to: "/applications", label: "Applications", icon: FiFileText },
  { to: "/portfolio-at-risk", label: "Portfolio at risk", icon: FiAlertCircle },
  { to: "/complaints", label: "Complaints", icon: FiUsers },
];

// Mobile bottom nav is intentionally a subset — 4-5 items max is the
// standard mobile-nav constraint (thumb-reachable, not cramped); anything
// beyond that belongs in the desktop sidebar only.
function navForRole(role) {
  return role === "customer" ? CUSTOMER_NAV : OFFICER_NAV;
}

export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navItems = navForRole(user?.role);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <div className="shell-brand">
          <Logo size={120} showWordmark={false} />
          <span className="shell-brand-name">CREDIT MANAGEMENT SYSTEM</span>
        </div>
        
        <nav className="shell-nav" aria-label="Primary">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `shell-nav-link ${isActive ? "active" : ""}`}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="shell-sidebar-footer">
          <div className="shell-user">
            <div className="shell-user-avatar" aria-hidden="true">{initials(user?.fullName || user?.email)}</div>
            <div>
              <div className="shell-user-name">{user?.fullName || user?.email}</div>
              <div className="shell-user-role">{roleLabel(user?.role)}</div>
            </div>
          </div>
          <button className="shell-logout" onClick={handleLogout}>
            <FiLogOut aria-hidden="true" /> Log out
          </button>
        </div>
      </aside>

      <header className="shell-topbar">
        <button
          className="shell-menu-toggle"
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-expanded={mobileNavOpen}
          aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
        >
          {mobileNavOpen ? <FiX /> : <FiMenu />}
        </button>
        <Logo size={120} showWordmark={false} />
        <span className="shell-topbar-title">LMS</span>
      </header>

      {mobileNavOpen && (
        <div className="shell-mobile-drawer">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) => `shell-nav-link ${isActive ? "active" : ""}`}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
          <button className="shell-logout" onClick={handleLogout}>
            <FiLogOut aria-hidden="true" /> Log out
          </button>
        </div>
      )}

      <main className="shell-content">
        <div className="container">{children}</div>
      </main>

      <nav className="shell-bottom-nav" aria-label="Primary">
        {navItems.slice(0, 4).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `shell-bottom-link ${isActive ? "active" : ""}`}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <MofenyiAssistant />
    </div>
  );
}

function initials(name) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function roleLabel(role) {
  if (role === "loan_officer") return "Loan Officer";
  if (role === "admin") return "Administrator";
  return "Customer";
}
