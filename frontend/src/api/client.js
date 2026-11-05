/**
 * Thin fetch wrapper — deliberately not a heavier HTTP library (axios etc.)
 * for an app this size; native fetch plus ~80 lines of glue covers every
 * need here and keeps the dependency surface smaller. Revisit this
 * decision if the API surface grows to warrant interceptor middleware.
 *
 * Base path is "/api": in dev, vite.config.js proxies /api → localhost:4000
 * (see comment there). In production, Nginx does the same proxy (see
 * nginx.conf). The app code never hardcodes a backend host — this is what
 * makes the exact same build work in any environment without a rebuild.
 */

const BASE_URL = "/api";

/**
 * SECURITY NOTE (flagged for maintainers, not hidden):
 * The access token is kept in memory (React state) and mirrored to
 * localStorage only so a page refresh doesn't force a re-login. Anything
 * in localStorage is readable by any JS that runs on the page, so if this
 * app ever includes third-party scripts or has an XSS gap, tokens here are
 * at risk. The token also expires in 30 minutes (see backend
 * src/middleware/auth.js), which bounds the blast radius.
 * The backend currently has no POST /auth/refresh endpoint to redeem the
 * refreshToken it issues — that's a real gap. See the "Critical
 * Recommendations" section of the project README for the httpOnly-cookie
 * upgrade path this should move to before handling real customer funds.
 */
const TOKEN_KEY = "lms_access_token";
const USER_KEY = "lms_user";

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}
export function storeSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Normalized error shape every caller can rely on. */
class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/**
 * Fired when the API returns 401 (expired/invalid token), so the app shell
 * can react in one place (redirect to login) instead of every caller
 * checking for it individually. See AuthContext.jsx, which subscribes.
 */
const AUTH_ERROR_EVENT = "lms:unauthorized";
function emitUnauthorized() {
  window.dispatchEvent(new Event(AUTH_ERROR_EVENT));
}
export function onUnauthorized(handler) {
  window.addEventListener(AUTH_ERROR_EVENT, handler);
  return () => window.removeEventListener(AUTH_ERROR_EVENT, handler);
}

async function request(path, { method = "GET", body, isFormData = false, signal } = {}) {
  const headers = {};
  const token = getStoredToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!isFormData && body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal,
    });
  } catch (networkErr) {
    // fetch() throws on network failure (server down, no connectivity) —
    // this is the one case with no HTTP status at all, so give it a
    // distinct, clearly-worded error rather than a confusing "undefined".
    throw new ApiError("Could not reach the server. Check your connection and try again.", 0, networkErr);
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    if (response.status === 401) emitUnauthorized();
    const message = payload?.error || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, payload?.details);
  }

  return payload;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: "GET" }),
  post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
  patch: (path, body, opts) => request(path, { ...opts, method: "PATCH", body }),
  del: (path, opts) => request(path, { ...opts, method: "DELETE" }),

  /** Multipart upload (KYC documents). `fields` are appended alongside the file. */
  uploadFile: (path, file, fields = {}) => {
    const form = new FormData();
    form.append("file", file);
    Object.entries(fields).forEach(([key, value]) => form.append(key, value));
    return request(path, { method: "POST", body: form, isFormData: true });
  },
};

export { ApiError };
