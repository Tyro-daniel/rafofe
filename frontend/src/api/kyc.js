import { api } from "./client";

export const kycApi = {
  myDocuments: () => api.get("/kyc/documents"),
  documentsForUser: (userId) => api.get(`/kyc/documents/user/${userId}`),
  upload: (file, docType) => api.uploadFile("/kyc/documents", file, { docType }),
  setStatus: (id, status, rejectionReason) =>
    api.patch(`/kyc/documents/${id}/status`, { status, rejectionReason }),
};
