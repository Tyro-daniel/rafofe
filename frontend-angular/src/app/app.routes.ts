import { inject } from '@angular/core';
import { CanActivateFn, Routes, Router } from '@angular/router';
import { ApiService } from './api.service';
import {
  AppShell,
  ApplicationDetailPage,
  ApplicationsPage,
  ApplyPage,
  ComplaintsPage,
  AdminAuditPage,
  CustomerApplicationDetailPage,
  AdminDashboardPage,
  AdminProductsPage,
  AdminSettingsPage,
  AdminStaffPage,
  DashboardPage,
  ForgotPasswordPage,
  LandingPage,
  LoanDetailPage,
  KycReviewPage,
  LoginPage,
  MessageCenterPage,
  NotFoundPage,
  OfficerDashboardPage,
  OfficerReportsPage,
  PersonalSettingsPage,
  PortfolioPage,
  ProfilePage,
  RegisterPage,
  RepaymentPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './pages';

const signedIn: CanActivateFn = () => {
  const api = inject(ApiService);
  if (api.token) return true;
  const url = inject(Router).url;
  return inject(Router).createUrlTree([
    url.startsWith('/admin/') || url.startsWith('/officer/') || url.startsWith('/applications') ||
      url.startsWith('/portfolio-at-risk') || url.startsWith('/complaints')
      ? '/login-staff'
      : '/login',
  ]);
};

const customerOnly: CanActivateFn = () => {
  const api = inject(ApiService);
  if (!api.token) return inject(Router).createUrlTree(['/login']);
  return api.user()?.role === 'customer' ? true : inject(Router).createUrlTree(['/dashboard']);
};

const dashboardForRole: CanActivateFn = () => {
  const api = inject(ApiService);
  if (!api.token) return inject(Router).createUrlTree(['/login']);
  if (api.user()?.role === 'admin') return inject(Router).createUrlTree(['/admin/dashboard']);
  if (api.user()?.role === 'loan_officer') return inject(Router).createUrlTree(['/officer/dashboard']);
  return true;
};

const adminOnly: CanActivateFn = () => {
  const api = inject(ApiService);
  if (!api.token) return inject(Router).createUrlTree(['/staff/login']);
  const role = api.user()?.role;
  if (role === 'admin') return true;
  return inject(Router).createUrlTree([role === 'loan_officer' ? '/officer/dashboard' : '/dashboard']);
};

const officerOnly: CanActivateFn = () => {
  const api = inject(ApiService);
  if (!api.token) return inject(Router).createUrlTree(['/staff/login']);
  const role = api.user()?.role;
  if (role === 'loan_officer') return true;
  return inject(Router).createUrlTree([role === 'admin' ? '/admin/dashboard' : '/dashboard']);
};

const loanStaffOnly: CanActivateFn = () => {
  const api = inject(ApiService);
  if (!api.token) return inject(Router).createUrlTree(['/staff/login']);
  const role = api.user()?.role;
  return role === 'loan_officer' || role === 'admin'
    ? true
    : inject(Router).createUrlTree(['/dashboard']);
};

const personalSettingsOnly: CanActivateFn = () => {
  const api = inject(ApiService);
  if (!api.token) return inject(Router).createUrlTree(['/login']);
  const role = api.user()?.role;
  return role === 'customer' || role === 'loan_officer'
    ? true
    : inject(Router).createUrlTree([role === 'admin' ? '/admin/dashboard' : '/login']);
};

export const routes: Routes = [
  { path: '', component: LandingPage },
  { path: 'products', loadComponent: () => import('./public-pages').then((pages) => pages.LoanProductsPage) },
  { path: 'calculator', loadComponent: () => import('./public-pages').then((pages) => pages.RepaymentCalculatorPage) },
  { path: 'about', loadComponent: () => import('./public-pages').then((pages) => pages.AboutPage) },
  { path: 'regulatory', loadComponent: () => import('./public-pages').then((pages) => pages.RegulatoryInformationPage) },
  { path: 'how-to-apply', loadComponent: () => import('./public-pages').then((pages) => pages.ApplicationInformationPage) },
  { path: 'login', component: LoginPage, data: { portal: 'customer' } },
  { path: 'login-staff', component: LoginPage, data: { portal: 'staff' } },
  { path: 'staff/login', redirectTo: 'login-staff', pathMatch: 'full' },
  { path: 'register', component: RegisterPage },
  { path: 'verify-email', component: VerifyEmailPage },
  { path: 'forgot-password', component: ForgotPasswordPage },
  { path: 'reset-password', component: ResetPasswordPage },
  {
    path: '',
    component: AppShell,
    canActivate: [signedIn],
    children: [
      { path: 'dashboard', component: DashboardPage, canActivate: [dashboardForRole] },
      { path: 'admin/dashboard', component: AdminDashboardPage, canActivate: [adminOnly] },
      { path: 'admin/staff', component: AdminStaffPage, canActivate: [adminOnly] },
      { path: 'admin/products', component: AdminProductsPage, canActivate: [adminOnly] },
      { path: 'admin/settings', component: AdminSettingsPage, canActivate: [adminOnly] },
      { path: 'admin/audit-trail', component: AdminAuditPage, canActivate: [adminOnly] },
      { path: 'settings', component: PersonalSettingsPage, canActivate: [personalSettingsOnly] },
      { path: 'profile', component: ProfilePage, canActivate: [signedIn] },
      { path: 'messages', component: MessageCenterPage, canActivate: [signedIn] },
      { path: 'officer/dashboard', component: OfficerDashboardPage, canActivate: [officerOnly] },
      { path: 'officer/kyc', component: KycReviewPage, canActivate: [loanStaffOnly] },
      { path: 'officer/repayments', component: RepaymentPage, canActivate: [officerOnly] },
      { path: 'officer/reports', component: OfficerReportsPage, canActivate: [officerOnly] },
      { path: 'apply', component: ApplyPage, canActivate: [customerOnly] },
      { path: 'my-applications/:id', component: CustomerApplicationDetailPage, canActivate: [customerOnly] },
      { path: 'documents', redirectTo: 'apply', pathMatch: 'full' },
      { path: 'loans/:id', component: LoanDetailPage, canActivate: [customerOnly] },
      { path: 'applications', component: ApplicationsPage, canActivate: [loanStaffOnly] },
      { path: 'applications/:id', component: ApplicationDetailPage, canActivate: [loanStaffOnly] },
      { path: 'portfolio-at-risk', component: PortfolioPage, canActivate: [officerOnly] },
      { path: 'complaints', component: ComplaintsPage, canActivate: [officerOnly] },
    ],
  },
  { path: '**', component: NotFoundPage },
];
