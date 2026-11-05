import { DOCUMENT } from '@angular/common';
import { afterNextRender, ChangeDetectorRef, Component, DestroyRef, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivityHistory, ApiService, InAppNotification, LoanProduct, ManagedUser, MessageRecipient, MessageSummary, MessageThread, NotificationTemplate, SettingsAuditEntry, UserProfile, UserSettings } from './api.service';
import { PublicFooter, PublicNav } from './public-shell';

type Row = Record<string, unknown>;

interface AssistantMessage {
  role: 'assistant' | 'visitor';
  text: string;
}

function money(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `P ${new Intl.NumberFormat('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`
    : '—';
}
function estimate(principal: number, monthlyRatePct: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const rate = monthlyRatePct / 100;
  return Math.round((rate === 0
    ? principal / months
    : principal * rate / (1 - Math.pow(1 + rate, -months))) * 100) / 100;
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, PublicNav, PublicFooter],
  template: `
    <div class="landing-page">
    <app-public-nav />
    <main>
      <section class="hero-carousel" id="home" aria-label="Featured images">
        <div class="hero-carousel-stage" role="group" aria-roledescription="carousel" aria-label="Featured images">
          @for (slide of slides; track slide.src; let index = $index) {
            <img class="hero-carousel-image" [class.active]="activeSlide === index" [src]="slide.src" [alt]="slide.alt" [attr.aria-hidden]="activeSlide !== index" [attr.fetchpriority]="index === activeSlide ? 'high' : 'auto'" (error)="hideBrokenImage($event)">
          }
          <div class="hero-carousel-copy">
            <div class="hero-carousel-copy-panel">
              <div class="eyebrow">{{ slides[activeSlide].eyebrow }}</div>
              <h1>{{ slides[activeSlide].heading }}</h1>
              <p>{{ slides[activeSlide].description }}</p>
              <div class="hero-carousel-actions">
                <a class="button button-primary" routerLink="/products">Explore loan products <span aria-hidden="true">→</span></a>
                <a class="hero-apply-link" routerLink="/how-to-apply">Apply now <span aria-hidden="true">↗</span></a>
              </div>
            </div>
          </div>
          <div class="hero-carousel-controls">
            <button class="carousel-arrow" type="button" aria-label="Previous image" (click)="showSlide(activeSlide - 1)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <div class="carousel-indicators" aria-label="Choose an image">
              @for (slide of slides; track slide.src; let index = $index) {
                <button type="button" class="carousel-indicator" [class.active]="activeSlide === index" [attr.aria-label]="'Show image ' + (index + 1)" [attr.aria-pressed]="activeSlide === index" (click)="showSlide(index)"></button>
              }
            </div>
            <button class="carousel-arrow" type="button" aria-label="Next image" (click)="showSlide(activeSlide + 1)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
            </button>
            <button class="carousel-pause" type="button" (click)="toggleAutoplay()" [attr.aria-label]="isPaused ? 'Start automatic slideshow' : 'Pause automatic slideshow'">{{ isPaused ? 'Play' : 'Pause' }}</button>
          </div>
        </div>
      </section>
      <section class="ticker" aria-label="Our lending principles">
        <div class="container ticker-inner">
          <article class="ticker-card">
            <span class="ticker-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M24 8v10M10 20h28M12 20v7m12-7v7m12-7v7M8 30h8v8H8zm16 0h8v8h-8zm16 0h-8v8h8z"/></svg></span>
            <h2>Built for Botswana</h2>
          </article>
          <article class="ticker-card">
            <span class="ticker-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10h24a3 3 0 0 1 3 3v23H15a5 5 0 0 1-5-5V13a3 3 0 0 1 2-3z"/><path d="M16 18h15M16 25h15M16 32h9M10 31a5 5 0 0 0 5 5"/></svg></span>
            <h2>Responsible lending</h2>
          </article>
          <article class="ticker-card">
            <span class="ticker-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 7h14l9 9v24H14a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3z"/><path d="M28 7v10h9M17 29h4l3-5 4 10 3-5h3"/></svg></span>
            <h2>Human review</h2>
          </article>
          <article class="ticker-card">
            <span class="ticker-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="16" width="34" height="24" rx="3"/><path d="M17 16v-5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v5M7 25h34M21 25v4h6v-4"/></svg></span>
            <h2>Transparent terms</h2>
          </article>
        </div>
      </section>
      <section class="section container public-page-intro">
        <div class="eyebrow">EXPLORE REFOFE NOVELTY</div>
        <h2>Find the information you need.</h2>
        <div class="public-link-grid">
          <a routerLink="/products"><h3>Loan products</h3><p>Compare available loan amounts, terms, and monthly rates.</p><span>Explore products →</span></a>
          <a routerLink="/calculator"><h3>Repayment calculator</h3><p>See an illustrative monthly repayment estimate.</p><span>Estimate repayments →</span></a>
          <a routerLink="/about"><h3>About us</h3><p>Learn how Refofe Novelty handles applications.</p><span>Meet Refofe Novelty →</span></a>
          <a routerLink="/regulatory"><h3>Regulatory information</h3><p>Review responsible borrowing and regulatory resources.</p><span>View disclosures →</span></a>
          <a routerLink="/how-to-apply"><h3>How to apply</h3><p>Review the application requirements before getting started.</p><span>Application information →</span></a>
        </div>
      </section>
    </main>
    <app-public-footer />
    @if (assistantOpen) {
      <section class="assistant-panel" role="dialog" aria-modal="false" aria-labelledby="assistant-title">
        <header class="assistant-header">
          <div><h2 id="assistant-title">Lending assistant</h2><p>Here to help with your loan questions</p></div>
          <button type="button" class="assistant-close" aria-label="Close chat" (click)="toggleAssistant()">×</button>
        </header>
        <div class="assistant-transcript" #assistantTranscript role="log" aria-live="polite" aria-relevant="additions">
          @for (message of assistantMessages; track $index) {
            <div class="assistant-message" [class.assistant-message-visitor]="message.role === 'visitor'">
              <span>{{ message.text }}</span>
            </div>
          }
          @if (assistantError) { <p class="assistant-error" role="alert">{{ assistantError }}</p> }
        </div>
        @if (assistantMessages.length === 1) {
          <div class="assistant-suggestions" aria-label="Suggested questions">
            <button type="button" (click)="sendAssistantQuestion('How do I apply?')">How do I apply?</button>
            <button type="button" (click)="sendAssistantQuestion('Which documents do I need?')">Which documents do I need?</button>
            <button type="button" (click)="sendAssistantQuestion('Are loan decisions made by AI?')">Are decisions made by AI?</button>
          </div>
        }
        <form class="assistant-composer" (submit)="submitAssistantQuestion($event)">
          <label class="assistant-sr-only" for="assistant-question">Ask a question about loans</label>
          <input id="assistant-question" name="assistantQuestion" type="text" [(ngModel)]="assistantDraft"
            maxlength="500" autocomplete="off" placeholder="Type your question…" [disabled]="assistantSending">
          <button type="submit" [disabled]="assistantSending || !assistantDraft.trim()" aria-label="Send message">Send</button>
        </form>
        <p class="assistant-privacy">Automated FAQ assistant, not a credit decision tool. Chats are saved for compliance. Don’t share passwords, ID numbers, or bank details.</p>
      </section>
    }
    <button type="button" class="assistant-launcher" (click)="toggleAssistant()" [attr.aria-expanded]="assistantOpen"
      [attr.aria-label]="assistantOpen ? 'Close lending assistant' : 'Open lending assistant'">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.2-.7L4 20l1.5-4A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>
      </svg>
      <span>{{ assistantOpen ? 'Close chat' : 'Ask' }}</span>
    </button>
    </div>
  `,
})
export class LandingPage {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  assistantOpen = false;
  assistantSending = false;
  assistantDraft = '';
  assistantError = '';
  readonly assistantMessages: AssistantMessage[] = [{
    role: 'assistant',
    text: 'Hi! I can answer questions about our loan products, how to apply, required documents, repayments, and application reviews. I cannot access personal account details or make lending decisions.',
  }];
  private assistantConversationId: string | null = null;
  readonly slides = [
    {
      src: '/images/heroo.JPG',
      alt: 'City buildings illuminated at dusk',
      eyebrow: 'LOANS BUILT AROUND YOU',
      heading: 'Move forward with confidence.',
      description: 'Explore flexible loan options with clear terms and a real person reviewing every application.',
    },
    {
      src: '/images/Hero.JPEG',
      alt: 'Botswana flag overlooking the city at sunset',
      eyebrow: 'ROOTED IN BOTSWANA',
      heading: 'Local lending for brighter possibilities.',
      description: 'Explore responsible loan options designed for life in Botswana, with clear terms and a human review at every step.',
    },
  ];
  activeSlide = 0;
  isPaused = false;
  private autoplayTimer: number | undefined;
  @ViewChild('assistantTranscript')
  private assistantTranscript?: ElementRef<HTMLDivElement>;

  constructor() {
    afterNextRender(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        this.isPaused = true;
        return;
      }
      this.startAutoplay();
      this.destroyRef.onDestroy(() => this.stopAutoplay());
    });
  }

  toggleAssistant(): void {
    this.assistantOpen = !this.assistantOpen;
    this.assistantError = '';
    if (this.assistantOpen) this.scrollAssistantToEnd();
  }

  submitAssistantQuestion(event: Event): void {
    event.preventDefault();
    void this.sendAssistantQuestion(this.assistantDraft);
  }

  async sendAssistantQuestion(question: string): Promise<void> {
    const trimmed = question.trim();
    if (!trimmed || this.assistantSending) return;
    this.assistantOpen = true;
    this.assistantError = '';
    this.assistantMessages.push({ role: 'visitor', text: trimmed });
    this.assistantSending = true;
    this.scrollAssistantToEnd();
    try {
      const result = await this.api.askAssistant(this.getAssistantConversationId(), trimmed);
      this.assistantMessages.push({ role: 'assistant', text: result.answer });
      this.assistantDraft = '';
    } catch (error) {
      this.assistantMessages.pop();
      this.assistantError = ApiService.errorMessage(error);
    } finally {
      this.assistantSending = false;
      this.scrollAssistantToEnd();
    }
  }

  private getAssistantConversationId(): string {
    if (this.assistantConversationId) return this.assistantConversationId;
    const key = 'lms_assistant_conversation_id';
    const stored = sessionStorage.getItem(key);
    this.assistantConversationId = stored ?? crypto.randomUUID();
    if (!stored) sessionStorage.setItem(key, this.assistantConversationId);
    return this.assistantConversationId;
  }

  private scrollAssistantToEnd(): void {
    this.changeDetector.detectChanges();
    if (this.assistantTranscript) {
      this.assistantTranscript.nativeElement.scrollTop = this.assistantTranscript.nativeElement.scrollHeight;
    }
  }

  showSlide(index: number): void {
    this.activeSlide = (index + this.slides.length) % this.slides.length;
    if (!this.isPaused) this.startAutoplay();
  }

  hideBrokenImage(event: Event): void {
    (event.target as HTMLImageElement).hidden = true;
  }

  toggleAutoplay(): void {
    this.isPaused = !this.isPaused;
    if (this.isPaused) this.stopAutoplay();
    else this.startAutoplay();
  }

  private startAutoplay(): void {
    this.stopAutoplay();
    this.autoplayTimer = window.setInterval(() => {
      this.activeSlide = (this.activeSlide + 1) % this.slides.length;
      this.changeDetector.detectChanges();
    }, 5000);
  }

  private stopAutoplay(): void {
    if (this.autoplayTimer !== undefined) {
      window.clearInterval(this.autoplayTimer);
      this.autoplayTimer = undefined;
    }
  }

}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <main class="auth-layout"><div class="auth-content"><a class="brand auth-brand" routerLink="/" aria-label="Refofe Novelty home"><img class="brand-logo" src="/images/refofe-novelty-logo.jpeg" alt="Refofe Novelty Proprietary Limited"></a>
      <section class="auth-card"><a routerLink="/" class="back-link">← Back to the website</a><h1>{{ isStaffPortal ? 'Sign in.' : 'Welcome back.' }}</h1><p class="auth-copy">{{ isStaffPortal ? 'Sign in to the secure staff workspace using your authorized staff account.' : 'Sign in to your account to track your KYC and loan applications.' }}</p>
        @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
        <form (ngSubmit)="submit()"><label>Email address<input type="email" name="email" [(ngModel)]="email" required autocomplete="username" [disabled]="mfaRequired"></label><label><span class="auth-label-row"><span>Password</span>@if (!isStaffPortal) { <a routerLink="/forgot-password">Forgot password?</a> }</span><input type="password" name="password" [(ngModel)]="password" required autocomplete="current-password" [disabled]="mfaRequired"></label>@if (mfaRequired) { <label>Authentication code<input type="text" name="mfaCode" [(ngModel)]="mfaCode" required inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label> }<button class="button button-primary button-full" [disabled]="busy">{{ busy ? 'Signing in…' : mfaRequired ? 'Verify and sign in' : 'Sign in' }}</button></form>
        @if (!isStaffPortal) {
          <div class="auth-account-prompt"><span>New to Refofe Novelty?</span><a routerLink="/register">Create an account</a></div>
        }
      </section></div><p class="auth-footnote">Your information is handled securely and used to support your account.</p>
    </main>
  `,
})
export class LoginPage {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly isStaffPortal = this.route.snapshot.data['portal'] === 'staff';
  email = '';
  password = '';
  mfaCode = '';
  mfaRequired = false;
  busy = false;
  error = '';

  async submit(): Promise<void> {
    this.error = '';
    this.busy = true;
    let awaitingMfaCode = false;
    try {
      this.mfaRequired = await this.api.login(this.email, this.password, this.mfaRequired ? this.mfaCode : undefined);
      if (this.mfaRequired) {
        awaitingMfaCode = true;
        return;
      }
      const role = this.api.user()?.role;
      const roleMatchesPortal = this.isStaffPortal
        ? role === 'admin' || role === 'loan_officer'
        : role === 'customer';
      if (!roleMatchesPortal) {
        this.api.logout();
        this.error = this.isStaffPortal
          ? 'This sign-in is for staff accounts. Please use the customer sign-in page for customer accounts.'
          : 'This sign-in is for customer accounts. Please use the staff sign-in page for internal accounts.';
        return;
      }
      this.clearCredentials();
      await this.router.navigateByUrl(role === 'admin' ? '/admin/dashboard' : role === 'loan_officer' ? '/officer/dashboard' : '/dashboard');
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      if (!awaitingMfaCode) this.clearCredentials();
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }

  private clearCredentials(): void {
    this.email = '';
    this.password = '';
    this.mfaCode = '';
    this.mfaRequired = false;
  }
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <main class="auth-layout"><div class="auth-content"><a class="brand auth-brand" routerLink="/" aria-label="Refofe Novelty home"><img class="brand-logo" src="/images/refofe-novelty-logo.jpeg" alt="Refofe Novelty Proprietary Limited"></a>
      <section class="auth-card"><a routerLink="/" class="back-link">← Back to the website</a><h1>Create your account.</h1><p class="auth-copy">A few details get you started. Email verification is required before you can apply.</p>
        @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
        <form (ngSubmit)="submit()"><label>Full name<input name="fullName" [(ngModel)]="fullName" required minlength="2" autocomplete="name"></label><label>Email address<input type="email" name="email" [(ngModel)]="email" required autocomplete="email"></label><label>Phone number <span class="optional">(optional)</span><input type="tel" name="phone" [(ngModel)]="phone" autocomplete="tel" placeholder="+267 7X XXX XXX"></label><label>Password<input type="password" name="password" [(ngModel)]="password" required minlength="8" autocomplete="new-password"></label><label>Marital status<select name="maritalStatus" [(ngModel)]="maritalStatus"><option value="single">Single</option><option value="married_in_community">Married in community of property</option><option value="married_out_of_community">Married out of community of property</option><option value="unknown">Prefer not to say</option></select></label><button class="button button-primary button-full" [disabled]="busy">{{ busy ? 'Creating account…' : 'Create account' }}</button></form><p class="auth-switch">Already have an account? <a routerLink="/login">Sign in</a></p>
      </section></div><p class="auth-footnote">By registering, you agree to provide accurate information for your application.</p>
    </main>
  `,
})
export class RegisterPage {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  fullName = '';
  email = '';
  phone = '';
  password = '';
  maritalStatus = 'single';
  busy = false;
  error = '';

  async submit(): Promise<void> {
    this.error = '';
    this.busy = true;
    const submittedEmail = this.email.trim();
    try {
      const result = await this.api.register({
        fullName: this.fullName,
        email: submittedEmail,
        password: this.password,
        phone: this.phone || undefined,
        maritalStatus: this.maritalStatus,
      });
      this.clearFields();
      await this.router.navigate(['/verify-email'], {
        queryParams: { email: submittedEmail, sent: result.verificationSent ? '1' : '0' },
      });
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.clearFields();
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }

  private clearFields(): void {
    this.fullName = '';
    this.email = '';
    this.phone = '';
    this.password = '';
    this.maritalStatus = 'single';
  }
}

@Component({
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="app-frame"><aside class="sidebar"><a class="brand sidebar-brand" [routerLink]="dashboardLink" aria-label="Refofe Novelty dashboard home"><img class="brand-logo" src="/images/refofe-novelty-logo.jpeg" alt="Refofe Novelty Proprietary Limited"></a><div class="workspace-label">WORKSPACE</div>
      <nav class="side-nav">
        <a [routerLink]="dashboardLink" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}"><svg class="side-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/></svg>Overview</a>
        <a routerLink="/messages" routerLinkActive="active">Messages@if (unreadCount) { <span class="nav-unread-badge">{{ unreadCount > 99 ? '99+' : unreadCount }}</span> }</a>
        @if (api.user()?.role === 'customer') {
          <a routerLink="/apply" routerLinkActive="active"><svg class="side-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Apply for a loan</a>
          <a routerLink="/settings" routerLinkActive="active">Personal settings</a>
        }
        @if (api.user()?.role === 'admin') {
          <a routerLink="/officer/kyc" routerLinkActive="active">KYC review</a>
          <a routerLink="/applications" routerLinkActive="active">Loans</a>
          <a routerLink="/admin/staff" routerLinkActive="active"><svg class="side-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 8v6m-3-3h6"/></svg>Manage users</a>
          <a routerLink="/admin/products" routerLinkActive="active"><svg class="side-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg>Loan products</a>
          <a routerLink="/admin/settings" routerLinkActive="active"><svg class="side-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.7-1.4-2.4L6.5 15a8 8 0 0 1 0-1.9l-1.4-1.2 1.4-2.4 1.7.7a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.7 1.4 2.4-1.4 1.2a8 8 0 0 1-.1 1.9z" transform="translate(0 -1)"/></svg>System settings</a>
          <a routerLink="/admin/audit-trail" routerLinkActive="active"><svg class="side-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Activity log</a>
        }
        @if (api.user()?.role === 'loan_officer') {
          <a routerLink="/settings" routerLinkActive="active">Personal settings</a>
          <a routerLink="/officer/kyc" routerLinkActive="active">KYC review</a>
          <a routerLink="/applications" routerLinkActive="active"><svg class="side-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>Loans</a>
          <a routerLink="/officer/repayments" routerLinkActive="active"><svg class="side-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M8 15h3"/></svg>Record repayment</a>
          <a routerLink="/portfolio-at-risk" routerLinkActive="active"><svg class="side-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M13 3.1A9 9 0 0 1 20.9 11H13z"/></svg>Portfolio at risk</a>
          <a routerLink="/officer/reports" routerLinkActive="active"><svg class="side-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5m0 14h17"/><rect x="7" y="11" width="3" height="6" rx="1"/><rect x="13" y="8" width="3" height="9" rx="1"/><rect x="19" y="4" width="3" height="13" rx="1"/></svg>Aging &amp; collections</a>
          <a routerLink="/complaints" routerLinkActive="active"><svg class="side-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></svg>Complaints</a>
        }
      </nav><div class="sidebar-bottom"><div class="sidebar-help"><b>Need a hand?</b><span>Our team is here to help.</span><a routerLink="/">Visit public site →</a></div><div class="sidebar-account">
        <div class="notification-control">
          <button class="notification-bell" type="button" (click)="toggleNotifications()" [attr.aria-expanded]="notificationsOpen" [attr.aria-label]="notificationBadgeCount + ' unread notifications'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
            @if (notificationBadgeCount) { <span class="notification-count">{{ notificationBadgeCount > 99 ? '99+' : notificationBadgeCount }}</span> }
          </button>
          @if (notificationsOpen) {
            <section class="notification-menu" aria-label="Notifications">
              <div class="notification-menu-heading"><b>Notifications</b><span>{{ notificationBadgeCount ? notificationBadgeCount + ' unread' : 'All caught up' }}</span></div>
              @if (notificationError) { <p class="notification-error">{{ notificationError }}</p> }
              @if (unreadThreads.length) {
                <h3 class="notification-section-title">Messages</h3>
                @for (thread of unreadThreads.slice(0, 8); track thread.id) {
                  <button type="button" class="notification-item" (click)="openNotification(thread)">
                    <span class="notification-item-top"><b>{{ thread.lastSenderName }}</b><time>{{ notificationTime(thread.lastMessageAt || thread.updatedAt) }}</time></span>
                    <strong>{{ thread.subject }}</strong><span>{{ thread.lastMessage }}</span>
                    <small>{{ thread.unreadCount }} unread message{{ thread.unreadCount === 1 ? '' : 's' }}</small>
                  </button>
                }
              } @else if (api.user()?.role !== 'customer' && !notificationError) {
                <h3 class="notification-section-title">Messages</h3><p class="notification-empty">No new messages.</p>
              }
              @if (api.user()?.role === 'customer') {
                <h3 class="notification-section-title">Account updates</h3>
                @if (systemNotifications.length) {
                  @for (notification of systemNotifications.slice(0, 10); track notification.id) {
                    <button type="button" class="system-notification-item" [class.system-notification-unread]="!notification.readAt" [attr.aria-label]="'Open notification: ' + notification.message" (click)="openSystemNotification(notification)">
                      <span class="system-notification-dot" aria-hidden="true"></span>
                      <span><p>{{ notification.message }}</p><time>{{ notificationTime(notification.createdAt) }}</time></span>
                    </button>
                  }
                } @else if (!notificationError) { <p class="notification-empty">No account updates yet.</p> }
              }
              <button type="button" class="notification-view-all" (click)="viewAllMessages()">Open message inbox</button>
            </section>
          }
        </div>
        <a class="user-chip sidebar-profile" routerLink="/profile" aria-label="View and edit profile">
          <span class="avatar">@if (api.profilePictureUrl()) { <img [src]="api.profilePictureUrl()" alt="Profile picture"> } @else { {{ initials }} }</span>
          <span><b>{{ api.user()?.fullName || 'Profile' }}</b>@if (roleLabel) { <small>{{ roleLabel }}</small> }</span>
        </a>
        <button class="logout-link" type="button" (click)="logout()" aria-label="Sign out" title="Sign out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg></button>
      </div></div></aside>
      <div class="main-column"><main class="workspace-content"><router-outlet /></main></div>
    </div>
    @if (newMessageNotice && !notificationsOpen) {
      <button type="button" class="new-message-toast" (click)="openNotification(newMessageNotice)">
        <span class="toast-icon" aria-hidden="true">●</span><span><b>New message</b><small>{{ newMessageNotice.lastSenderName }} · {{ newMessageNotice.subject }}</small></span><span aria-hidden="true">›</span>
      </button>
    }
  `,
})
export class AppShell implements OnInit, OnDestroy {
  readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private presenceHandle: ReturnType<typeof setInterval> | null = null;
  private hasNotificationBaseline = false;
  private previousUnreadTotal = 0;
  notificationThreads: MessageSummary[] = [];
  unreadCount = 0;
  systemNotifications: InAppNotification[] = [];
  unreadSystemCount = 0;
  notificationsOpen = false;
  notificationError = '';
  newMessageNotice: MessageSummary | null = null;

  get unreadThreads(): MessageSummary[] {
    return this.notificationThreads.filter((thread) => thread.unreadCount > 0);
  }

  get notificationBadgeCount(): number {
    return this.unreadCount + this.unreadSystemCount;
  }

  ngOnInit(): void {
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationEnd && event.urlAfterRedirects.startsWith('/messages')) {
        const threadId = Number(this.router.parseUrl(event.urlAfterRedirects).queryParams['thread']);
        if (Number.isSafeInteger(threadId) && threadId > 0) this.markThreadRead(threadId);
      }
    });
    void this.refreshProfile();
    void this.refreshNotifications();
    this.pollHandle = setInterval(() => void this.refreshNotifications(), 15000);
    if (this.api.user() && this.api.token) {
      void this.updatePresence(true);
      this.presenceHandle = setInterval(() => void this.updatePresence(true), 15000);
    }
  }

  ngOnDestroy(): void {
    if (this.pollHandle !== null) clearInterval(this.pollHandle);
    if (this.presenceHandle !== null) clearInterval(this.presenceHandle);
  }

  async refreshNotifications(): Promise<boolean> {
    try {
      const threads = await this.api.messageInbox();
      const unreadTotal = threads.reduce((total, thread) => total + thread.unreadCount, 0);
      if (this.hasNotificationBaseline && unreadTotal > this.previousUnreadTotal) {
        this.newMessageNotice = threads.find((thread) => thread.unreadCount > 0) ?? null;
      }
      this.previousUnreadTotal = unreadTotal;
      this.hasNotificationBaseline = true;
      this.notificationThreads = threads;
      this.unreadCount = unreadTotal;
      if (this.api.user()?.role === 'customer') {
        const [systemNotifications, unreadSystemCount] = await Promise.all([
          this.api.myNotifications(),
          this.api.myUnreadNotificationCount(),
        ]);
        this.systemNotifications = systemNotifications;
        this.unreadSystemCount = unreadSystemCount;
      }
      this.notificationError = '';
      return true;
    } catch (error) {
      this.notificationError = ApiService.errorMessage(error);
      return false;
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  private async refreshProfile(): Promise<void> {
    try {
      this.api.setCurrentProfile(await this.api.myProfile());
    } catch (error) {
      console.error('Unable to load the current user profile', error);
    }
  }

  async toggleNotifications(): Promise<void> {
    this.notificationsOpen = !this.notificationsOpen;
    this.newMessageNotice = null;
    if (this.notificationsOpen) {
      const refreshed = await this.refreshNotifications();
      if (refreshed && this.api.user()?.role === 'customer') await this.markAccountUpdatesRead();
    }
  }

  private async markAccountUpdatesRead(): Promise<void> {
    try {
      await this.api.markMyNotificationsRead();
      this.systemNotifications = this.systemNotifications.map((notification) =>
        notification.readAt ? notification : { ...notification, readAt: new Date().toISOString() });
      this.unreadSystemCount = 0;
      this.notificationError = '';
    } catch (error) {
      this.notificationError = ApiService.errorMessage(error);
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  private markThreadRead(threadId: number): void {
    this.notificationThreads = this.notificationThreads.map((thread) =>
      thread.id === threadId ? { ...thread, unreadCount: 0 } : thread);
    this.unreadCount = this.notificationThreads.reduce((total, thread) => total + thread.unreadCount, 0);
  }

  openNotification(thread: MessageSummary): void {
    this.notificationsOpen = false;
    this.newMessageNotice = null;
    this.notificationThreads = this.notificationThreads.map((item) =>
      item.id === thread.id ? { ...item, unreadCount: 0 } : item);
    this.unreadCount = this.notificationThreads.reduce((total, item) => total + item.unreadCount, 0);
    void this.router.navigate(['/messages'], { queryParams: { thread: thread.id } });
  }

  openSystemNotification(notification: InAppNotification): void {
    this.notificationsOpen = false;
    const id = notification.referenceId;
    if (id && id > 0 && notification.referenceType === 'application') {
      void this.router.navigate(['/my-applications', id]);
    } else if (id && id > 0 && notification.referenceType === 'kyc') {
      void this.router.navigate(['/apply'], { queryParams: { case: id } });
    } else if (id && id > 0 && notification.referenceType === 'loan') {
      void this.router.navigate(['/loans', id]);
    } else if (notification.triggerType.startsWith('kyc_')) {
      void this.router.navigateByUrl('/apply');
    } else if (notification.triggerType.startsWith('application_')) {
      void this.router.navigateByUrl('/dashboard');
    } else {
      void this.router.navigateByUrl('/dashboard');
    }
  }

  viewAllMessages(): void {
    this.notificationsOpen = false;
    this.newMessageNotice = null;
    void this.router.navigateByUrl('/messages');
  }

  notificationTime(value: string): string {
    if (!value) return '';
    const date = new Date(value);
    const elapsed = Date.now() - date.getTime();
    if (elapsed < 60_000) return 'now';
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
    if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
    return date.toLocaleDateString();
  }

  get dashboardLink(): string {
    const role = this.api.user()?.role;
    return role === 'admin' ? '/admin/dashboard' : role === 'loan_officer' ? '/officer/dashboard' : '/dashboard';
  }
  get initials(): string {
    return (this.api.user()?.fullName ?? 'U').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }
  get roleLabel(): string {
    const role = this.api.user()?.role;
    return role === 'admin' ? 'System administrator' : role === 'loan_officer' ? 'Loan officer' : '';
  }
  logout(): void {
    if (this.presenceHandle !== null) clearInterval(this.presenceHandle);
    if (this.api.user() && this.api.token) void this.updatePresence(false);
    this.api.logout();
    void this.router.navigateByUrl('/');
  }

  private async updatePresence(online: boolean): Promise<void> {
    try {
      await this.api.updateMessagePresence(online);
    } catch (error) {
      console.error('Unable to update messaging presence', error);
    }
  }
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-heading"><div><div class="eyebrow">YOUR DETAILS</div><h1>Profile</h1><p>Update the name and phone number shown on your account and choose a profile picture.</p></div><a [routerLink]="dashboardLink" class="back-link">← Dashboard</a></div>
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    @if (success) { <div class="notice notice-success" role="status">{{ success }}</div> }
    @if (loading) { <p class="loading-note">Loading your profile…</p> }
    @if (!loading) {
      <section class="panel profile-panel">
        <div class="profile-picture-section">
          <span class="profile-picture avatar">
            @if (api.profilePictureUrl()) { <img [src]="api.profilePictureUrl()" alt="Your profile picture"> }
            @else { {{ initials }} }
          </span>
          <div><b>Profile picture</b><p class="small-note">JPEG or PNG, up to 2 MB.</p>
            <label class="button button-secondary profile-upload">Choose picture<input type="file" accept="image/jpeg,image/png" (change)="uploadPicture($event)"></label>
            @if (api.profilePictureUrl()) { <button type="button" class="text-button" [disabled]="pictureBusy" (click)="removePicture()">Remove picture</button> }
          </div>
        </div>
        <form class="form-panel profile-form" (ngSubmit)="save()">
          <label>Full name<input name="fullName" [(ngModel)]="fullName" required minlength="2" maxlength="255" autocomplete="name"></label>
          <label>Email address<input name="email" type="email" [value]="email" readonly><span class="small-note">Contact support if you need to change your email address.</span></label>
          <label>Phone number <span class="optional">(optional)</span><input name="phone" type="tel" [(ngModel)]="phone" maxlength="50" autocomplete="tel" placeholder="+267 7X XXX XXX"></label>
          <button class="button button-primary" type="submit" [disabled]="busy">{{ busy ? 'Saving…' : 'Save profile' }}</button>
        </form>
      </section>
    }
  `,
})
export class ProfilePage implements OnInit {
  readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  fullName = '';
  email = '';
  phone: string | null = null;
  loading = true;
  busy = false;
  pictureBusy = false;
  error = '';
  success = '';

  get initials(): string {
    return (this.fullName || this.api.user()?.fullName || 'U')
      .split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }

  get dashboardLink(): string {
    const role = this.api.user()?.role;
    return role === 'admin' ? '/admin/dashboard' : role === 'loan_officer' ? '/officer/dashboard' : '/dashboard';
  }

  async ngOnInit(): Promise<void> {
    try {
      this.applyProfile(await this.api.myProfile());
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }

  async save(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      this.applyProfile(await this.api.updateMyProfile(this.fullName, this.phone));
      this.success = 'Your profile has been saved.';
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }

  async uploadPicture(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024 || !['image/jpeg', 'image/png'].includes(file.type)) {
      this.error = 'Choose a JPEG or PNG image no larger than 2 MB.';
      return;
    }
    this.pictureBusy = true;
    this.error = '';
    this.success = '';
    try {
      this.applyProfile(await this.api.uploadProfilePicture(file));
      this.success = 'Your profile picture has been updated.';
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.pictureBusy = false;
      this.changeDetector.detectChanges();
    }
  }

  async removePicture(): Promise<void> {
    this.pictureBusy = true;
    this.error = '';
    this.success = '';
    try {
      this.applyProfile(await this.api.removeProfilePicture());
      this.success = 'Your profile picture has been removed.';
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.pictureBusy = false;
      this.changeDetector.detectChanges();
    }
  }

  private applyProfile(profile: UserProfile): void {
    this.fullName = profile.fullName;
    this.email = profile.email;
    this.phone = profile.phone;
    this.api.setCurrentProfile(profile);
  }
}

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="messages-page">
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    <div class="message-layout" [class.mobile-chat-open]="activeThread || showNewChat">
      <section class="panel message-inbox">
        <div class="message-inbox-heading"><div class="message-inbox-title"><h2>Chats</h2>@if (canCompose) { <button class="message-new-chat" type="button" (click)="startNewChat()" aria-label="Start a new chat" title="New chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button> }</div><div class="message-inbox-actions"><p>Your conversations</p><button class="button button-secondary" type="button" (click)="loadInbox()" [disabled]="loadingInbox">Refresh</button></div></div>
        @if (loadingInbox) { <p class="loading-note">Loading your messages…</p> }
        @else if (threads.length) {
          <div class="message-thread-list">@for (thread of threads; track thread.id) {
            <button type="button" class="message-thread-item" [class.selected]="activeThread?.id === thread.id" (click)="openThread(thread)">
              <span class="message-thread-avatar" aria-hidden="true">{{ threadTitle(thread).slice(0, 1).toUpperCase() }}</span>
              <span class="message-thread-heading"><b>{{ threadTitle(thread) }}</b>@if (thread.unreadCount) { <span class="pill">{{ thread.unreadCount }} new</span> }</span>
              <span class="message-preview">{{ thread.lastSenderName }}: {{ thread.lastMessage }}</span>
              <time>{{ chatListTime(thread.lastMessageAt || thread.updatedAt) }}</time>
            </button>
          }</div>
        } @else { <div class="empty-state compact"><p>Your inbox is empty.</p></div> }
      </section>
      <section class="panel message-conversation">
        @if (canCompose && showNewChat) {
          <div class="message-conversation-heading new-chat-heading"><button class="mobile-chat-back" type="button" (click)="backToInbox()" aria-label="Back to chats"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12"/></svg></button><span class="message-conversation-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 8v6m-3-3h6"/></svg></span><div><h2>New message</h2><p>{{ isAdmin ? 'Choose one or more loan officers or send a group broadcast.' : 'Choose one customer to start a conversation.' }}</p></div><button class="message-close-chat" type="button" (click)="cancelNewChat()" aria-label="Close new chat">×</button></div>
          <form class="new-chat-form" (ngSubmit)="sendMessage()">
            @if (!allRecipients) {
              <label class="new-chat-search"><span>To</span><input name="recipientSearch" [(ngModel)]="recipientSearch" placeholder="Search available people by name or email" autocomplete="off"></label>
              <div class="new-chat-recipient-list" role="group" aria-label="Available people">
                @if (recipientsLoading) { <p class="new-chat-no-results">Loading available people…</p> }
                @else {
                  @for (recipient of filteredRecipients; track recipient.id) {
                    <button class="new-chat-recipient" type="button" (click)="openRecipient(recipient)" [disabled]="busy">
                      <span class="new-chat-recipient-avatar" aria-hidden="true">{{ recipient.fullName.slice(0, 1).toUpperCase() }}</span>
                      <span class="new-chat-recipient-details"><b>{{ recipient.fullName }}</b><small>{{ recipient.email }}</small></span>
                      <span class="new-chat-recipient-open" aria-hidden="true">›</span>
                    </button>
                  }
                  @if (!filteredRecipients.length) { <p class="new-chat-no-results">No available people match that search.</p> }
                }
              </div>
            } @else { <p class="new-chat-selected">This message will be sent as one read-only group broadcast to {{ recipients.length }} {{ recipientAudience.toLowerCase() }}.</p> }
            @if (allRecipients) { <label class="new-chat-subject">Group title<input name="subject" [(ngModel)]="subject" maxlength="200" placeholder="Group broadcast"></label> }
            @if (allRecipients) { <div class="message-composer-tools new-chat-composer-tools">
              <button type="button" class="composer-tool" (click)="emojiOpen = !emojiOpen" aria-label="Choose emoji" title="Choose emoji"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3h4.5A4.5 4.5 0 0 1 21 7.5V12a9 9 0 1 1-9-9Z"></path><path d="M21 12a9 9 0 0 1-9 9M8.5 10h.01M15.5 10h.01M8.5 14s1.25 2 3.5 2 3.5-2 3.5-2"></path></svg></button>
              <label class="composer-tool" aria-label="Attach image or document" title="Attach image or document"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.1-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"></path></svg><input type="file" accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx" multiple (change)="addAttachments($event)"></label>
            </div>
            @if (emojiOpen) { <div class="emoji-picker" aria-label="Choose an emoji">@for (emoji of emojis; track emoji) { <button type="button" (click)="insertEmoji(emoji, 'new')" [attr.aria-label]="'Insert ' + emoji">{{ emoji }}</button> }</div> }
            <div class="new-chat-message"><textarea name="message" [(ngModel)]="messageText" maxlength="10000" rows="3" placeholder="Write your broadcast"></textarea></div>
            <div class="chat-attachments">@for (file of attachmentFiles; track $index; let index = $index) { <span class="chat-file-chip">{{ file.name }}<button type="button" (click)="removeAttachment(index)" [attr.aria-label]="'Remove ' + file.name">×</button></span> }</div>
            }
            <div class="new-chat-actions">@if (isAdmin) { <label class="settings-toggle new-chat-broadcast"><input type="checkbox" name="allRecipients" [(ngModel)]="allRecipients">Send to all loan officers (group broadcast)</label> }<div><button class="button button-quiet" type="button" (click)="cancelNewChat()">Cancel</button>@if (allRecipients) { <button class="button button-primary" type="submit" [disabled]="busy || (!messageText.trim() && !attachmentFiles.length) || !recipients.length" aria-label="Send broadcast"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg></button> }</div></div>
          </form>
        } @else if (activeThread) {
          <div class="message-conversation-heading"><button class="mobile-chat-back" type="button" (click)="backToInbox()" aria-label="Back to chats"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12"/></svg></button><span class="message-conversation-avatar" aria-hidden="true">{{ threadTitle(activeThread).slice(0, 1).toUpperCase() }}</span><div><h2>{{ threadTitle(activeThread) }}</h2></div></div>
          <div class="message-posts">
            @for (post of activeThread.messages; track post.id) {
              <article class="message-post" [class.message-post-own]="post.senderId === currentUserId">
                <div class="message-post-meta"><b>{{ post.senderName }}@if (post.senderId === currentUserId) { (you) }</b><span class="message-post-time"><time>{{ messageTime(post.createdAt) }}</time>@if (post.senderId === currentUserId && post.deliveryStatus) { <svg class="message-delivery-tick" [class.message-delivery-read]="post.deliveryStatus === 'read'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" role="img" [attr.aria-label]="post.deliveryStatus === 'read' ? 'Read' : post.deliveryStatus === 'delivered' ? 'Delivered' : 'Sent'">@if (post.deliveryStatus === 'sent') { <path d="m4 12 4 4L18 6"></path> } @else { <path d="m1 12 4 4L15 6M9 12l4 4 10-10"></path> }</svg> }</span></div>
                @if (post.body !== '📷 Photo' && post.body !== '📎 Attachment') { <p>{{ post.body }}</p> }
                @for (attachment of post.attachments || []; track attachment.id) {
                  <button type="button" class="message-attachment" (click)="downloadAttachment(attachment)">
                    <span class="message-attachment-icon" aria-hidden="true">{{ attachment.contentType.startsWith('image/') ? '▧' : '↧' }}</span>
                    <span><b>{{ attachment.originalName }}</b><small>{{ formatFileSize(attachment.sizeBytes) }}</small></span>
                  </button>
                }
              </article>
            }
          </div>
          @if (!activeThread.isBroadcast || isBroadcastSender(activeThread)) {
            <form class="message-reply" (ngSubmit)="reply()">
              @if (emojiOpen) { <div class="emoji-picker" aria-label="Choose an emoji">@for (emoji of emojis; track emoji) { <button type="button" (click)="insertEmoji(emoji, 'reply')" [attr.aria-label]="'Insert ' + emoji">{{ emoji }}</button> }</div> }
              <div class="chat-attachments">@for (file of attachmentFiles; track $index; let index = $index) { <span class="chat-file-chip">{{ file.name }}<button type="button" (click)="removeAttachment(index)" [attr.aria-label]="'Remove ' + file.name">×</button></span> }</div>
              <div class="message-composer-field">
                <button type="button" class="composer-tool" (click)="emojiOpen = !emojiOpen" aria-label="Choose emoji" title="Choose emoji"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3h4.5A4.5 4.5 0 0 1 21 7.5V12a9 9 0 1 1-9-9Z"></path><path d="M21 12a9 9 0 0 1-9 9M8.5 10h.01M15.5 10h.01M8.5 14s1.25 2 3.5 2 3.5-2 3.5-2"></path></svg></button>
                <label class="composer-tool" aria-label="Attach image or document" title="Attach image or document"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.1-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"></path></svg><input type="file" accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx" multiple (change)="addAttachments($event)"></label>
                <textarea name="reply" [(ngModel)]="replyText" maxlength="10000" rows="1" [placeholder]="activeThread.isBroadcast ? 'Write an update for the group' : 'Type a message'"></textarea>
              </div>
              <button class="message-send-button" type="submit" [disabled]="busy || (!replyText.trim() && !attachmentFiles.length)" [attr.aria-label]="activeThread.isBroadcast ? 'Send update' : 'Send message'" [title]="activeThread.isBroadcast ? 'Send update' : 'Send message'"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"></path></svg></button>
            </form>
          } @else { <p class="broadcast-readonly-notice">This is a broadcast conversation. Replies are disabled.</p> }
        } @else { <div class="empty-state message-empty-state"><span class="message-empty-icon" aria-hidden="true">•••</span><h3>Your messages</h3><p>Select a conversation to read and reply, or start a new chat.</p>@if (canCompose) { <button class="button button-primary" type="button" (click)="startNewChat()">＋ New chat</button> }</div> }
      </section>
    </div>
    </div>
  `,
})
export class MessageCenterPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  readonly currentUserId = this.api.user()?.id;
  readonly isAdmin = this.api.user()?.role === 'admin';
  readonly canCompose = this.api.user()?.role === 'loan_officer' || this.isAdmin;
  readonly recipientAudience = this.api.user()?.role === 'admin' ? 'Loan officers' : 'Customers';
  recipients: MessageRecipient[] = [];
  threads: MessageSummary[] = [];
  activeThread: MessageThread | null = null;
  selectedRecipientIds = new Set<number>();
  showNewChat = false;
  subject = '';
  messageText = '';
  replyText = '';
  attachmentFiles: File[] = [];
  emojiOpen = false;
  readonly emojis = ['😀', '😃', '😄', '😂', '😊', '😉', '😍', '😎', '👍', '🙏', '❤️', '🎉', '✅', '🙌'];
  recipientSearch = '';
  allRecipients = false;
  busy = false;
  loadingInbox = true;
  error = '';
  success = '';
  recipientsLoading = false;

  get filteredRecipients(): MessageRecipient[] {
    const term = this.recipientSearch.trim().toLowerCase();
    return this.recipients.filter((recipient) =>
      !term || recipient.fullName.toLowerCase().includes(term) || recipient.email.toLowerCase().includes(term));
  }

  threadTitle(thread: MessageSummary | MessageThread): string {
    if (thread.isBroadcast) return thread.subject || 'Group broadcast';
    if ('participants' in thread && Array.isArray(thread.participants)) {
      return thread.participants.find((participant) => participant.id !== this.currentUserId)?.fullName
        ?? thread.subject;
    }
    return typeof thread.participants === 'string' ? thread.participants || thread.subject : thread.subject;
  }

  isBroadcastSender(thread: MessageSummary | MessageThread): boolean {
    return thread.isBroadcast && thread.createdBy === this.currentUserId;
  }

  chatListTime(value: string): string {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';

    const today = new Date();
    const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const daysAgo = Math.round((todayDay - dateDay) / 86_400_000);

    if (daysAgo === 0) return this.messageTime(value);
    if (daysAgo === 1) return 'Yesterday';
    return date.toLocaleDateString();
  }

  messageTime(value: string): string {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime())
      ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '';
  }

  async ngOnInit(): Promise<void> {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const threadId = Number(params.get('thread'));
      if (Number.isSafeInteger(threadId) && threadId > 0 && this.activeThread?.id !== threadId) {
        void this.openThreadById(threadId);
      }
    });
    const requests: Promise<unknown>[] = [this.loadInbox()];
    if (this.canCompose) {
      this.recipientsLoading = true;
      requests.push(this.api.messageRecipients().then((users) => { this.recipients = users; }));
    }
    this.pollHandle = setInterval(() => void this.refreshMessages(), 15000);
    try {
      await Promise.all(requests);
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.recipientsLoading = false;
      this.changeDetector.detectChanges();
    }
  }

  ngOnDestroy(): void {
    if (this.pollHandle !== null) clearInterval(this.pollHandle);
  }

  private async refreshMessages(): Promise<void> {
    try {
      const [threads, activeThread] = await Promise.all([
        this.api.messageInbox(),
        this.activeThread ? this.api.messageThread(this.activeThread.id) : Promise.resolve(null),
      ]);
      this.threads = threads;
      if (activeThread) {
        this.activeThread = activeThread;
        this.threads = this.threads.map((thread) =>
          thread.id === activeThread.id ? { ...thread, unreadCount: 0 } : thread);
      }
      this.error = '';
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  async loadInbox(): Promise<void> {
    this.loadingInbox = true;
    try {
      this.threads = await this.api.messageInbox();
      if (this.activeThread) {
        const refreshed = this.threads.find((thread) => thread.id === this.activeThread?.id);
        if (!refreshed) this.activeThread = null;
      }
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.loadingInbox = false;
      this.changeDetector.detectChanges();
    }
  }

  toggleRecipient(id: number, event: Event): void {
    if ((event.target as HTMLInputElement).checked) {
      if (!this.isAdmin) this.selectedRecipientIds.clear();
      this.selectedRecipientIds.add(id);
    }
    else this.selectedRecipientIds.delete(id);
  }

  async openRecipient(recipient: MessageRecipient): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      const { threadId } = await this.api.openDirectMessage(recipient.id);
      this.showNewChat = false;
      this.recipientSearch = '';
      this.selectedRecipientIds.clear();
      await this.loadInbox();
      await this.openThreadById(threadId);
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { thread: threadId },
        queryParamsHandling: 'merge',
      });
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }

  startNewChat(): void {
    this.activeThread = null;
    this.showNewChat = true;
    this.subject = '';
    this.messageText = '';
    this.attachmentFiles = [];
    this.emojiOpen = false;
    this.recipientSearch = '';
    this.selectedRecipientIds.clear();
    this.allRecipients = false;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { thread: null },
      queryParamsHandling: 'merge',
    });
  }

  cancelNewChat(): void {
    this.showNewChat = false;
    this.selectedRecipientIds.clear();
    this.subject = '';
    this.messageText = '';
    this.attachmentFiles = [];
    this.emojiOpen = false;
    this.recipientSearch = '';
    this.allRecipients = false;
  }

  backToInbox(): void {
    this.cancelNewChat();
    this.activeThread = null;
    this.replyText = '';
    this.attachmentFiles = [];
    this.emojiOpen = false;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { thread: null },
      queryParamsHandling: 'merge',
    });
  }

  async sendMessage(): Promise<void> {
    if (this.allRecipients && !this.isAdmin) {
      this.error = 'Only administrators can send group broadcasts.';
      return;
    }
    this.busy = true;
    this.error = '';
    try {
      const input = {
        subject: this.allRecipients || this.selectedRecipientIds.size > 1
          ? this.subject.trim()
          : this.recipients.find((recipient) => this.selectedRecipientIds.has(recipient.id))?.fullName ?? '',
        message: this.messageText.trim(),
        recipientIds: [...this.selectedRecipientIds],
        allRecipients: this.allRecipients,
      };
      const created = this.attachmentFiles.length
        ? await this.api.createMessageWithAttachments({ ...input, files: this.attachmentFiles })
        : await this.api.createMessage(input);
      this.subject = '';
      this.messageText = '';
      this.attachmentFiles = [];
      this.selectedRecipientIds.clear();
      this.allRecipients = false;
      this.showNewChat = false;
      this.recipientSearch = '';
      await this.loadInbox();
      const thread = this.threads.find((item) => item.id === created.threadIds[0]);
      if (thread) await this.openThread(thread);
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }

  async openThread(thread: MessageSummary): Promise<void> {
    await this.openThreadById(thread.id);
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { thread: thread.id },
      queryParamsHandling: 'merge',
    });
  }

  private async openThreadById(threadId: number): Promise<void> {
    this.error = '';
    this.showNewChat = false;
    try {
      this.activeThread = await this.api.messageThread(threadId);
      this.threads = this.threads.map((item) =>
        item.id === threadId ? { ...item, unreadCount: 0 } : item);
      this.replyText = '';
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  async reply(): Promise<void> {
    if (!this.activeThread) return;
    this.busy = true;
    this.error = '';
    try {
      await this.api.sendMessageToThread(this.activeThread.id, this.replyText.trim(), this.attachmentFiles);
      this.replyText = '';
      this.attachmentFiles = [];
      this.emojiOpen = false;
      this.activeThread = await this.api.messageThread(this.activeThread.id);
      await this.loadInbox();
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }

  addAttachments(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selected = Array.from(input.files ?? []);
    input.value = '';
    if (this.attachmentFiles.length + selected.length > 3) {
      this.error = 'Attach up to 3 files to one message.';
      return;
    }
    const maxSize = 8 * 1024 * 1024;
    const invalid = selected.find((file) => file.size === 0 || file.size > maxSize);
    if (invalid) {
      this.error = `${invalid.name} is empty or larger than 8 MB.`;
      return;
    }
    this.attachmentFiles = [...this.attachmentFiles, ...selected];
    this.error = '';
  }

  removeAttachment(index: number): void {
    this.attachmentFiles = this.attachmentFiles.filter((_, fileIndex) => fileIndex !== index);
  }

  insertEmoji(emoji: string, target: 'new' | 'reply'): void {
    if (target === 'new') this.messageText += emoji;
    else this.replyText += emoji;
    this.emojiOpen = false;
  }

  async downloadAttachment(attachment: { id: number; originalName: string }): Promise<void> {
    try {
      const blob = await this.api.downloadMessageAttachment(attachment.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.originalName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.changeDetector.detectChanges();
    }
  }

  formatFileSize(size: number): string {
    return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  date(value: string): string {
    return value ? new Date(value).toLocaleString() : '';
  }
}

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-heading"><div><div class="eyebrow">LOAN SERVICING</div><h1>Record a repayment</h1><p>Record a borrower payment against their loan account.</p></div></div>
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    @if (result) { <div class="notice notice-success" role="status">Repayment recorded. Principal: {{ formatMoney(result['principalApplied']) }} · Interest: {{ formatMoney(result['interestApplied']) }}@if (hasUnallocatedOverpayment) { · Unallocated overpayment: {{ formatMoney(result['unallocatedOverpayment']) }} }</div> }
    <section class="panel"><form class="form-panel" (ngSubmit)="record()"><label>Loan account number<input type="number" name="loanId" [(ngModel)]="loanId" required min="1" step="1"></label><label>Payment amount (Pula)<input type="number" name="amount" [(ngModel)]="amount" required min="0.01" step="0.01"></label><p class="small-note">The system allocates payments to outstanding instalments and records the accounting entries.</p><button class="button button-primary" [disabled]="busy">{{ busy ? 'Recording…' : 'Record repayment' }}</button></form></section>
  `,
})
export class RepaymentPage {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly formatMoney = money;
  loanId: number | null = null;
  amount: number | null = null;
  result: Row | null = null;
  error = '';
  busy = false;

  get hasUnallocatedOverpayment(): boolean {
    return Number(this.result?.['unallocatedOverpayment'] ?? 0) > 0;
  }

  async record(): Promise<void> {
    this.error = '';
    this.result = null;
    if (!this.loanId || !this.amount || this.loanId < 1 || this.amount <= 0) {
      this.error = 'Enter a valid loan account number and payment amount.';
      return;
    }
    if (!confirm(`Record a payment of ${money(this.amount)} for loan account #${this.loanId}?`)) return;
    this.busy = true;
    try {
      this.result = await this.api.recordRepayment(this.loanId, this.amount);
      this.amount = null;
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  template: `
    <div class="page-heading"><div><div class="eyebrow">PORTFOLIO REPORTING</div><h1>Aging &amp; collections</h1><p>Review overdue instalments by age and compare monthly loan disbursements with collections.</p></div></div>
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    <section class="panel"><div class="panel-heading"><div><h2>Aging analysis</h2><p>Overdue or partially paid instalments grouped by days overdue.</p></div></div>
      @if (aging.length) { <div class="table-wrap"><table><thead><tr><th>Borrower</th><th>Loan account</th><th>Due date</th><th>Days overdue</th><th>Age bucket</th><th>Outstanding instalment</th></tr></thead><tbody>@for (row of aging; track row['schedule_entry_id']) { <tr><td>{{ row['borrower'] }}</td><td>#{{ row['loan_account_id'] }}</td><td>{{ date(row['due_date']) }}</td><td>{{ row['days_overdue'] }}</td><td><span class="pill pill-danger">{{ row['bucket'] }}</span></td><td>{{ formatMoney(row['total_due']) }}</td></tr> }</tbody></table></div> } @else if (!loading) { <div class="empty-state compact"><p>No overdue instalments to report.</p></div> }
    </section>
    <section class="panel"><div class="panel-heading"><div><h2>Disbursements vs collections</h2><p>Monthly totals recorded by the system.</p></div></div>
      @if (collections.length) { <div class="table-wrap"><table><thead><tr><th>Month</th><th>Disbursed</th><th>Collected</th></tr></thead><tbody>@for (row of collections; track row['month']) { <tr><td>{{ date(row['month']) }}</td><td>{{ formatMoney(row['disbursed']) }}</td><td>{{ formatMoney(row['collected']) }}</td></tr> }</tbody></table></div> } @else if (!loading) { <div class="empty-state compact"><p>No disbursement or collection activity to report.</p></div> }
    </section>
    @if (loading) { <p class="loading-note">Loading portfolio reports…</p> }
  `,
})
export class OfficerReportsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly formatMoney = money;
  aging: Row[] = [];
  collections: Row[] = [];
  error = '';
  loading = true;

  async ngOnInit(): Promise<void> {
    try {
      [this.aging, this.collections] = await Promise.all([
        this.api.agingReport(),
        this.api.collectionsReport(),
      ]);
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }

  date(value: unknown): string {
    return value ? new Date(String(value)).toLocaleDateString() : '—';
  }
}

@Component({
  standalone: true,
  template: `
    <div class="page-heading"><div><div class="eyebrow">YOUR ACCOUNT</div><h1>{{ greeting }}</h1><p>A clear view of your applications and loans.</p></div><a class="button button-primary" routerLink="/apply">＋ New application</a></div>
    @if (error) { <div class="notice notice-error">{{ error }}</div> }
    @if (statusMessage) { <div class="notice notice-success">{{ statusMessage }}</div> }
    @if (api.user()?.emailVerified === false) { <div class="notice notice-warning verification-banner"><div><b>Verify your email address</b><span>Check your inbox. You’ll need to verify your address before submitting a loan application.</span></div><button class="button button-secondary" (click)="resendVerification()" [disabled]="resending">{{ resending ? 'Sending…' : 'Resend verification email' }}</button></div> }
    <section class="metric-grid"><article class="metric-card"><span>Applications</span><strong>{{ applications.length }}</strong><small>All application statuses</small></article><article class="metric-card"><span>Loan accounts</span><strong>{{ loans.length }}</strong><small>Approved and disbursed</small></article><article class="metric-card"><span>Account holder</span><strong class="metric-name">{{ api.user()?.fullName }}</strong><small>{{ api.user()?.email }}</small></article></section>
    <section class="panel"><div class="panel-heading"><div><h2>Your loan accounts</h2><p>Track your active and completed loans.</p></div></div>
      @if (loans.length) { <div class="table-wrap"><table><thead><tr><th>Loan</th><th>Principal</th><th>Term</th><th>Status</th><th></th></tr></thead><tbody>@for (loan of loans; track loan['id']) { <tr><td>Loan account #{{ loan['id'] }}</td><td>{{ formatMoney(loan['principal']) }}</td><td>{{ loan['tenure_months'] }} months</td><td><span class="pill">{{ loan['status'] }}</span></td><td><a [routerLink]="['/loans', loan['id']]" class="table-link">View →</a></td></tr> }</tbody></table></div> } @else { <div class="empty-state"><span>◌</span><h3>No loan accounts yet</h3><p>Once an application is approved, your loan details will appear here.</p><a routerLink="/apply" class="button button-primary">Explore an application</a></div> }
    </section>
    @if (kycCases.length) { <section class="panel"><div class="panel-heading"><div><h2>KYC checks</h2><p>Identity-document review status before a loan request can be submitted.</p></div></div><div class="table-wrap"><table><thead><tr><th>KYC case</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>@for (kyc of kycCases; track kyc['id']) { <tr><td>KYC #{{ kyc['id'] }}</td><td>{{ date(kyc['submitted_at'] || kyc['created_at']) }}</td><td><span class="pill">{{ kyc['status'] }}</span></td><td>@if (kyc['status'] === 'approved') { <a routerLink="/apply" class="table-link">Complete loan request →</a> } @else if (kyc['status'] === 'draft' || kyc['status'] === 'rejected') { <a routerLink="/apply" class="table-link">Continue KYC →</a> } @else { <span>Awaiting review</span> }</td></tr> }</tbody></table></div></section> }
    <section class="panel"><div class="panel-heading"><div><h2>Recent applications</h2><p>Updates from your loan applications.</p></div></div>@if (applications.length) { <div class="table-wrap"><table><thead><tr><th>Application</th><th>Product</th><th>Amount</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>@for (application of applications; track application['id']) { <tr><td>#{{ application['id'] }}</td><td>{{ application['product_name'] || 'Loan product' }}</td><td>{{ formatMoney(application['amount_requested']) }}</td><td>{{ date(application['created_at']) }}</td><td><span class="pill">{{ application['status'] }}</span></td><td><a [routerLink]="['/my-applications', application['id']]" class="table-link">Details →</a></td></tr> }</tbody></table></div> } @else { <div class="empty-state compact"><p>No applications to show.</p></div> }</section>
    @if (loading) { <p class="loading-note">Loading your latest information…</p> }
  `,
  imports: [RouterLink],
})
export class DashboardPage implements OnInit {
  readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly formatMoney = money;
  applications: Row[] = [];
  loans: Row[] = [];
  kycCases: Row[] = [];
  error = '';
  statusMessage = '';
  resending = false;
  loading = true;
  get greeting(): string {
    const name = this.api.user()?.fullName?.split(' ')[0];
    return `Good to see you${name ? `, ${name}` : ''}.`;
  }
  async ngOnInit(): Promise<void> {
    try {
      [this.applications, this.loans, this.kycCases] = await Promise.all([
        this.api.myApplications(),
        this.api.myLoans(),
        this.api.myKycCases(),
      ]);
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
  async resendVerification(): Promise<void> {
    this.resending = true;
    this.error = '';
    try {
      await this.api.resendVerification();
      this.statusMessage = 'Verification email sent. Check your inbox.';
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.resending = false;
      this.changeDetector.detectChanges();
    }
  }
  date(value: unknown): string {
    return value ? new Date(String(value)).toLocaleDateString() : '—';
  }
}

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="page-heading">
      <div><div class="eyebrow">YOUR ACCOUNT</div><h1>Application #{{ id }}</h1><p>Details and current status of your loan request.</p></div>
      <a routerLink="/dashboard" class="back-link">← Dashboard</a>
    </div>
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    @if (application) {
      <section class="panel">
        <h2>Loan request</h2>
        <div class="detail-row"><span>Product</span><b>{{ application['product_name'] }}</b></div>
        <div class="detail-row"><span>Amount requested</span><b>{{ formatMoney(application['amount_requested']) }}</b></div>
        <div class="detail-row"><span>Repayment term</span><b>{{ application['tenure_months'] }} months</b></div>
        <div class="detail-row"><span>Purpose</span><b>{{ application['purpose'] }}</b></div>
        <div class="detail-row"><span>Submitted</span><b>{{ date(application['created_at']) }}</b></div>
        <div class="detail-row"><span>Status</span><b><span class="pill">{{ application['status'] }}</span></b></div>
        @if (application['decline_reason_code']) { <div class="detail-row"><span>Decision reason</span><b>{{ application['decline_reason_code'] }}</b></div> }
        @if (application['loan_account_id']) { <a class="button button-primary" [routerLink]="['/loans', application['loan_account_id']]">View loan account →</a> }
        @else if (application['status'] === 'submitted' || application['status'] === 'under_review') { <p class="small-note">Your request is being reviewed. We’ll notify you when its status changes.</p> }
      </section>
    }
    @if (loading) { <p class="loading-note">Loading application details…</p> }
  `,
})
export class CustomerApplicationDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly formatMoney = money;
  application: Row | null = null;
  error = '';
  loading = true;
  id = 0;

  async ngOnInit(): Promise<void> {
    this.id = Number(this.route.snapshot.paramMap.get('id'));
    try {
      if (!Number.isSafeInteger(this.id) || this.id < 1) throw new Error('This application link is invalid.');
      this.application = await this.api.myApplication(this.id);
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }

  date(value: unknown): string {
    return value ? new Date(String(value)).toLocaleDateString() : '—';
  }
}

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <div id="admin-overview" class="page-heading"><div><div class="eyebrow">SYSTEM ADMINISTRATION</div><h1>Administrator dashboard</h1><p>Manage user access and monitor lending operations.</p></div></div>
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    @if (summary) { <section class="metric-grid"><article class="metric-card"><span>Pending applications</span><strong>{{ summary['pendingApplications'] }}</strong><small>For the lending team</small></article><article class="metric-card"><span>Active loans</span><strong>{{ summary['activeLoans'] }}</strong><small>Currently being serviced</small></article><article class="metric-card"><span>Delinquent loans</span><strong>{{ summary['delinquentLoans'] }}</strong><small>Require collection follow-up</small></article><article class="metric-card"><span>Total disbursed</span><strong>{{ formatMoney(summary['totalDisbursed']) }}</strong><small>Across all loans</small></article></section> }
    <section class="panel"><div class="panel-heading"><div><h2>Administrator workspace</h2><p>Choose an administration area from the sidebar.</p></div></div><div class="dashboard-actions"><a routerLink="/admin/staff" class="button button-secondary">Manage users</a><a routerLink="/admin/products" class="button button-secondary">Review loan products</a><a routerLink="/admin/settings" class="button button-secondary">System settings</a><a routerLink="/admin/audit-trail" class="button button-secondary">Activity log</a></div><p class="small-note">Loan application reviews, document checks, collections and complaints are handled from the loan officer workspace.</p></section>
    @if (loading) { <p class="loading-note">Loading system overview…</p> }
  `,
})
export class AdminDashboardPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly formatMoney = money;
  summary: Record<string, number> | null = null;
  error = '';
  loading = true;

  async ngOnInit(): Promise<void> {
    try {
      this.summary = await this.api.staffSummary();
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-heading"><div><div class="eyebrow">SYSTEM ADMINISTRATION</div><h1>Manage users</h1><p>Create staff accounts and manage officer, administrator, and customer access.</p></div><a routerLink="/admin/dashboard" class="back-link">← Admin overview</a></div>
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    @if (success) { <div class="notice notice-success" role="status">{{ success }}</div> }
    <section class="panel"><div class="panel-heading"><div><h2>Create a staff account</h2><p>Employees cannot self-register.</p></div></div>
      <form class="form-panel" (ngSubmit)="createUser()"><label>Full name<input name="fullName" [(ngModel)]="fullName" required minlength="2" autocomplete="name"></label><label>Email address<input name="email" type="email" [(ngModel)]="email" required autocomplete="email"></label><label>Temporary password<input name="password" type="password" [(ngModel)]="password" required minlength="8" autocomplete="new-password"></label><label>Staff role<select name="role" [(ngModel)]="staffRole"><option value="loan_officer">Loan officer</option><option value="admin">System administrator</option></select></label><button class="button button-primary" [disabled]="busy">{{ busy ? 'Creating account…' : 'Create staff account' }}</button></form>
    </section>
    <section class="panel">
      <div class="panel-heading">
        <div><h2>System users</h2><p>View and manage employee and customer accounts.</p></div>
        <label class="user-filter">Show<select name="userFilter" [(ngModel)]="userFilter"><option value="all">Everyone</option><option value="loan_officer">Loan officers</option><option value="admin">Administrators</option><option value="customer">Customers</option></select></label>
      </div>
      @if (editingUser) {
        <form class="form-panel user-edit-form" (ngSubmit)="saveUser()">
          <h3>Edit {{ editingUser.role === 'customer' ? 'customer' : 'staff' }} account</h3>
          <label>Full name<input name="editFullName" [(ngModel)]="editFullName" required minlength="2"></label>
          <label>Email address<input name="editEmail" type="email" [(ngModel)]="editEmail" required></label>
          <label>Phone number<input name="editPhone" type="tel" [(ngModel)]="editPhone"></label>
          <label>System role<select name="editRole" [(ngModel)]="editRole" [disabled]="editingUser.id === currentUserId"><option value="customer">Customer</option><option value="loan_officer">Loan officer</option><option value="admin">System administrator</option></select></label>
          @if (editingUser.id === currentUserId) { <p class="small-note">You cannot change your own administrator role.</p> }
          <div class="user-edit-actions"><button class="button button-primary" type="submit" [disabled]="busy">Save changes</button><button class="button button-secondary" type="button" (click)="cancelEdit()">Cancel</button></div>
        </form>
      }
      @if (usersLoading) { <p class="loading-note">Loading users…</p> }
      @else if (filteredUsers.length) {
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Email verified</th><th>Actions</th></tr></thead><tbody>
          @for (user of filteredUsers; track user.id) {
            <tr>
              <td>{{ user.fullName }}</td><td>{{ user.email }}</td><td>{{ user.phone || '—' }}</td><td>{{ roleName(user.role) }}</td>
              <td><span class="pill" [class.pill-danger]="!user.isActive">{{ user.isActive ? 'Active' : 'Deactivated' }}</span></td>
              <td>{{ user.emailVerified ? 'Yes' : 'No' }}</td>
              <td><div class="user-row-actions"><button class="button button-secondary" type="button" (click)="startEdit(user)">Edit</button><button class="button" [class.button-danger]="user.isActive" [class.button-secondary]="!user.isActive" type="button" [disabled]="busyUserId === user.id || user.id === currentUserId" (click)="toggleUserStatus(user)">{{ busyUserId === user.id ? 'Saving…' : user.isActive ? 'Deactivate' : 'Activate' }}</button></div></td>
            </tr>
          }
        </tbody></table></div>
      } @else { <div class="empty-state compact"><p>No users match this filter.</p></div> }
    </section>
  `,
})
export class AdminStaffPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly currentUserId = this.api.user()?.id;
  users: ManagedUser[] = [];
  usersLoading = true;
  userFilter: 'all' | ManagedUser['role'] = 'all';
  editingUser: ManagedUser | null = null;
  editFullName = '';
  editEmail = '';
  editPhone = '';
  editRole: ManagedUser['role'] = 'loan_officer';
  fullName = '';
  email = '';
  password = '';
  staffRole: 'loan_officer' | 'admin' = 'loan_officer';
  error = '';
  success = '';
  busy = false;
  busyUserId: number | null = null;

  get filteredUsers(): ManagedUser[] {
    return this.userFilter === 'all'
      ? this.users
      : this.users.filter((user) => user.role === this.userFilter);
  }

  ngOnInit(): void {
    void this.loadUsers();
  }

  roleName(role: ManagedUser['role']): string {
    return role === 'admin' ? 'System administrator' : role === 'loan_officer' ? 'Loan officer' : 'Customer';
  }

  async loadUsers(): Promise<void> {
    this.usersLoading = true;
    try {
      this.users = await this.api.managedUsers();
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.usersLoading = false;
      this.changeDetector.detectChanges();
    }
  }

  async createUser(): Promise<void> {
    this.error = '';
    this.success = '';
    this.busy = true;
    try {
      await this.api.createStaffUser({
        fullName: this.fullName.trim(),
        email: this.email.trim(),
        password: this.password,
        role: this.staffRole,
      });
      this.success = `Staff account created for ${this.email.trim()}.`;
      this.fullName = '';
      this.email = '';
      this.password = '';
      this.staffRole = 'loan_officer';
      await this.loadUsers();
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }

  startEdit(user: ManagedUser): void {
    this.editingUser = user;
    this.editFullName = user.fullName;
    this.editEmail = user.email;
    this.editPhone = user.phone ?? '';
    this.editRole = user.role;
    this.error = '';
    this.success = '';
  }

  cancelEdit(): void {
    this.editingUser = null;
  }

  async saveUser(): Promise<void> {
    if (!this.editingUser) return;
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      const updated = await this.api.updateManagedUser(this.editingUser.id, {
        fullName: this.editFullName.trim(),
        email: this.editEmail.trim(),
        phone: this.editPhone.trim() || null,
        role: this.editRole,
      });
      this.users = this.users.map((user) => user.id === updated.id ? updated : user);
      this.success = `Updated ${updated.fullName}'s account.`;
      this.editingUser = null;
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }

  async toggleUserStatus(user: ManagedUser): Promise<void> {
    this.busyUserId = user.id;
    this.error = '';
    this.success = '';
    try {
      const updated = await this.api.setManagedUserStatus(user.id, !user.isActive);
      this.users = this.users.map((account) => account.id === updated.id ? updated : account);
      this.success = `${updated.fullName}'s account is now ${updated.isActive ? 'active' : 'deactivated'}.`;
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.busyUserId = null;
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="page-heading"><div><div class="eyebrow">SYSTEM ADMINISTRATION</div><h1>Loan products</h1><p>Review configured lending products and their terms.</p></div><a routerLink="/admin/dashboard" class="back-link">← Admin overview</a></div>
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    <section class="panel">@if (products.length) { <div class="table-wrap"><table><thead><tr><th>Product</th><th>Monthly rate</th><th>Amount range</th><th>Term range</th></tr></thead><tbody>@for (product of products; track product.id) { <tr><td>{{ product.name }}</td><td>{{ product.monthly_rate_pct }}%</td><td>{{ formatMoney(product.min_amount) }} – {{ formatMoney(product.max_amount) }}</td><td>{{ product.min_tenure_months }}–{{ product.max_tenure_months }} months</td></tr> }</tbody></table></div> } @else if (!loading && !error) { <div class="empty-state compact"><p>No loan products are configured.</p></div> } @if (loading) { <p class="loading-note">Loading loan products…</p> }</section>
    <div class="notice notice-warning">Products are view-only here. Editing product limits, terms or interest rates is not yet implemented.</div>
  `,
})
export class AdminProductsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly formatMoney = money;
  products: LoanProduct[] = [];
  error = '';
  loading = true;

  async ngOnInit(): Promise<void> {
    try {
      this.products = await this.api.products();
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  imports: [RouterLink, FormsModule],
  template: `
    <div class="page-heading"><div><div class="eyebrow">ACCOUNT PREFERENCES</div><h1>Personal settings</h1><p>Manage your contact details, notification preferences, and workspace display.</p></div><a [routerLink]="dashboardLink" class="back-link">← Dashboard</a></div>
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    @if (success) { <div class="notice notice-success" role="status">{{ success }}</div> }
    @if (loading) { <p class="loading-note">Loading your settings…</p> }
    @if (settings) {
      <form class="panel form-panel settings-form" (ngSubmit)="save()">
        <section class="settings-section"><h2>Profile and contact</h2>
          <label>Full name<input name="fullName" [(ngModel)]="settings.fullName" required minlength="2" autocomplete="name"></label>
          <label>Email address<input name="email" type="email" [(ngModel)]="settings.email" required autocomplete="email"></label>
          @if (!settings.emailVerified) { <div class="notice notice-warning">Verify your email address to keep account and application updates available. <button class="text-button" type="button" [disabled]="verificationBusy" (click)="resendVerification()">{{ verificationBusy ? 'Sending…' : 'Resend verification email' }}</button></div> }
          <label>Phone number <span class="optional">(optional)</span><input name="phone" type="tel" [(ngModel)]="settings.phone" autocomplete="tel" placeholder="+267 7X XXX XXX"></label>
          <p class="small-note">Loan approvals, repayment reminders, overdue notices, and loan closure updates are delivered by email and shown in your in-app notifications.</p>
        </section>
        <section class="settings-section"><h2>Notifications</h2><p class="small-note">Choose which updates you want to receive. Loan approval, repayment reminder, overdue, and fully repaid messages are sent automatically when enabled.</p>
          @if (!isOfficer) {
            <label class="settings-toggle"><input type="checkbox" name="notifyRepaymentReminders" [(ngModel)]="settings.notifyRepaymentReminders">Repayment reminders</label>
            <label class="settings-toggle"><input type="checkbox" name="notifyApplicationUpdates" [(ngModel)]="settings.notifyApplicationUpdates">Application updates</label>
            <label class="settings-toggle"><input type="checkbox" name="notifyStatements" [(ngModel)]="settings.notifyStatements">Loan statements</label>
          } @else {
            <label class="settings-toggle"><input type="checkbox" name="notifyNewApplications" [(ngModel)]="settings.notifyNewApplications">New applications</label>
            <label class="settings-toggle"><input type="checkbox" name="notifyOverduePayments" [(ngModel)]="settings.notifyOverduePayments">Overdue payments</label>
            <label class="settings-toggle"><input type="checkbox" name="notifyAssignedComplaints" [(ngModel)]="settings.notifyAssignedComplaints">Assigned complaints</label>
            <label class="settings-toggle"><input type="checkbox" name="notifyKycReviews" [(ngModel)]="settings.notifyKycReviews">KYC documents needing review</label>
          }
        </section>
        <section class="settings-section"><h2>Accessibility and display</h2>
          <label>Language preference<select name="language" [(ngModel)]="settings.language"><option value="en">English</option><option value="tn">Setswana</option></select></label>
          <p class="small-note">Your language preference is saved; the interface is currently displayed in English.</p>
          <label>Text size<select name="textSize" [(ngModel)]="settings.textSize"><option value="small">Small</option><option value="normal">Default</option><option value="large">Large</option></select></label>
        </section>
        @if (isOfficer) {
          <section class="settings-section"><h2>Work preferences</h2>
            <label>Default application filter<select name="defaultApplicationFilter" [(ngModel)]="settings.defaultApplicationFilter"><option value="all">All applications</option><option value="submitted">Submitted</option><option value="under_review">Under review</option></select></label>
            <label>Application sorting<select name="applicationSort" [(ngModel)]="settings.applicationSort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount_high">Amount: high to low</option><option value="amount_low">Amount: low to high</option></select></label>
            <label>Workspace density<select name="dashboardLayout" [(ngModel)]="settings.dashboardLayout"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
          </section>
        }
        <button class="button button-primary" type="submit" [disabled]="busy">{{ busy ? 'Saving…' : 'Save settings' }}</button>
      </form>
    }
  `,
})
export class PersonalSettingsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly document = inject(DOCUMENT);
  readonly isOfficer = this.api.user()?.role === 'loan_officer';
  settings: UserSettings | null = null;
  loading = true;
  busy = false;
  verificationBusy = false;
  error = '';
  success = '';

  get dashboardLink(): string {
    return this.isOfficer ? '/officer/dashboard' : '/dashboard';
  }

  async ngOnInit(): Promise<void> {
    try {
      this.settings = await this.api.mySettings();
      this.applyDisplaySettings();
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }

  async save(): Promise<void> {
    if (!this.settings) return;
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      this.settings = await this.api.updateMySettings(this.settings);
      this.api.setCurrentUserProfile(
        this.settings.fullName, this.settings.email, this.settings.emailVerified, this.settings.phone);
      this.applyDisplaySettings();
      this.success = this.settings.emailVerified
        ? 'Your settings have been saved.'
        : 'Your settings have been saved. Please verify your updated email address.';
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }

  async resendVerification(): Promise<void> {
    this.verificationBusy = true;
    this.error = '';
    this.success = '';
    try {
      const result = await this.api.resendVerification();
      this.success = result.message;
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.verificationBusy = false;
      this.changeDetector.detectChanges();
    }
  }

  private applyDisplaySettings(): void {
    if (!this.settings) return;
    const root = this.document.documentElement;
    root.dataset['textSize'] = this.settings.textSize;
    root.lang = this.settings.language === 'tn' ? 'tn-BW' : 'en-BW';
    root.dataset['dashboardLayout'] = this.settings.dashboardLayout;
  }
}

@Component({
  standalone: true,
  imports: [RouterLink, FormsModule],
  template: `
    <div class="page-heading"><div><div class="eyebrow">SYSTEM ADMINISTRATION</div><h1>System settings</h1><p>Manage system notification templates and the events that can send them.</p></div><a routerLink="/admin/dashboard" class="back-link">← Admin overview</a></div>
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    @if (success) { <div class="notice notice-success" role="status">{{ success }}</div> }
    <div class="notice notice-warning settings-warning">Email and in-app notifications are connected for loan approvals, repayment reminders, overdue notices, and loan closure. Email delivery requires configured SMTP. SMS delivery is disabled.</div>
    @if (loading) { <p class="loading-note">Loading notification settings…</p> }
    @for (template of templates; track template.eventType) {
      <section class="panel notification-template">
        <div class="panel-heading"><div><h2>{{ template.displayName }}</h2><p>Event: {{ template.eventType }}</p></div><button class="button button-primary" type="button" [disabled]="busyEvent === template.eventType" (click)="saveTemplate(template)">{{ busyEvent === template.eventType ? 'Saving…' : 'Save event' }}</button></div>
        <div class="settings-checks"><label class="settings-toggle"><input type="checkbox" [name]="template.eventType + 'EmailEnabled'" [(ngModel)]="template.emailEnabled">Enable email for this event</label></div>
        <label>Email subject<input [name]="template.eventType + 'EmailSubject'" [(ngModel)]="template.emailSubject" maxlength="255"></label>
        <label>Email message<textarea [name]="template.eventType + 'EmailBody'" [(ngModel)]="template.emailBody" maxlength="5000" rows="3"></textarea></label>
        <p class="small-note">Available placeholders: &#123;fullName&#125;, &#123;applicationId&#125;, &#123;amount&#125;, &#123;dueDate&#125;, &#123;loanId&#125;, and &#123;complaintId&#125;.</p>
      </section>
    }
    @if (!loading && !templates.length) { <section class="panel"><p>No notification events are configured. Run the database migration and reload this page.</p></section> }
  `,
})
export class AdminSettingsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  templates: NotificationTemplate[] = [];
  loading = true;
  busyEvent = '';
  error = '';
  success = '';

  async ngOnInit(): Promise<void> {
    try {
      this.templates = await this.api.notificationSettings();
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }

  async saveTemplate(template: NotificationTemplate): Promise<void> {
    this.busyEvent = template.eventType;
    this.error = '';
    this.success = '';
    try {
      const updated = await this.api.updateNotificationSetting(template.eventType, template);
      this.templates = this.templates.map((item) => item.eventType === updated.eventType ? updated : item);
      this.success = `Saved ${updated.displayName} notification settings.`;
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.busyEvent = '';
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="page-heading"><div><div class="eyebrow">SYSTEM ADMINISTRATION</div><h1>Activity log</h1><p>Review important user and system actions. Successful changes are recorded as they happen.</p></div><a routerLink="/admin/dashboard" class="back-link">← Admin overview</a></div>
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    <section class="panel">
      <div class="panel-heading"><div><h2>Recorded activity</h2><p>{{ total }} event{{ total === 1 ? '' : 's' }} · newest first · retained indefinitely</p></div>
        <div class="activity-actions"><button type="button" class="button button-secondary" [disabled]="loading || exporting" (click)="loadPage()">Refresh</button><button type="button" class="button button-primary" [disabled]="exporting" (click)="downloadCsv()">{{ exporting ? 'Preparing CSV…' : 'Download CSV for Excel' }}</button></div>
      </div>
      @if (loading) { <p class="loading-note">Loading activity…</p> }
      @else if (entries.length) {
        <div class="table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Area</th><th>IP address</th><th>Details</th></tr></thead><tbody>
          @for (entry of entries; track entry.id) {
            <tr><td>{{ date(entry.createdAt) }}</td><td>{{ entry.actorName || entry.actorEmail || 'Unknown user' }}@if (entry.actorName) { <div class="table-sub">{{ entry.actorEmail }}</div> }</td>
              <td>{{ actionName(entry.action) }}</td><td>{{ entry.entityType }}@if (entry.entityId) { #{{ entry.entityId }} }</td><td>{{ entry.ipAddress || '—' }}</td>
              <td>@if (entry.beforeValue || entry.afterValue) { <details><summary>View data</summary><div class="audit-values"><div><b>Before</b><pre>{{ formatValue(entry.beforeValue) }}</pre></div><div><b>After</b><pre>{{ formatValue(entry.afterValue) }}</pre></div></div></details> } @else { — }</td>
            </tr>
          }
        </tbody></table></div>
        <div class="activity-pagination"><span>Showing {{ offset + 1 }}–{{ offset + entries.length }} of {{ total }}</span><div><button type="button" class="button button-secondary" [disabled]="loading || offset === 0" (click)="loadPage(offset - pageSize)">Previous</button><button type="button" class="button button-secondary" [disabled]="loading || offset + entries.length >= total" (click)="loadPage(offset + pageSize)">Next</button></div></div>
      } @else { <div class="empty-state compact"><p>No activity has been recorded yet.</p></div> }
    </section>
  `,
})
export class AdminAuditPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly document = inject(DOCUMENT);
  readonly pageSize = 100;
  entries: SettingsAuditEntry[] = [];
  offset = 0;
  total = 0;
  loading = true;
  exporting = false;
  error = '';

  async ngOnInit(): Promise<void> {
    await this.loadPage();
  }

  async loadPage(offset = this.offset): Promise<void> {
    this.offset = Math.max(0, offset);
    this.loading = true;
    this.error = '';
    try {
      const result: ActivityHistory = await this.api.activityHistory(this.offset, this.pageSize);
      this.entries = result.entries;
      this.total = result.total;
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }

  async downloadCsv(): Promise<void> {
    this.exporting = true;
    this.error = '';
    try {
      const blob = await this.api.downloadActivityHistoryCsv();
      const url = URL.createObjectURL(blob);
      const link = this.document.createElement('a');
      link.href = url;
      link.download = 'activity-log.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.exporting = false;
      this.changeDetector.detectChanges();
    }
  }

  formatValue(value: string | null): string {
    if (!value) return '—';
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  actionName(action: string): string {
    if (action === 'updated_notification_settings') return 'Updated notification settings';
    if (action === 'signed_in') return 'Signed in';
    if (action === 'account_registered') return 'Registered';
    return action;
  }

  date(value: string): string {
    return new Date(value).toLocaleString();
  }
}

@Component({
  standalone: true,
  template: `
    <div class="page-heading"><div><div class="eyebrow">LENDING OPERATIONS</div><h1>Loan officer dashboard</h1><p>Review borrower applications and follow up on the loan portfolio.</p></div></div>
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    @if (summary) { <section class="metric-grid"><article class="metric-card"><span>Pending applications</span><strong>{{ summary['pendingApplications'] }}</strong><small>Awaiting human review</small></article><article class="metric-card"><span>Active loans</span><strong>{{ summary['activeLoans'] }}</strong><small>Currently being serviced</small></article><article class="metric-card"><span>Outstanding portfolio</span><strong>{{ formatMoney(summary['outstandingPortfolio']) }}</strong><small>Active and delinquent accounts</small></article><article class="metric-card"><span>Total collected</span><strong>{{ formatMoney(summary['totalCollected']) }}</strong><small>Recorded repayments</small></article></section> }
    <section class="panel"><div class="panel-heading"><div><h2>Applications to review</h2><p>Recent customer applications awaiting a decision.</p></div><a routerLink="/applications" class="table-link">View all →</a></div>@if (applications.length) { <div class="table-wrap"><table><thead><tr><th>Applicant</th><th>Product</th><th>Amount</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>@for (application of applications.slice(0, 6); track application['id']) { <tr><td>{{ application['applicant_name'] }}</td><td>{{ application['product_name'] }}</td><td>{{ formatMoney(application['amount_requested']) }}</td><td>{{ date(application['created_at']) }}</td><td><span class="pill">{{ application['status'] }}</span></td><td><a [routerLink]="['/applications', application['id']]" class="table-link">Review →</a></td></tr> }</tbody></table></div> } @else if (!loading) { <div class="empty-state compact"><p>No applications are waiting for review.</p></div> }</section>
    <section class="panel"><div class="panel-heading"><div><h2>Officer workspace</h2><p>Open the operational pages you need.</p></div></div><div class="dashboard-actions">    <a routerLink="/officer/kyc" class="button button-secondary">KYC review</a><a routerLink="/applications" class="button button-secondary">Loan applications</a><a routerLink="/officer/repayments" class="button button-secondary">Record a repayment</a><a routerLink="/portfolio-at-risk" class="button button-secondary">Portfolio at risk</a><a routerLink="/officer/reports" class="button button-secondary">Aging &amp; collections</a><a routerLink="/complaints" class="button button-secondary">Complaints</a></div></section>
    @if (loading) { <p class="loading-note">Loading lending operations…</p> }
  `,
  imports: [RouterLink],
})
export class OfficerDashboardPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly formatMoney = money;
  applications: Row[] = [];
  summary: Record<string, number> | null = null;
  error = '';
  loading = true;

  async ngOnInit(): Promise<void> {
    try {
      [this.summary, this.applications] = await Promise.all([this.api.staffSummary(), this.api.staffApplications()]);
    } catch (error) {
      this.error = ApiService.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }

  date(value: unknown): string {
    return value ? new Date(String(value)).toLocaleDateString() : '—';
  }
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-heading"><div><div class="eyebrow">LOAN ORIGINATION</div><h1>Apply for a loan</h1><p>Complete identity verification first, then submit your loan request after KYC approval.</p></div><a routerLink="/dashboard" class="back-link">← Dashboard</a></div>
    @if (error) { <div class="notice notice-error">{{ error }}</div> } @if (success) { <div class="notice notice-success">{{ success }}</div> }
    @if (loading) { <p class="loading-note">Loading your KYC application…</p> }
    @if (!loading && kycCase && kycCase['status'] !== 'approved') {
      <section class="panel form-panel"><h2>Step 1 · KYC identity check</h2><p>Upload clear PDF, JPG or PNG copies (up to 8 MB each). Officers will review these before you can fill out the loan application.</p>
        @if (kycCase['status'] === 'submitted' || kycCase['status'] === 'under_review') {
          <div class="notice notice-warning">KYC status: <b>{{ kycCase['status'] === 'submitted' ? 'Waiting for review' : 'Under review' }}</b>. We’ll enable the loan form after approval.</div>
        } @else {
          @if (kycCase['status'] === 'rejected') { <div class="notice notice-warning">KYC needs corrections: {{ kycCase['rejection_reason'] }}. Upload replacement documents and submit again.</div> }
          <section class="required-documents"><h3>Required documents</h3><p>Your bank statement must cover the last 3 months. Upload a certified National ID, proof of residence, and payslip.</p>
            @for (type of requiredTypes; track type.value) { <div class="required-document-row"><div><b>{{ type.label }}</b><small>{{ latestDocument(type.value)?.['original_name'] || 'Not uploaded' }}@if (latestDocument(type.value)) { · {{ latestDocument(type.value)?.['status'] }} }@if (latestDocument(type.value)?.['rejection_reason']) { · {{ latestDocument(type.value)?.['rejection_reason'] }} }</small></div><input #requiredFile type="file" accept=".pdf,.jpg,.jpeg,.png" hidden (change)="uploadRequiredDocument(type.value, requiredFile.files?.[0] || null); requiredFile.value = ''"><button class="button button-secondary" type="button" [disabled]="busy" (click)="requiredFile.click()">{{ latestDocument(type.value) ? 'Replace file' : 'Upload' }}</button></div> }
          </section>
          @if (!documentsComplete) { <p class="small-note">Upload all required documents to submit KYC for review.</p> }
          <button class="button button-primary" [disabled]="busy || !documentsComplete" (click)="submitKyc()">{{ busy ? 'Please wait…' : 'Submit KYC for review →' }}</button>
        }
      </section>
    }
    @if (!loading && kycCase?.['status'] === 'approved') {
      <div class="notice notice-success">KYC approved. Complete the loan request below.</div>
      <div class="form-layout"><form class="panel form-panel" (ngSubmit)="submit()"><h2>Step 2 · Loan details</h2><label>Loan product<select name="product" [(ngModel)]="productId" (ngModelChange)="updateProduct()"><option [ngValue]="0" disabled>Select an available product</option>@for (product of products; track product.id) { <option [ngValue]="product.id">{{ product.name }} · {{ product.monthly_rate_pct }}% MPR</option> }</select></label><label>Amount requested (Pula)<input name="amount" type="number" [(ngModel)]="amount" required [min]="selected?.min_amount || 1" [max]="selected?.max_amount || 1000000"></label><label>Repayment term<select name="tenure" [(ngModel)]="tenure">@for (month of terms; track month) { <option [ngValue]="month">{{ month }} months</option> }</select></label><label>Purpose<textarea name="purpose" [(ngModel)]="purpose" required minlength="3" maxlength="255" rows="4" placeholder="Briefly explain what the loan will be used for"></textarea></label><button class="button button-primary" [disabled]="busy || !products.length">{{ busy ? 'Submitting…' : 'Submit loan application →' }}</button></form>
      <aside class="panel estimate-panel"><div class="eyebrow">REPAYMENT ESTIMATE</div><h2>Plan ahead.</h2>@if (selected) { <p>Illustrative estimate using {{ selected.monthly_rate_pct }}% monthly rate. Your confirmed schedule is provided after review.</p><div class="estimate-number">{{ formatMoney(monthlyPayment) }}<small>/ month</small></div><div class="product-meta"><span>Product</span><b>{{ selected.name }}</b></div><div class="product-meta"><span>Estimated total</span><b>{{ formatMoney(monthlyPayment * tenure) }}</b></div><p class="small-note">Estimate only; fees or other terms may affect your final agreement.</p> } @else { <p>Start the backend to load current products and calculate an estimate.</p> }</aside></div>
    }
  `,
})
export class ApplyPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly formatMoney = money;
  products: LoanProduct[] = [];
  kycCase: Row | null = null;
  readonly requiredDocumentTypes = [
    { value: 'bank_statement', label: 'Bank statements (last 3 months)' },
    { value: 'national_id', label: 'Certified National ID or passport' },
    { value: 'payslip', label: 'Latest payslip or proof of income' },
    { value: 'proof_of_address', label: 'Proof of residence' },
  ];
  productId = 0;
  amount = 2000;
  tenure = 3;
  purpose = '';
  error = '';
  success = '';
  busy = false;
  loading = true;
  get documents(): Row[] {
    return Array.isArray(this.kycCase?.['documents']) ? this.kycCase['documents'] as Row[] : [];
  }
  get requiredTypes(): { value: string; label: string }[] {
    return this.kycCase?.['spousal_consent_required'] === true
      ? [...this.requiredDocumentTypes, { value: 'spousal_consent', label: 'Spousal consent form' }]
      : this.requiredDocumentTypes;
  }
  get documentsComplete(): boolean {
    return this.requiredTypes.every((type) => {
      const latest = this.latestDocument(type.value);
      return !!latest && latest['status'] !== 'rejected';
    });
  }
  latestDocument(type: string): Row | undefined {
    return this.documents
      .filter((document) => document['doc_type'] === type)
      .sort((left, right) => new Date(String(right['uploaded_at'])).getTime()
        - new Date(String(left['uploaded_at'])).getTime())[0];
  }
  get selected(): LoanProduct | undefined { return this.products.find((product) => product.id === this.productId); }
  get terms(): number[] {
    if (!this.selected) return [1, 2, 3, 4, 5, 6];
    return Array.from({ length: this.selected.max_tenure_months - this.selected.min_tenure_months + 1 }, (_, i) => this.selected!.min_tenure_months + i);
  }
  get monthlyPayment(): number {
    return this.selected ? estimate(this.amount, Number(this.selected.monthly_rate_pct), this.tenure) : 0;
  }
  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      void this.loadKycCase(params.get('case'));
    });
  }
  private async loadKycCase(requestedCase: string | null): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      if (requestedCase === null) {
        this.kycCase = await this.api.startKycCase();
      } else {
        const caseId = Number(requestedCase);
        if (!Number.isSafeInteger(caseId) || caseId < 1) throw new Error('This KYC link is invalid.');
        this.kycCase = await this.api.myKycCase(caseId);
      }
      if (this.kycCase['status'] === 'approved') await this.loadProducts();
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
  private async loadProducts(): Promise<void> {
    this.products = await this.api.products();
    if (this.products.length) {
      this.productId = this.products[0].id;
      this.amount = Number(this.products[0].min_amount);
      this.tenure = Number(this.products[0].min_tenure_months);
    }
  }
  updateProduct(): void {
    if (this.selected) {
      this.amount = Math.max(Number(this.selected.min_amount), Math.min(this.amount, Number(this.selected.max_amount)));
      this.tenure = Number(this.selected.min_tenure_months);
    }
  }
  async uploadRequiredDocument(type: string, file: File | null): Promise<void> {
    if (!file) return;
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      await this.api.uploadKycDocument(file, type, Number(this.kycCase?.['id']));
      this.kycCase = await this.api.startKycCase();
      this.success = 'Document uploaded. You can replace it before submitting if needed.';
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }
  async submitKyc(): Promise<void> {
    if (!this.kycCase || !this.documentsComplete) return;
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      this.kycCase = await this.api.submitKycCase(Number(this.kycCase['id']));
      this.success = 'KYC documents submitted for review. The loan form will unlock after approval.';
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }
  async submit(): Promise<void> {
    if (!this.selected || !this.purpose.trim() || !this.kycCase || this.kycCase['status'] !== 'approved') return;
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      const result = await this.api.submitApplication({
        kycCaseId: Number(this.kycCase['id']),
        loanProductId: this.productId,
        amountRequested: Number(this.amount),
        purpose: this.purpose.trim(),
        tenureMonths: Number(this.tenure),
      });
      this.success = `Application #${result['id']} submitted.`;
      this.purpose = '';
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  template: `
    <div class="page-heading"><div><div class="eyebrow">CUSTOMER VERIFICATION</div><h1>Your documents</h1><p>Upload clear PDF, JPG or PNG copies. Files are limited to 8 MB each.</p></div></div>
    @if (error) { <div class="notice notice-error">{{ error }}</div> } @if (success) { <div class="notice notice-success">{{ success }}</div> }
    <div class="document-grid">@for (type of documentTypes; track type.value) { <article class="panel document-card"><div class="doc-symbol">▤</div><h2>{{ type.label }}</h2><p>{{ type.hint }}</p><input #fileInput type="file" accept=".pdf,.jpg,.jpeg,.png" hidden (change)="upload(type.value, fileInput.files?.[0] || null)"><button class="button button-secondary" [disabled]="busy" (click)="fileInput.click()">↑ &nbsp; Upload {{ type.label }}</button>@for (doc of docsFor(type.value); track doc['id']) { <div class="document-row"><span class="pill">{{ doc['status'] }}</span><span>{{ doc['original_name'] }}</span><button type="button" class="table-link" (click)="openDocument(doc, false)">View</button><button type="button" class="table-link" (click)="openDocument(doc, true)">Download</button></div> }</article> }</div>
    <p class="small-note">A staff member verifies uploaded documents. Please don’t submit original physical documents.</p>
  `,
})
export class DocumentsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly documentTypes = [
    { value: 'national_id', label: 'National ID', hint: 'A clear scan or photo of your Omang or passport.' },
    { value: 'payslip', label: 'Payslip', hint: 'Your most recent payslip for income verification.' },
    { value: 'proof_of_address', label: 'Proof of address', hint: 'A recent utility bill, lease, or other accepted proof.' },
    { value: 'bank_statement', label: 'Bank statements', hint: 'Statements covering the last 3 months.' },
    { value: 'spousal_consent', label: 'Spousal consent', hint: 'Required where you are married in community of property.' },
  ];
  documents: Row[] = [];
  busy = false;
  error = '';
  success = '';
  async ngOnInit(): Promise<void> { await this.refresh(); }
  docsFor(type: string): Row[] { return this.documents.filter((doc) => doc['doc_type'] === type); }
  private async refresh(): Promise<void> {
    try { this.documents = await this.api.documents(); }
    catch (error) { this.error = ApiService.errorMessage(error); }
    finally { this.changeDetector.detectChanges(); }
  }
  async upload(type: string, file: File | null): Promise<void> {
    if (!file) return;
    this.error = '';
    this.success = '';
    this.busy = true;
    try {
      await this.api.uploadDocument(file, type);
      this.success = 'Document uploaded successfully.';
      await this.refresh();
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }
  async openDocument(doc: Row, download: boolean): Promise<void> {
    this.error = '';
    try {
      const blob = await this.api.downloadDocument(Number(doc['id']));
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement('a');
        link.href = url;
        link.download = String(doc['original_name'] || 'document');
        link.click();
      } else {
        window.open(url, '_blank', 'noopener');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally { this.changeDetector.detectChanges(); }
  }
}

@Component({
  standalone: true,
  template: `
    <div class="page-heading"><div><div class="eyebrow">YOUR LOAN</div><h1>Loan account #{{ id }}</h1><p>Repayment schedule and account details.</p></div><a routerLink="/dashboard" class="back-link">← Dashboard</a></div>
    @if (error) { <div class="notice notice-error">{{ error }}</div> } @if (loan) { <section class="metric-grid"><article class="metric-card"><span>Principal</span><strong>{{ formatMoney(loan['principal']) }}</strong><small>Original amount</small></article><article class="metric-card"><span>Monthly rate</span><strong>{{ loan['monthly_rate_pct'] }}%</strong><small>Monthly percentage rate</small></article><article class="metric-card"><span>Term</span><strong>{{ loan['tenure_months'] }}</strong><small>Months</small></article><article class="metric-card"><span>Status</span><strong class="metric-name">{{ loan['status'] }}</strong><small>Account #{{ loan['id'] }}</small></article></section> }
    <section class="panel"><div class="panel-heading"><div><h2>Repayment schedule</h2><p>Installments and current status.</p></div></div>@if (schedule.length) { <div class="table-wrap"><table><thead><tr><th>Installment</th><th>Due date</th><th>Principal</th><th>Interest</th><th>Total due</th><th>Status</th></tr></thead><tbody>@for (item of schedule; track item['id']) { <tr><td>{{ item['installment_no'] }}</td><td>{{ date(item['due_date']) }}</td><td>{{ formatMoney(item['principal_due']) }}</td><td>{{ formatMoney(item['interest_due']) }}</td><td>{{ formatMoney(item['total_due']) }}</td><td><span class="pill">{{ item['status'] }}</span></td></tr> }</tbody></table></div> } @else if (!error) { <div class="empty-state compact"><p>Loading schedule…</p></div> }</section>
  `,
  imports: [RouterLink],
})
export class LoanDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  readonly formatMoney = money;
  id = '';
  loan: Row | null = null;
  schedule: Row[] = [];
  error = '';
  async ngOnInit(): Promise<void> {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    try { [this.loan, this.schedule] = await Promise.all([this.api.loan(this.id), this.api.schedule(this.id)]); }
    catch (error) { this.error = ApiService.errorMessage(error); }
    finally { this.changeDetector.detectChanges(); }
  }
  date(value: unknown): string { return value ? new Date(String(value)).toLocaleDateString() : '—'; }
}

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-heading"><div><div class="eyebrow">IDENTITY VERIFICATION</div><h1>KYC review</h1><p>Review identity documents separately before the customer can submit a loan application.</p></div></div>
    @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
    @if (success) { <div class="notice notice-success" role="status">{{ success }}</div> }
    @if (loading) { <p class="loading-note">Loading KYC cases…</p> }
    @if (!loading && cases.length === 0) { <section class="panel empty-state compact"><h2>No KYC cases awaiting review</h2><p>New KYC submissions will appear here. Approved KYC cases move to the loan applications queue.</p></section> }
    @for (kyc of cases; track kyc['id']) {
      <section class="panel kyc-review-card">
        <div class="panel-heading"><div><h2>{{ kyc['applicant_name'] }} · KYC #{{ kyc['id'] }}</h2><p>{{ kyc['applicant_email'] }} · Submitted {{ date(kyc['submitted_at']) }}</p></div><span class="pill">{{ kyc['status'] }}</span></div>
        @if (kyc['rejection_reason']) { <div class="notice notice-warning">Previous review: {{ kyc['rejection_reason'] }}</div> }
        <div class="table-wrap"><table><thead><tr><th>Document</th><th>File</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          @for (doc of documents(kyc); track doc['id']) {
            <tr><td>{{ documentTypeLabel(doc['doc_type']) }}</td><td>{{ doc['original_name'] }}</td><td><span class="pill">{{ doc['status'] }}</span>@if (doc['rejection_reason']) { <small class="kyc-rejection-note">{{ doc['rejection_reason'] }}</small> }</td><td><div class="document-actions"><button type="button" class="button button-secondary" [disabled]="busy" (click)="openDocument(doc, false)">View</button><button type="button" class="button button-secondary" [disabled]="busy" (click)="openDocument(doc, true)">Download</button>@if (doc['status'] === 'pending' && isReviewable(kyc)) { <button type="button" class="button button-secondary" [disabled]="busy" (click)="reviewDocument(doc, 'verified')">Verify</button><button type="button" class="button button-danger" [disabled]="busy" (click)="beginDocumentRejection(doc)">Reject</button> }</div>@if (rejectingDocumentId === documentId(doc)) { <label class="reject-note">Reason for rejection<textarea rows="2" [(ngModel)]="rejectionReason"></textarea></label><div class="document-actions"><button type="button" class="button button-danger" [disabled]="busy || !rejectionReason.trim()" (click)="reviewDocument(doc, 'rejected')">Confirm rejection</button><button type="button" class="button button-quiet" (click)="cancelDocumentRejection()">Cancel</button></div> }</td></tr>
          }
        </tbody></table></div>
        @if (isReviewable(kyc)) {
          <div class="kyc-decision-actions"><button type="button" class="button button-primary" [disabled]="busy || !allRequiredVerified(kyc)" (click)="decide(kyc, 'approved')">Approve KYC and release to Loans</button><label>Reason if rejecting<input [(ngModel)]="caseRejectionReasons[documentId(kyc)]" maxlength="500"></label><button type="button" class="button button-danger" [disabled]="busy || !caseRejectionReasons[documentId(kyc)]?.trim()" (click)="decide(kyc, 'rejected')">Return KYC for correction</button></div>
          @if (!allRequiredVerified(kyc)) { <p class="small-note">Verify every required document before approving KYC.</p> }
        } @else { <p class="small-note">The customer must upload replacement documents and resubmit this rejected KYC case.</p> }
      </section>
    }
  `,
})
export class KycReviewPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  cases: Row[] = [];
  loading = true;
  busy = false;
  error = '';
  success = '';
  rejectingDocumentId: number | null = null;
  rejectionReason = '';
  caseRejectionReasons: Record<number, string> = {};
  async ngOnInit(): Promise<void> { await this.refresh(); }
  async refresh(): Promise<void> {
    try { this.cases = await this.api.staffKycCases(); }
    catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
  documents(kyc: Row): Row[] {
    return Array.isArray(kyc['documents']) ? kyc['documents'] as Row[] : [];
  }
  isReviewable(kyc: Row): boolean {
    return kyc['status'] === 'submitted' || kyc['status'] === 'under_review';
  }
  documentId(row: Row): number { return Number(row['id']); }
  documentTypeLabel(type: unknown): string {
    return ({
      bank_statement: 'Bank statement (last 3 months)',
      national_id: 'Certified National ID or passport',
      payslip: 'Payslip / proof of income',
      proof_of_address: 'Proof of residence',
      spousal_consent: 'Spousal consent',
    } as Record<string, string>)[String(type)] ?? String(type);
  }
  requiredTypes(kyc: Row): string[] {
    const types = ['national_id', 'proof_of_address', 'payslip', 'bank_statement'];
    if (kyc['spousal_consent_required'] === true) types.push('spousal_consent');
    return types;
  }
  allRequiredVerified(kyc: Row): boolean {
    const docs = this.documents(kyc);
    return this.requiredTypes(kyc).every((type) => {
      const latest = docs.filter((doc) => doc['doc_type'] === type)
        .sort((left, right) => new Date(String(right['uploaded_at'])).getTime()
          - new Date(String(left['uploaded_at'])).getTime())[0];
      return latest?.['status'] === 'verified';
    });
  }
  beginDocumentRejection(doc: Row): void {
    this.rejectingDocumentId = this.documentId(doc);
    this.rejectionReason = '';
  }
  cancelDocumentRejection(): void {
    this.rejectingDocumentId = null;
    this.rejectionReason = '';
  }
  async reviewDocument(doc: Row, status: 'verified' | 'rejected'): Promise<void> {
    if (status === 'rejected' && !this.rejectionReason.trim()) return;
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      await this.api.updateDocumentStatus(this.documentId(doc), status,
        status === 'rejected' ? this.rejectionReason.trim() : undefined);
      this.success = `Document ${status}.`;
      this.cancelDocumentRejection();
      await this.refresh();
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }
  async decide(kyc: Row, decision: 'approved' | 'rejected'): Promise<void> {
    const reason = this.caseRejectionReasons[this.documentId(kyc)]?.trim();
    if (decision === 'approved' && !this.allRequiredVerified(kyc)) return;
    if (decision === 'rejected' && !reason) return;
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      await this.api.decideKycCase(this.documentId(kyc), decision, reason);
      this.success = decision === 'approved'
        ? `KYC #${kyc['id']} approved and released to the Loans queue.`
        : `KYC #${kyc['id']} returned to the customer for correction.`;
      await this.refresh();
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }
  async openDocument(doc: Row, download: boolean): Promise<void> {
    this.error = '';
    try {
      const blob = await this.api.downloadDocument(this.documentId(doc));
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement('a');
        link.href = url;
        link.download = String(doc['original_name'] || 'document');
        link.click();
      } else {
        window.open(url, '_blank', 'noopener');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally { this.changeDetector.detectChanges(); }
  }
  date(value: unknown): string {
    return value ? new Date(String(value)).toLocaleDateString() : '—';
  }
}

@Component({
  standalone: true,
  template: `
    <div class="page-heading"><div><div class="eyebrow">STAFF WORKSPACE</div><h1>Applications</h1><p>Review borrower requests and make a decision.</p></div></div>
    @if (error) { <div class="notice notice-error">{{ error }}</div> }
    <section class="panel">
      <div class="panel-heading"><div><h2>Application queue</h2><p>Filters and sorting start with your saved work preferences.</p></div>
        <div class="user-filter"><label>Status<select name="applicationFilter" [(ngModel)]="applicationFilter"><option value="all">All statuses</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="approved">Approved</option><option value="declined">Declined</option></select></label>
          <label>Sort<select name="applicationSort" [(ngModel)]="applicationSort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount_high">Amount: high to low</option><option value="amount_low">Amount: low to high</option></select></label></div>
      </div>
      @if (visibleApplications.length) { <div class="table-wrap" [class.compact-table]="dashboardLayout === 'compact'"><table><thead><tr><th>Applicant</th><th>Product</th><th>Amount requested</th><th>Term</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>@for (item of visibleApplications; track item['id']) { <tr><td>{{ item['applicant_name'] }}<small class="table-sub">{{ item['applicant_email'] }}</small></td><td>{{ item['product_name'] }}</td><td>{{ formatMoney(item['amount_requested']) }}</td><td>{{ item['tenure_months'] }} months</td><td>{{ date(item['created_at']) }}</td><td><span class="pill">{{ item['status'] }}</span></td><td><a [routerLink]="['/applications', item['id']]" class="table-link">Review →</a></td></tr> }</tbody></table></div> }
      @else if (!loading) { <div class="empty-state"><h3>No matching applications</h3><p>Choose another status filter or check back later.</p></div> }
      @else { <div class="empty-state compact"><p>Loading applications…</p></div> }
    </section>
  `,
  imports: [RouterLink, FormsModule],
})
export class ApplicationsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly formatMoney = money;
  applications: Row[] = [];
  applicationFilter: 'all' | 'submitted' | 'under_review' | 'approved' | 'declined' = 'all';
  applicationSort: UserSettings['applicationSort'] = 'newest';
  dashboardLayout: UserSettings['dashboardLayout'] = 'comfortable';
  error = '';
  loading = true;

  get visibleApplications(): Row[] {
    const matching = this.applicationFilter === 'all'
      ? [...this.applications]
      : this.applications.filter((item) => item['status'] === this.applicationFilter);
    return matching.sort((left, right) => {
      if (this.applicationSort === 'amount_high' || this.applicationSort === 'amount_low') {
        const difference = Number(left['amount_requested']) - Number(right['amount_requested']);
        return this.applicationSort === 'amount_high' ? -difference : difference;
      }
      const difference = new Date(String(left['created_at'])).getTime()
        - new Date(String(right['created_at'])).getTime();
      return this.applicationSort === 'newest' ? -difference : difference;
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      if (this.api.user()?.role === 'loan_officer') {
        [this.applications, this.settings] = await Promise.all([
          this.api.staffApplications(),
          this.api.mySettings(),
        ]);
        this.applicationFilter = this.settings.defaultApplicationFilter;
        this.applicationSort = this.settings.applicationSort;
        this.dashboardLayout = this.settings.dashboardLayout;
      } else {
        this.applications = await this.api.staffApplications();
      }
    }
    catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
  date(value: unknown): string { return value ? new Date(String(value)).toLocaleDateString() : '—'; }
  private settings: UserSettings | null = null;
}

@Component({
  standalone: true,
  template: `
    <div class="page-heading"><div><div class="eyebrow">APPLICATION REVIEW</div><h1>Application #{{ id }}</h1><p>Review the request and record a decision.</p></div><a routerLink="/applications" class="back-link">← Applications</a></div>
    @if (error) { <div class="notice notice-error">{{ error }}</div> } @if (success) { <div class="notice notice-success">{{ success }}</div> }
    @if (application) { <div class="detail-grid"><section class="panel"><h2>Applicant and request</h2><div class="detail-row"><span>Applicant</span><b>{{ application['applicant_name'] }}</b></div><div class="detail-row"><span>Email</span><b>{{ application['applicant_email'] }}</b></div><div class="detail-row"><span>Product</span><b>{{ application['product_name'] }}</b></div><div class="detail-row"><span>Amount</span><b>{{ formatMoney(application['amount_requested']) }}</b></div><div class="detail-row"><span>Term</span><b>{{ application['tenure_months'] }} months</b></div><div class="detail-row"><span>Purpose</span><b>{{ application['purpose'] }}</b></div><div class="detail-row"><span>Status</span><b>{{ application['status'] }}</b></div><h3>Documents</h3>@if (documents.length) { @for (doc of documents; track doc['id']) { <div class="document-review"><div class="document-row"><b>{{ documentTypeLabel(doc['doc_type']) }}</b><span>{{ doc['original_name'] }}</span><span class="pill">{{ doc['status'] }}</span></div><div class="document-actions"><button class="button button-secondary" [disabled]="busy" (click)="openDocument(doc, false)">View</button><button class="button button-secondary" [disabled]="busy" (click)="openDocument(doc, true)">Download</button></div>@if (canDecide && doc['status'] === 'pending') { @if (rejectingDocumentId === documentId(doc)) { <label class="reject-note">Reason for rejection<textarea rows="2" [(ngModel)]="rejectionReason" placeholder="Explain what needs to be corrected"></textarea></label><div class="document-actions"><button class="button button-danger" [disabled]="busy || !rejectionReason.trim()" (click)="reviewDocument(doc, 'rejected')">Confirm rejection</button><button class="button button-quiet" (click)="cancelDocumentRejection()">Cancel</button></div> } @else { <div class="document-actions"><button class="button button-secondary" [disabled]="busy" (click)="reviewDocument(doc, 'verified')">Verify</button><button class="button button-danger" [disabled]="busy" (click)="beginDocumentRejection(doc)">Reject</button></div> } }</div> } } @else { <p>No uploaded documents.</p> }</section><section class="panel decision-panel"><div class="eyebrow">HUMAN REVIEW</div><h2>Decision</h2><p>Approval creates and disburses the loan immediately.</p><label>Decline reason (if declining)<select [(ngModel)]="declineReason"><option value="insufficient_income">Insufficient income</option><option value="incomplete_documents">Incomplete documents</option><option value="failed_kyc">Failed KYC/identity check</option><option value="existing_delinquency">Existing delinquency</option><option value="amount_exceeds_policy">Amount exceeds policy</option><option value="other">Other</option></select></label><button class="button button-primary button-full" [disabled]="busy || !canDecide" (click)="decide('approved')">Approve &amp; disburse</button><button class="button button-danger button-full" [disabled]="busy || !canDecide" (click)="decide('declined')">Decline application</button>@if (!canDecide) { <p class="small-note">This application has already been decided.</p> }</section></div> }
  `,
  imports: [FormsModule, RouterLink],
})
export class ApplicationDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  id = '';
  application: Row | null = null;
  documents: Row[] = [];
  declineReason = 'other';
  rejectingDocumentId: number | null = null;
  rejectionReason = '';
  error = '';
  success = '';
  busy = false;
  get canDecide(): boolean { return this.application?.['status'] === 'submitted' || this.application?.['status'] === 'under_review'; }
  readonly formatMoney = money;
  documentId(document: Row): number { return Number(document['id']); }
  documentTypeLabel(type: unknown): string {
    return ({
      bank_statement: 'Bank statements (last 3 months)',
      national_id: 'National ID or passport',
      payslip: 'Payslip / proof of income',
      proof_of_address: 'Proof of residence',
      spousal_consent: 'Spousal consent',
    } as Record<string, string>)[String(type)] ?? String(type);
  }
  async openDocument(doc: Row, download: boolean): Promise<void> {
    this.error = '';
    try {
      const blob = await this.api.downloadDocument(Number(doc['id']));
      const url = URL.createObjectURL(blob);
      if (download) {
        const link = document.createElement('a');
        link.href = url;
        link.download = String(doc['original_name'] || 'document');
        link.click();
      } else {
        window.open(url, '_blank', 'noopener');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally { this.changeDetector.detectChanges(); }
  }
  async ngOnInit(): Promise<void> {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    try {
      this.application = await this.api.application(this.id);
      this.documents = Array.isArray(this.application['documents']) ? this.application['documents'] as Row[] : [];
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally { this.changeDetector.detectChanges(); }
  }
  async decide(decision: 'approved' | 'declined'): Promise<void> {
    if (!this.canDecide) return;
    if (decision === 'approved' && !confirm('Approve and disburse this loan now?')) return;
    this.busy = true;
    try {
      await this.api.decideApplication(this.id, decision, decision === 'declined' ? this.declineReason : undefined);
      this.success = `Application ${decision}.`;
      this.application = { ...this.application, status: decision };
      await this.router.navigateByUrl('/applications');
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }
  beginDocumentRejection(document: Row): void {
    this.rejectingDocumentId = Number(document['id']);
    this.rejectionReason = '';
  }
  cancelDocumentRejection(): void {
    this.rejectingDocumentId = null;
    this.rejectionReason = '';
  }
  async reviewDocument(document: Row, status: 'verified' | 'rejected'): Promise<void> {
    if (status === 'rejected' && !this.rejectionReason.trim()) return;
    this.busy = true;
    this.error = '';
    try {
      await this.api.updateDocumentStatus(
        Number(document['id']),
        status,
        status === 'rejected' ? this.rejectionReason.trim() : undefined,
      );
      document['status'] = status;
      this.success = `Document ${status}.`;
      this.cancelDocumentRejection();
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  template: `
    <div class="page-heading"><div><div class="eyebrow">PORTFOLIO MONITORING</div><h1>Portfolio at risk</h1><p>Accounts with installments currently marked overdue.</p></div></div>@if (error) { <div class="notice notice-error">{{ error }}</div> }
    <section class="panel">@if (rows.length) { <div class="table-wrap"><table><thead><tr><th>Borrower</th><th>Loan account</th><th>Principal</th><th>Overdue installments</th><th>Overdue amount</th><th>Status</th></tr></thead><tbody>@for (row of rows; track row['loan_account_id']) { <tr><td>{{ row['borrower'] }}<small class="table-sub">{{ row['email'] }}</small></td><td>#{{ row['loan_account_id'] }}</td><td>{{ formatMoney(row['principal']) }}</td><td>{{ row['overdue_installments'] }}</td><td>{{ formatMoney(row['overdue_amount']) }}</td><td><span class="pill pill-danger">{{ row['status'] }}</span></td></tr> }</tbody></table></div> } @else if (!loading) { <div class="empty-state"><h3>No overdue accounts</h3><p>Accounts at risk will appear here.</p></div> } @else { <div class="empty-state compact"><p>Loading report…</p></div> }</section>
  `,
})
export class PortfolioPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly formatMoney = money;
  rows: Row[] = [];
  loading = true;
  error = '';
  async ngOnInit(): Promise<void> {
    try { this.rows = await this.api.portfolioAtRisk(); }
    catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="page-heading"><div><div class="eyebrow">CUSTOMER CARE</div><h1>Complaints</h1><p>Track and update customer complaint investigations.</p></div></div>@if (error) { <div class="notice notice-error">{{ error }}</div> }
    <section class="panel">@if (items.length) { @for (item of items; track item['id']) { <article class="complaint-row"><div><h3>{{ item['subject'] }}</h3><p>{{ item['description'] }}</p><small>{{ item['complainant'] }} · {{ date(item['created_at']) }}</small></div><select [ngModel]="item['status']" (ngModelChange)="update(item, $event)"><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="escalated_nbfira">Escalated to NBFIRA</option></select></article> } } @else if (!loading) { <div class="empty-state"><h3>No complaints on file</h3><p>There are no customer complaints to show.</p></div> } @else { <div class="empty-state compact"><p>Loading complaints…</p></div> }</section>
  `,
})
export class ComplaintsPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  items: Row[] = [];
  error = '';
  loading = true;
  async ngOnInit(): Promise<void> {
    try { this.items = await this.api.complaints(); }
    catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
  date(value: unknown): string { return value ? new Date(String(value)).toLocaleDateString() : '—'; }
  async update(item: Row, status: string): Promise<void> {
    try {
      await this.api.updateComplaint(Number(item['id']), status);
      item['status'] = status;
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally { this.changeDetector.detectChanges(); }
  }
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <main class="auth-layout"><div class="auth-content"><a class="brand auth-brand" routerLink="/" aria-label="Refofe Novelty home"><img class="brand-logo" src="/images/refofe-novelty-logo.jpeg" alt="Refofe Novelty Proprietary Limited"></a><section class="auth-card"><a routerLink="/login" class="back-link">← Back to sign in</a><div class="eyebrow">ACCOUNT RECOVERY</div><h1>Forgot your password?</h1>@if (!codeSent) { <p class="auth-copy">Enter your account email. If it matches an account, we’ll send a six-digit reset code.</p> } @else { <p class="auth-copy">If an account matches <strong>{{ email }}</strong>, a six-digit code has been sent. Enter it below to choose a new password. The code expires in 10 minutes. If you need another code, wait a couple of minutes before resending.</p> }@if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }@if (success) { <div class="notice notice-success" role="status">{{ success }}</div> }@if (!codeSent) { <form (ngSubmit)="submit()"><label>Email address<input type="email" name="email" [(ngModel)]="email" required autocomplete="email"></label><button class="button button-primary button-full" [disabled]="busy">{{ busy ? 'Sending…' : 'Send reset code' }}</button></form> } @else { <form (ngSubmit)="reset()"><label>Six-digit code<input type="text" name="code" [(ngModel)]="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"></label><label>New password<input type="password" name="password" [(ngModel)]="password" required minlength="8" autocomplete="new-password"></label><button class="button button-primary button-full" [disabled]="busy">{{ busy ? 'Resetting…' : 'Reset password' }}</button></form><button class="button button-quiet button-full" type="button" [disabled]="busy" (click)="resend()">{{ busy ? 'Sending…' : 'Resend code' }}</button> }
    </section></div></main>
  `,
})
export class ForgotPasswordPage {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  email = '';
  code = '';
  password = '';
  codeSent = false;
  busy = false;
  error = '';
  success = '';
  async submit(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      const result = await this.api.requestPasswordReset(this.email);
      this.success = result.message;
      this.codeSent = true;
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }

  async reset(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      const result = await this.api.resetPassword(this.email, this.code, this.password);
      this.success = result.message;
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }

  async resend(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      const result = await this.api.requestPasswordReset(this.email);
      this.success = result.message;
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <main class="auth-layout"><a class="brand auth-brand" routerLink="/" aria-label="Refofe Novelty home"><img class="brand-logo" src="/images/refofe-novelty-logo.jpeg" alt="Refofe Novelty Proprietary Limited"></a><section class="auth-card"><a routerLink="/login" class="back-link">← Back to sign in</a><div class="eyebrow">ACCOUNT RECOVERY</div><h1>Choose a new password.</h1><p class="auth-copy">Reset links expire after one hour and can only be used once.</p>@if (error) { <div class="notice notice-error">{{ error }}</div> }@if (success) { <div class="notice notice-success">{{ success }} <a routerLink="/login">Sign in</a></div> }<form (ngSubmit)="submit()"><label>New password<input type="password" name="password" [(ngModel)]="password" required minlength="8" autocomplete="new-password"></label><button class="button button-primary button-full" [disabled]="busy || !token">{{ busy ? 'Saving…' : 'Reset password' }}</button></form></section></main>
  `,
})
export class ResetPasswordPage {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  token = this.route.snapshot.queryParamMap.get('token') ?? '';
  password = '';
  busy = false;
  error = '';
  success = '';
  async submit(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.success = '';
    try {
      const result = await this.api.resetPasswordWithToken(this.token, this.password);
      this.success = result.message;
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <main class="auth-layout"><div class="auth-content"><a class="brand auth-brand" routerLink="/" aria-label="Refofe Novelty home"><img class="brand-logo" src="/images/refofe-novelty-logo.jpeg" alt="Refofe Novelty Proprietary Limited"></a>
      <section class="auth-card"><a routerLink="/login" class="back-link">← Back to sign in</a><div class="eyebrow">ACCOUNT RECOVERY</div>
        @if (token) {
          <h1>{{ loading ? 'Verifying your email…' : success ? 'Email verified.' : 'Could not verify email.' }}</h1>
          @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
          @if (success) { <div class="notice notice-success" role="status">{{ success }}</div> }
          @if (success) { <a routerLink="/login" class="button button-primary button-full">Continue to sign in</a> }
        } @else if (success) {
          <h1>Email verified.</h1><div class="notice notice-success" role="status">{{ success }}</div>
          <a routerLink="/login" class="button button-primary button-full">Continue to sign in</a>
        } @else {
          <h1>Verify your email.</h1><p class="auth-copy">Enter the six-digit code sent to your email address. The code expires after 10 minutes.</p>
          @if (deliveryWarning) { <div class="notice notice-error" role="alert">{{ deliveryWarning }}</div> }
          @if (error) { <div class="notice notice-error" role="alert">{{ error }}</div> }
          @if (resendNotice) { <div class="notice notice-success" role="status">{{ resendNotice }}</div> }
          @if (success) { <div class="notice notice-success" role="status">{{ success }}</div> }
          <form (ngSubmit)="submitCode()">
            <label>Email address<input type="email" name="email" [(ngModel)]="email" required autocomplete="email"></label>
            <label>Verification code<input type="text" name="code" [(ngModel)]="code" required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"></label>
            <button class="button button-primary button-full" [disabled]="busy">{{ busy ? 'Verifying…' : 'Verify email' }}</button>
          </form>
          <button class="button button-quiet button-full" type="button" [disabled]="busy || !email.trim()" (click)="resendCode()">{{ busy ? 'Please wait…' : 'Resend code' }}</button>
          <p class="auth-switch">Already verified? <a routerLink="/login">Sign in</a></p>
        }
      </section></div>
    </main>
  `,
})
export class VerifyEmailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  token = '';
  email = '';
  code = '';
  loading = false;
  busy = false;
  success = '';
  error = '';
  deliveryWarning = '';
  resendNotice = '';

  async ngOnInit(): Promise<void> {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    this.email = this.route.snapshot.queryParamMap.get('email') ?? '';
    this.loading = Boolean(this.token);
    if (!this.token) {
      if (this.route.snapshot.queryParamMap.get('sent') === '0') {
        this.deliveryWarning = 'We could not send the code email. Check the email settings or use Resend code to try again.';
      }
      return;
    }
    try {
      const result = await this.api.verifyEmail(this.token);
      this.success = result.message;
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }

  async submitCode(): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      const result = await this.api.verifyEmailCode(this.email, this.code);
      this.success = result.message;
      this.email = '';
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.code = '';
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }

  async resendCode(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.resendNotice = '';
    this.deliveryWarning = '';
    try {
      const result = await this.api.resendVerificationCode(this.email);
      this.resendNotice = result.message;
    } catch (error) { this.error = ApiService.errorMessage(error); }
    finally {
      this.busy = false;
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `<main class="not-found"><a class="brand" routerLink="/" aria-label="Refofe Novelty home"><img class="brand-logo" src="/images/refofe-novelty-logo.jpeg" alt="Refofe Novelty Proprietary Limited"></a><div class="eyebrow">PAGE NOT FOUND</div><h1>We couldn’t find that page.</h1><a routerLink="/" class="button button-primary">Return to the home page</a></main>`,
})
export class NotFoundPage {}
