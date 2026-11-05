import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { authApi } from "../api/auth";
import { getStoredToken, getStoredUser, storeSession, clearSession, onUnauthorized } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [token, setToken] = useState(() => getStoredToken());
  const [initializing, setInitializing] = useState(true);

  // On mount, if a token exists from a previous session, confirm it's
  // still valid against the server (rather than trusting the locally
  // cached user object indefinitely — that cache could be stale or the
  // token could have been revoked server-side).
  useEffect(() => {
    let cancelled = false;
    async function verify() {
      if (!getStoredToken()) {
        setInitializing(false);
        return;
      }
      try {
        const freshUser = await authApi.me();
        if (!cancelled) setUser(freshUser);
      } catch {
        if (!cancelled) {
          clearSession();
          setUser(null);
          setToken(null);
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }
    verify();
    return () => {
      cancelled = true;
    };
  }, []);

  // Any API call that gets a 401 fires this event (see api/client.js) —
  // one central place to react to "your session is no longer valid"
  // instead of every page handling it separately.
  useEffect(() => {
    return onUnauthorized(() => {
      clearSession();
      setUser(null);
      setToken(null);
    });
  }, []);

  const login = useCallback(async (email, password, mfaCode) => {
    const result = await authApi.login(email, password, mfaCode);
    if (result.mfaRequired) return { mfaRequired: true };
    storeSession(result.accessToken, result.user);
    setToken(result.accessToken);
    setUser(result.user);
    return { mfaRequired: false };
  }, []);

  const register = useCallback(async (data) => {
    const result = await authApi.register(data);
    const sessionUser = { id: result.user.id, email: result.user.email, role: result.user.role, fullName: result.user.full_name };
    storeSession(result.accessToken, sessionUser);
    setToken(result.accessToken);
    setUser(sessionUser);
    return sessionUser;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setToken(null);
  }, []);

  const value = { user, token, isAuthenticated: !!token, initializing, login, register, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
