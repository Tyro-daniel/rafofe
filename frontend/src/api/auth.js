import { api } from "./client";

export const authApi = {
  register: (data) => api.post("/auth/register", data),
  login: (email, password, mfaCode) => api.post("/auth/login", { email, password, mfaCode }),
  me: () => api.get("/auth/me"),
  setupMfa: () => api.post("/auth/mfa/setup"),
  enableMfa: (code) => api.post("/auth/mfa/enable", { code }),
};
