import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, LoanProduct } from './api.service';
import { PublicFooter, PublicNav } from './public-shell';

const FALLBACK_PRODUCTS: LoanProduct[] = [
  { id: 1, name: 'Small Micro Loan', monthly_rate_pct: 30, min_amount: 500, max_amount: 10000, min_tenure_months: 1, max_tenure_months: 6 },
  { id: 2, name: 'Medium Loan', monthly_rate_pct: 25, min_amount: 10000, max_amount: 15000, min_tenure_months: 3, max_tenure_months: 12 },
];

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
  imports: [PublicNav, PublicFooter, RouterLink],
  template: `
    <div class="landing-page">
      <app-public-nav />
      <main>
        <section class="section container public-page-intro">
          <div class="eyebrow">FIND YOUR FIT</div>
          <h1>Loan products</h1>
          <p>Explore available options. Your final offer and repayment schedule will be confirmed by a loan officer.</p>
          @if (error) { <div class="notice notice-warning" role="status">{{ error }}</div> }
          @if (products.length) {
            <div class="product-grid">
              @for (product of products; track product.id) {
                <article class="product-card">
                  <span class="product-index">0{{ $index + 1 }}</span><div class="product-icon">↗</div>
                  <h2>{{ product.name }}</h2><p class="product-rate">{{ product.monthly_rate_pct }}% <small>MPR / month</small></p>
                  <div class="product-meta"><span>Amount</span><b>{{ formatMoney(product.min_amount) }} – {{ formatMoney(product.max_amount) }}</b></div>
                  <div class="product-meta"><span>Term</span><b>{{ product.min_tenure_months }}–{{ product.max_tenure_months }} months</b></div>
                  <a routerLink="/how-to-apply" class="product-link">How to apply <span>→</span></a>
                </article>
              }
            </div>
          } @else if (!loading) {
            <p class="small-note">Loan products are currently unavailable.</p>
          }
        </section>
      </main>
      <app-public-footer />
    </div>
  `,
})
export class LoanProductsPage {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  products = FALLBACK_PRODUCTS;
  loading = true;
  error = '';
  readonly formatMoney = money;

  async ngOnInit(): Promise<void> {
    try {
      this.products = await this.api.products();
    } catch {
      this.error = 'Live product information is unavailable. The options below are examples; contact us to confirm current terms.';
    } finally {
      this.loading = false;
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  imports: [PublicNav, PublicFooter, RouterLink],
  template: `
    <div class="landing-page">
      <app-public-nav />
      <main>
        <section class="calculator-band">
          <div class="container calculator-content">
            <div>
              <div class="eyebrow">BORROW WITH CLARITY</div>
              <h1>Repayment calculator</h1>
              <p>Adjust the amount and term to see an illustrative repayment. A loan officer will confirm your actual schedule.</p>
              @if (error) { <div class="notice notice-warning" role="status">{{ error }}</div> }
              <a routerLink="/products" class="text-link">Explore loan products <span>→</span></a>
            </div>
            <div class="calculator-card">
              <div class="calc-label">REPAYMENT ESTIMATE</div>
              <label class="range-label" for="calc-amount">Loan amount <strong>{{ formatMoney(amount) }}</strong></label>
              <input id="calc-amount" type="range" class="range-control" [min]="minimumAmount" [max]="maximumAmount"
                step="100" [value]="amount" (input)="setAmount($event)">
              <label class="range-label" for="calc-tenure">Term <strong>{{ calcTerm }} {{ calcTerm === 1 ? 'month' : 'months' }}</strong></label>
              <input id="calc-tenure" type="range" class="range-control" [min]="minimumTerm" [max]="maximumTerm"
                step="1" [value]="calcTerm" (input)="setTerm($event)">
              <div class="calc-divider"></div>
              <div class="calc-output"><span>Estimated monthly payment</span><strong>{{ formatMoney(monthlyPayment) }}</strong></div>
              <div class="calc-output"><span>Total estimated repayment</span><strong>{{ formatMoney(monthlyPayment * calcTerm) }}</strong></div>
              <p>{{ calculatorProduct?.name }} · {{ calculatorProduct?.monthly_rate_pct }}% monthly interest. Estimate only; terms are confirmed on approval.</p>
            </div>
          </div>
        </section>
      </main>
      <app-public-footer />
    </div>
  `,
})
export class RepaymentCalculatorPage {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  products = FALLBACK_PRODUCTS;
  amount = 2000;
  term = 3;
  error = '';
  readonly formatMoney = money;

  get calculatorProduct(): LoanProduct | undefined {
    return this.products.find((product) =>
      this.amount >= Number(product.min_amount) && this.amount <= Number(product.max_amount));
  }
  get minimumAmount(): number {
    return Math.min(...this.products.map((product) => Number(product.min_amount)));
  }
  get maximumAmount(): number {
    return Math.max(...this.products.map((product) => Number(product.max_amount)));
  }
  get minimumTerm(): number { return Number(this.calculatorProduct?.min_tenure_months ?? 1); }
  get maximumTerm(): number { return Number(this.calculatorProduct?.max_tenure_months ?? 12); }
  get calcTerm(): number { return Math.max(this.minimumTerm, Math.min(this.term, this.maximumTerm)); }
  get monthlyPayment(): number {
    return this.calculatorProduct
      ? estimate(this.amount, Number(this.calculatorProduct.monthly_rate_pct), this.calcTerm)
      : 0;
  }

  setAmount(event: Event): void {
    this.amount = Number((event.target as HTMLInputElement).value);
    this.term = this.calcTerm;
  }
  setTerm(event: Event): void {
    this.term = Number((event.target as HTMLInputElement).value);
  }

  async ngOnInit(): Promise<void> {
    try {
      this.products = await this.api.products();
      this.amount = Math.max(this.minimumAmount, Math.min(this.amount, this.maximumAmount));
      this.term = this.calcTerm;
    } catch {
      this.error = 'Live product rates are unavailable. This estimate uses example rates and is not an offer.';
    } finally {
      this.changeDetector.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  imports: [PublicNav, PublicFooter, RouterLink],
  template: `
    <div class="landing-page">
      <app-public-nav />
      <main>
        <section class="section container public-page-intro">
          <div class="eyebrow">ABOUT REFOFE NOVELTY</div>
          <h1>Clear, responsible lending for Botswana.</h1>
          <p class="public-about-copy">Refofe Novelty provides a digital way to explore micro-loan products and apply. Applications are reviewed by loan officers, and repayment terms are shared to help borrowers make informed decisions.</p>
          <div class="steps-grid">
            <article><span>01</span><h3>Create your account</h3><p>Register securely and verify your email address.</p></article>
            <article><span>02</span><h3>Share your documents</h3><p>Upload the documents needed to review your application.</p></article>
            <article><span>03</span><h3>A person reviews it</h3><p>A loan officer checks your application and makes the decision.</p></article>
          </div>
          <a routerLink="/how-to-apply" class="button button-primary">How to apply <span aria-hidden="true">→</span></a>
        </section>
      </main>
      <app-public-footer />
    </div>
  `,
})
export class AboutPage {}

@Component({
  standalone: true,
  imports: [PublicNav, PublicFooter, RouterLink],
  template: `
    <div class="landing-page">
      <app-public-nav />
      <main>
        <section class="regulatory-band">
          <div class="container regulatory-content">
            <div>
              <div class="eyebrow">REGULATORY INFORMATION</div>
              <h1>Borrow with confidence.</h1>
              <p>Review licensing and consumer-protection information from the Non-Bank Financial Institutions Regulatory Authority (NBFIRA). For current licensing details, contact Refofe Novelty directly.</p>
              <a href="https://www.nbfira.org.bw/" target="_blank" rel="noopener noreferrer" class="button button-secondary">
                Visit NBFIRA <span aria-hidden="true">↗</span>
              </a>
            </div>
            <div class="responsible-borrowing">
              <h3>Responsible borrowing</h3>
              <p>Before applying, consider whether repayments fit your budget and review the loan terms carefully. Every application is subject to human review. Do not share your card PIN with anyone.</p>
              <a routerLink="/how-to-apply" class="text-link">Review application information <span>→</span></a>
            </div>
          </div>
        </section>
      </main>
      <app-public-footer />
    </div>
  `,
})
export class RegulatoryInformationPage {}

@Component({
  standalone: true,
  imports: [PublicNav, PublicFooter, RouterLink],
  template: `
    <div class="landing-page">
      <app-public-nav />
      <main>
        <section class="requirements-band">
          <div class="container requirements-inner">
            <div>
              <div class="eyebrow">BEFORE YOU APPLY</div>
              <h1>Get a few things ready.</h1>
              <p>We’ll ask for documents to help verify your identity and assess your application. Only submit accurate information through your secure account.</p>
            </div>
            <ul>
              <li>Certified national ID</li>
              <li>Recent payslip or proof of income</li>
              <li>Proof of residence</li>
              <li>Bank statement</li>
              <li>Spousal consent where applicable</li>
            </ul>
          </div>
        </section>
        <section class="section container public-page-intro">
          <div class="eyebrow">RESPONSIBLE BORROWING</div>
          <h2>Choose a repayment you can manage.</h2>
          <p>Review the product terms and estimate repayments before applying. An officer will review your application; submitting an application does not guarantee approval.</p>
          <div class="nav-actions">
            <a routerLink="/register" class="button button-primary">Create an account to apply <span aria-hidden="true">→</span></a>
            <a routerLink="/login" class="button button-secondary">Already registered? Log in</a>
          </div>
        </section>
      </main>
      <app-public-footer />
    </div>
  `,
})
export class ApplicationInformationPage {}
