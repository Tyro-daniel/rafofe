import { api } from "./client";

export const officerApi = {
  dashboardSummary: () => api.get("/officer/dashboard/summary"),
  portfolioAtRisk: () => api.get("/officer/reports/portfolio-at-risk"),
  aging: () => api.get("/officer/reports/aging"),
  disbursementVsCollections: () => api.get("/officer/reports/disbursement-vs-collections"),
  complaints: () => api.get("/officer/complaints"),
  updateComplaint: (id, data) => api.patch(`/officer/complaints/${id}`, data),
  createStaffUser: (data) => api.post("/officer/users", data),
};
