import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface User {
  id: number;
  email: string;
  role: 'customer' | 'loan_officer' | 'admin';
  fullName: string;
  phone?: string | null;
  emailVerified?: boolean;
}

export interface UserProfile {
  fullName: string;
  email: string;
  phone: string | null;
  profilePictureUrl: string | null;
}

export interface ActivityHistory {
  entries: SettingsAuditEntry[];
  total: number;
}

export interface InAppNotification {
  id: number;
  triggerType: string;
  message: string;
  deliveryStatus: string;
  createdAt: string;
  readAt: string | null;
  referenceType: 'application' | 'kyc' | 'loan' | null;
  referenceId: number | null;
}

type ApiUser = Omit<User, 'fullName'> & {
  fullName?: string;
  full_name?: string;
  email_verified?: boolean;
};

export interface LoanProduct {
  id: number;
  name: string;
  monthly_rate_pct: number;
  min_amount: number;
  max_amount: number;
  min_tenure_months: number;
  max_tenure_months: number;
}

export interface AssistantReply {
  answer: string;
}

export interface ManagedUser {
  id: number;
  email: string;
  role: User['role'];
  fullName: string;
  phone: string | null;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string;
}

export interface UserSettings {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  preferredContactMethod: 'email' | 'sms';
  language: 'en' | 'tn';
  textSize: 'small' | 'normal' | 'large';
  notifyRepaymentReminders: boolean;
  notifyApplicationUpdates: boolean;
  notifyStatements: boolean;
  notifyNewApplications: boolean;
  notifyOverduePayments: boolean;
  notifyAssignedComplaints: boolean;
  notifyKycReviews: boolean;
  defaultApplicationFilter: 'all' | 'submitted' | 'under_review';
  applicationSort: 'newest' | 'oldest' | 'amount_high' | 'amount_low';
  dashboardLayout: 'comfortable' | 'compact';
}

export interface NotificationTemplate {
  eventType: string;
  displayName: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  emailSubject: string;
  emailBody: string;
  smsBody: string;
  updatedAt?: string;
}

export interface SettingsAuditEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  ipAddress: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
}

export interface MessageRecipient {
  id: number;
  fullName: string;
  email: string;
  role: User['role'];
}

export interface MessageSummary {
  id: number;
  subject: string;
  audienceRole: 'customer' | 'loan_officer';
  isBroadcast: boolean;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
  lastMessageAt: string;
  lastSenderName: string;
  unreadCount: number;
  participants: string;
}

export interface MessagePost {
  id: number;
  threadId: number;
  senderId: number;
  senderName: string;
  senderRole: User['role'];
  body: string;
  createdAt: string;
  deliveryStatus: 'sent' | 'delivered' | 'read' | null;
  attachments: MessageAttachment[];
}

export interface MessageAttachment {
  id: number;
  originalName: string;
  contentType: string;
  sizeBytes: number;
}

export interface MessageThread extends Omit<MessageSummary, 'lastMessage' | 'lastMessageAt' | 'lastSenderName' | 'unreadCount' | 'participants'> {
  participants: MessageRecipient[];
  messages: MessagePost[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = '/api';
  readonly user = signal<User | null>(this.readSavedUser());
  readonly profilePictureUrl = signal<string | null>(null);

  constructor(private readonly http: HttpClient) {}

  get token(): string | null {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem('lms_access_token');
  }

  private readSavedUser(): User | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem('lms_user');
      return raw ? JSON.parse(raw) as User : null;
    } catch {
      localStorage.removeItem('lms_user');
      return null;
    }
  }

  private request<T>(path: string, options: {
    method?: 'GET' | 'POST' | 'PATCH';
    body?: unknown;
    formData?: FormData;
    skipAuth?: boolean;
  } = {}): Promise<T> {
    const headers = this.token && !options.skipAuth
      ? new HttpHeaders({ Authorization: `Bearer ${this.token}` })
      : undefined;
    const url = `${this.baseUrl}${path}`;
    const body = options.formData ?? options.body;
    const method = options.method ?? 'GET';
    const request = method === 'GET'
      ? this.http.get<T>(url, { headers })
      : method === 'PATCH'
        ? this.http.patch<T>(url, body, { headers })
        : this.http.post<T>(url, body, { headers });
    return firstValueFrom(request);
  }

  async login(email: string, password: string, mfaCode?: string): Promise<boolean> {
    const result = await this.request<{
      user?: ApiUser;
      accessToken?: string;
      mfaRequired?: boolean;
    }>('/auth/login', { method: 'POST', body: { email, password, mfaCode }, skipAuth: true });
    if (result.mfaRequired) return true;
    if (!result.user || !result.accessToken) throw new Error('The server returned an incomplete login response.');
    this.saveSession(result.accessToken, this.normalizeUser(result.user));
    return false;
  }

  register(input: {
    fullName: string;
    email: string;
    password: string;
    phone?: string;
    maritalStatus: string;
  }): Promise<{ message: string; verificationSent: boolean }> {
    return this.request('/auth/register', {
      method: 'POST',
      body: input,
      skipAuth: true,
    });
  }

  private normalizeUser(user: ApiUser, fallbackName = ''): User {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName ?? user.full_name ?? fallbackName,
      phone: user.phone,
      emailVerified: user.emailVerified ?? user.email_verified,
    };
  }

  private saveSession(token: string, user: User): void {
    localStorage.setItem('lms_access_token', token);
    localStorage.setItem('lms_user', JSON.stringify(user));
    this.user.set(user);
  }

  logout(): void {
    localStorage.removeItem('lms_access_token');
    localStorage.removeItem('lms_user');
    this.user.set(null);
  }

  products(): Promise<LoanProduct[]> {
    return this.request('/loans/products/public');
  }

  askAssistant(conversationId: string, question: string): Promise<AssistantReply> {
    return this.request('/assistant/conversations', {
      method: 'POST',
      body: { conversationId, question },
    });
  }

  verifyEmail(token: string): Promise<{ message: string }> {
    return this.request(`/auth/verify-email?token=${encodeURIComponent(token)}`, { skipAuth: true });
  }

  verifyEmailCode(email: string, code: string): Promise<{ message: string }> {
    return this.request('/auth/verify-email-code', {
      method: 'POST',
      body: { email, code },
      skipAuth: true,
    });
  }

  resendVerificationCode(email: string): Promise<{ message: string }> {
    return this.request('/auth/resend-verification-code', {
      method: 'POST',
      body: { email },
      skipAuth: true,
    });
  }

  requestPasswordReset(email: string): Promise<{ message: string }> {
    return this.request('/auth/forgot-password', { method: 'POST', body: { email }, skipAuth: true });
  }

  resendVerification(): Promise<{ message: string }> {
    return this.request('/auth/resend-verification', { method: 'POST', body: {} });
  }

  resetPassword(email: string, code: string, newPassword: string): Promise<{ message: string }> {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: { email, code, newPassword },
      skipAuth: true,
    });
  }

  resetPasswordWithToken(token: string, newPassword: string): Promise<{ message: string }> {
    return this.request('/auth/reset-password', { method: 'POST', body: { token, newPassword }, skipAuth: true });
  }

  myApplications(): Promise<Record<string, unknown>[]> {
    return this.request('/loans/applications/mine');
  }

  myApplication(id: number): Promise<Record<string, unknown>> {
    return this.request(`/loans/applications/mine/${id}`);
  }

  myLoans(): Promise<Record<string, unknown>[]> {
    return this.request('/loans/accounts/mine');
  }

  myNotifications(): Promise<InAppNotification[]> {
    return this.request('/notifications/mine');
  }

  myUnreadNotificationCount(): Promise<number> {
    return this.request<{ unreadCount: number }>('/notifications/mine/unread-count')
      .then((result) => result.unreadCount);
  }

  markMyNotificationsRead(): Promise<{ markedRead: number }> {
    return this.request('/notifications/mine/read', { method: 'POST', body: {} });
  }

  staffSummary(): Promise<Record<string, number>> {
    return this.request('/officer/dashboard/summary');
  }

  staffApplications(): Promise<Record<string, unknown>[]> {
    return this.request('/loans/applications');
  }

  createStaffUser(input: {
    email: string;
    password: string;
    fullName: string;
    role: 'loan_officer' | 'admin';
  }): Promise<Record<string, unknown>> {
    return this.request('/officer/users', { method: 'POST', body: input });
  }

  managedUsers(): Promise<ManagedUser[]> {
    return this.request('/officer/users');
  }

  updateManagedUser(id: number, input: Pick<ManagedUser, 'email' | 'fullName' | 'phone' | 'role'>): Promise<ManagedUser> {
    return this.request(`/officer/users/${id}`, { method: 'PATCH', body: input });
  }

  setManagedUserStatus(id: number, isActive: boolean): Promise<ManagedUser> {
    return this.request(`/officer/users/${id}/status`, { method: 'PATCH', body: { isActive } });
  }

  mySettings(): Promise<UserSettings> {
    return this.request('/settings/me');
  }

  myProfile(): Promise<UserProfile> {
    return this.request('/profile/me');
  }

  updateMyProfile(fullName: string, phone: string | null): Promise<UserProfile> {
    return this.request('/profile/me', { method: 'PATCH', body: { fullName, phone } });
  }

  uploadProfilePicture(file: File): Promise<UserProfile> {
    const form = new FormData();
    form.append('file', file);
    return this.request('/profile/picture', { method: 'POST', formData: form });
  }

  async removeProfilePicture(): Promise<UserProfile> {
    const headers = this.token
      ? new HttpHeaders({ Authorization: `Bearer ${this.token}` })
      : undefined;
    return firstValueFrom(this.http.delete<UserProfile>(`${this.baseUrl}/profile/picture`, { headers }));
  }

  setCurrentProfile(profile: UserProfile): void {
    this.setCurrentUserProfile(profile.fullName, profile.email, this.user()?.emailVerified ?? true, profile.phone);
    this.profilePictureUrl.set(profile.profilePictureUrl);
  }

  updateMySettings(settings: UserSettings): Promise<UserSettings> {
    return this.request('/settings/me', { method: 'PATCH', body: settings });
  }

  setCurrentUserProfile(fullName: string, email: string, emailVerified: boolean, phone: string | null): void {
    const user = this.user();
    if (!user) return;
    const updated = { ...user, fullName, email, phone, emailVerified };
    localStorage.setItem('lms_user', JSON.stringify(updated));
    this.user.set(updated);
  }

  notificationSettings(): Promise<NotificationTemplate[]> {
    return this.request('/settings/admin/notifications');
  }

  updateNotificationSetting(eventType: string, setting: NotificationTemplate): Promise<NotificationTemplate> {
    return this.request(`/settings/admin/notifications/${encodeURIComponent(eventType)}`, {
      method: 'PATCH',
      body: setting,
    });
  }

  activityHistory(offset: number, limit = 100): Promise<ActivityHistory> {
    return this.request(`/settings/admin/history?offset=${offset}&limit=${limit}`);
  }

  downloadActivityHistoryCsv(): Promise<Blob> {
    const headers = this.token
      ? new HttpHeaders({ Authorization: `Bearer ${this.token}` })
      : undefined;
    return firstValueFrom(this.http.get(`${this.baseUrl}/settings/admin/history.csv`, {
      headers,
      responseType: 'blob',
    }));
  }

  messageRecipients(): Promise<MessageRecipient[]> {
    return this.request('/messages/recipients');
  }

  messageInbox(): Promise<MessageSummary[]> {
    return this.request('/messages');
  }

  updateMessagePresence(online: boolean): Promise<void> {
    return this.request('/messages/presence', { method: 'POST', body: { online } });
  }

  messageThread(id: number): Promise<MessageThread> {
    return this.request(`/messages/${id}`);
  }

  openDirectMessage(recipientId: number): Promise<{ threadId: number }> {
    return this.request(`/messages/direct/${recipientId}`, { method: 'POST' });
  }

  createMessage(input: {
    subject: string;
    message: string;
    recipientIds: number[];
    allRecipients: boolean;
  }): Promise<{ threadIds: number[]; subject: string; recipientCount: number }> {
    return this.request('/messages', { method: 'POST', body: input });
  }

  createMessageWithAttachments(input: {
    subject: string;
    message: string;
    recipientIds: number[];
    allRecipients: boolean;
    files: File[];
  }): Promise<{ threadIds: number[]; subject: string; recipientCount: number }> {
    const form = new FormData();
    form.append('subject', input.subject);
    form.append('message', input.message);
    form.append('allRecipients', String(input.allRecipients));
    input.recipientIds.forEach((id) => form.append('recipientIds', String(id)));
    input.files.forEach((file) => form.append('files', file, file.name));
    return this.request('/messages', { method: 'POST', formData: form });
  }

  replyToMessage(id: number, message: string): Promise<{ id: number; threadId: number }> {
    return this.request(`/messages/${id}/reply`, { method: 'POST', body: { message } });
  }

  sendMessageToThread(id: number, message: string, files: File[]): Promise<{ id: number; threadId: number }> {
    if (!files.length) return this.replyToMessage(id, message);
    const form = new FormData();
    if (message.trim()) form.append('message', message.trim());
    files.forEach((file) => form.append('files', file, file.name));
    return this.request(`/messages/${id}/reply`, { method: 'POST', formData: form });
  }

  downloadMessageAttachment(id: number): Promise<Blob> {
    const headers = this.token
      ? new HttpHeaders({ Authorization: ['Bearer', this.token].join(' ') })
      : undefined;
    return firstValueFrom(this.http.get(`${this.baseUrl}/messages/attachments/${id}/file`, {
      headers,
      responseType: 'blob',
    }));
  }

  submitApplication(input: {
    kycCaseId: number;
    loanProductId: number;
    amountRequested: number;
    purpose: string;
    tenureMonths: number;
  }): Promise<Record<string, unknown>> {
    return this.request('/loans/applications', { method: 'POST', body: input });
  }

  documents(): Promise<Record<string, unknown>[]> {
    return this.request('/kyc/documents');
  }

  uploadDocument(file: File, docType: string): Promise<unknown> {
    return this.uploadKycDocument(file, docType);
  }

  uploadKycDocument(file: File, docType: string, caseId?: number): Promise<unknown> {
    const data = new FormData();
    data.append('file', file);
    data.append('docType', docType);
    if (caseId !== undefined) data.append('caseId', String(caseId));
    return this.request('/kyc/documents', { method: 'POST', formData: data });
  }

  startKycCase(): Promise<Record<string, unknown>> {
    return this.request('/kyc/cases', { method: 'POST' });
  }

  myKycCases(): Promise<Record<string, unknown>[]> {
    return this.request('/kyc/cases/mine');
  }

  myKycCase(id: number): Promise<Record<string, unknown>> {
    return this.request(`/kyc/cases/mine/${id}`);
  }

  submitKycCase(id: number): Promise<Record<string, unknown>> {
    return this.request(`/kyc/cases/${id}/submit`, { method: 'POST' });
  }

  staffKycCases(status?: string): Promise<Record<string, unknown>[]> {
    return this.request(`/kyc/cases${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  }

  decideKycCase(id: number, decision: 'approved' | 'rejected', reason?: string): Promise<Record<string, unknown>> {
    return this.request(`/kyc/cases/${id}/decision`, {
      method: 'PATCH',
      body: { decision, reason },
    });
  }

  downloadDocument(id: number): Promise<Blob> {
    const headers = this.token
      ? new HttpHeaders({ Authorization: `Bearer ${this.token}` })
      : undefined;
    return firstValueFrom(this.http.get(`${this.baseUrl}/kyc/documents/${id}/file`, {
      headers,
      responseType: 'blob',
    }));
  }

  updateDocumentStatus(id: number, status: 'verified' | 'rejected', rejectionReason?: string): Promise<unknown> {
    return this.request(`/kyc/documents/${id}/status`, {
      method: 'PATCH',
      body: { status, rejectionReason },
    });
  }

  loan(id: string): Promise<Record<string, unknown>> {
    return this.request(`/loans/accounts/${id}`);
  }

  schedule(id: string): Promise<Record<string, unknown>[]> {
    return this.request(`/loans/accounts/${id}/schedule`);
  }

  application(id: string): Promise<Record<string, unknown>> {
    return this.request(`/loans/applications/${id}`);
  }

  decideApplication(id: string, decision: 'approved' | 'declined', declineReasonCode?: string): Promise<unknown> {
    return this.request(`/loans/applications/${id}/decision`, {
      method: 'PATCH',
      body: { decision, declineReasonCode },
    });
  }

  complaints(): Promise<Record<string, unknown>[]> {
    return this.request('/officer/complaints');
  }

  updateComplaint(id: number, status: string): Promise<unknown> {
    return this.request(`/officer/complaints/${id}`, { method: 'PATCH', body: { status } });
  }

  portfolioAtRisk(): Promise<Record<string, unknown>[]> {
    return this.request('/officer/reports/portfolio-at-risk');
  }

  agingReport(): Promise<Record<string, unknown>[]> {
    return this.request('/officer/reports/aging');
  }

  collectionsReport(): Promise<Record<string, unknown>[]> {
    return this.request('/officer/reports/disbursement-vs-collections');
  }

  recordRepayment(loanId: number, amount: number): Promise<Record<string, unknown>> {
    return this.request(`/loans/accounts/${loanId}/repayments`, {
      method: 'POST',
      body: { amount },
    });
  }

  static errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Could not reach the backend. Start the Spring Boot API and PostgreSQL, then try again.';
      return error.error?.error ?? `Request failed (${error.status}).`;
    }
    return error instanceof Error ? error.message : 'Something went wrong.';
  }
}
