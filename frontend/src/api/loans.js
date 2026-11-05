import { api } from "./client";

export const loansApi = {
  listProducts: () => api.get("/loans/products"),
  publicListProducts: () => api.get("/loans/products/public"),
  submitApplication: (data) => api.post("/loans/applications", data),
  myApplications: () => api.get("/loans/applications/mine"),
  myAccounts: () => api.get("/loans/accounts/mine"),
  listApplications: (status) => api.get(`/loans/applications${status ? `?status=${status}` : ""}`),
  getApplication: (id) => api.get(`/loans/applications/${id}`),
  decideApplication: (id, decision, extra = {}) =>
    api.patch(`/loans/applications/${id}/decision`, { decision, ...extra }),
  signAgreement: (id) => api.post(`/loans/applications/${id}/agreement/sign`),

  getAccount: (id) => api.get(`/loans/accounts/${id}`),
  getSchedule: (id) => api.get(`/loans/accounts/${id}/schedule`),
  getStatement: (id) => api.get(`/loans/accounts/${id}/statement`),
  recordRepayment: (id, amount) => api.post(`/loans/accounts/${id}/repayments`, { amount }),
  chargePenalty: (id, monthsLate) => api.post(`/loans/accounts/${id}/penalties`, { monthsLate }),
  writeOff: (id, reason) => api.post(`/loans/accounts/${id}/write-off`, { reason }),
};
