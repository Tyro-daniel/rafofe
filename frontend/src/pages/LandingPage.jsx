import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { loansApi } from "../api/loans";
import { Logo } from "../components/layout/Logo";
import { Button } from "../components/ui/Button";
import { formatMoney } from "../utils/format";
import { estimateMonthlyInstallment } from "../utils/loanMath";
import "./LandingPage.css";

/**
 * DELIBERATELY ZERO react-icons IMPORTS ON THIS PAGE.
 *
 * This page previously imported several icons from "react-icons/fi"
 * (FiShield, FiClock, FiEye, FiHeadphones, FiThumbsUp, FiDollarSign,
 * FiChevronDown, etc.) and users reported the page crashing to the
 * ErrorBoundary with no confirmed root cause. The leading suspect: a
 * named icon export that doesn't exist in the exact react-icons version
 * actually installed via npm on the user's machine (react-icons isn't
 * version-pinned in package.json — it uses a caret range — and this
 * sandbox has no network access to install and verify the real package,
 * so a mismatch could not be ruled out from here with certainty).
 *
 * Rather than keep guessing at which icon name might be wrong, every
 * icon on this page was replaced with plain Unicode characters and CSS —
 * zero external component dependency, zero possibility of an "element
 * type is invalid: got undefined" crash from a bad icon import. If this
 * page still fails to render after this change, the cause is definitely
 * NOT an icon import, which meaningfully narrows the next debugging step.
 */

const TRUST_SIGNALS = [
  "Licensed micro-lender, regulated by NBFIRA",
  "Secure online applications",
  "Transparent pricing — no hidden fees",
  "Fast application review",
  "Dedicated customer support",
];

const HOW_IT_WORKS = [
  { title: "Apply online", text: "Create an account and submit your loan request in minutes." },
  { title: "Upload documents", text: "Add your ID and payslip securely from any device." },
  { title: "Get a decision", text: "A loan officer reviews your application, usually within one business day." },
  { title: "Receive your funds", text: "Approved loans are disbursed straight to your account." },
];

// KYC/document requirements, as specified by the business. The interest
// rate line intentionally shows BOTH real product rates from the actual
// loan_products table (30% MPR Small Micro Loan, 25% MPR Medium Loan)
// rather than a single flat "30%" — the business's Small Micro Loan
// product IS 30% MPR, so this is consistent with (not a contradiction
// of) the original ask; showing both avoids the page quoting a rate that
// wouldn't match the real Medium Loan product further down the page.
const REQUIREMENTS = [
  "Signed Loan Agreement document",
  "Copy of certified Omang (national ID)",
  "Proof of residence — affidavit, copy of lease, or confirmation of employment showing your residential address",
  "Proof of source of funds — latest payslip and latest bank statement",
];

const REGULATORS = [
  {
    name: "NBFIRA",
    fullName: "Non-Bank Financial Institutions Regulatory Authority",
    summary: "Regulates and licenses non-bank financial institutions in Botswana, including microlenders like us — setting the rules we operate under, from loan agreement requirements to responsible-lending conduct.",
    url: "https://www.nbfira.org.bw/",
  },
  {
    name: "FIA",
    fullName: "Financial Intelligence Agency (goAML)",
    summary: "Botswana's financial intelligence unit, responsible for anti-money-laundering and counter-terrorism-financing oversight — the body that receives and analyzes suspicious transaction reporting across the financial sector.",
    url: "https://www.fia.org.bw/goamltrn/Home",
  },
];

const FAQS = [
  { q: "What documents do I need to apply?", a: "A certified copy of your Omang, proof of residence, and proof of your source of funds (latest payslip and bank statement) — see \"What you'll need\" above for the full list." },
  { q: "How is interest calculated?", a: "We use a Monthly Percentage Rate (MPR), charged on your outstanding balance each month — not an annual rate divided down. Every product's rate is shown upfront before you apply." },
  { q: "What happens if I pay late?", a: "A late payment penalty applies, capped by law at 5% of your outstanding balance per month, and it can never exceed your total outstanding principal." },
  { q: "Can I apply for a large loan online?", a: "Loans above our Medium Loan's maximum are arranged directly with a loan officer rather than through the online form — contact a branch to discuss your requirements." },
  { q: "Is my information secure?", a: "Yes — your documents and personal data are encrypted and only accessible to you and the staff reviewing your application." },
];

export function LandingPage() {
  const [products, setProducts] = useState(null);

  useEffect(() => {
    // Array.isArray guard: if the API ever returns something that isn't a
    // clean array, fall back to an empty array rather than letting a
    // later `.map()` on a non-array crash the page.
    loansApi.publicListProducts()
      .then((data) => setProducts(Array.isArray(data) ? data : []))
      .catch(() => setProducts([]));
  }, []);

  return (
    <div className="landing">
      <LandingHeader />
      <Hero products={products} />
      <TrustBar />
      <LoanProducts products={products} />
      <Requirements />
      <CautionBanner />
      <HowItWorks />
      <RegulatoryTrust />
      <AboutUs />
      <Faqs />
      <LandingFooter />
    </div>
  );
}

function LandingHeader() {
  return (
    <header className="landing-header">
      <div className="container landing-header-inner">
        <Logo size={90} wordmarkText="" />
        <nav className="landing-nav" aria-label="Primary">
          <a href="#products">Loan Products</a>
          <a href="#how-it-works">How It Works</a>
          <a href="#requirements">Requirements</a>
          <a href="#faqs">FAQs</a>
          <a href="#about">About Us</a>
        </nav>
        <div className="landing-header-actions">
          <Link to="/login"><Button variant="secondary" size="sm">Borrower Login</Button></Link>
          <Link to="/register"><Button size="sm">Apply Now</Button></Link>
        </div>
      </div>
    </header>
  );
}

function Hero({ products }) {
  const combinedMin = products?.length ? Math.min(...products.map((p) => Number(p.min_amount))) : 500;
  const combinedMax = products?.length ? Math.max(...products.map((p) => Number(p.max_amount))) : 15000;

  const [amount, setAmount] = useState(2000);
  const [tenure, setTenure] = useState(3);

  const matchedProduct = useMemo(() => {
    if (!products?.length) return null;
    return products.find((p) => amount >= Number(p.min_amount) && amount <= Number(p.max_amount)) || null;
  }, [products, amount]);

  const maxTenureForProduct = matchedProduct?.max_tenure_months || 6;
  const minTenureForProduct = matchedProduct?.min_tenure_months || 1;
  const clampedTenure = Math.min(Math.max(tenure, minTenureForProduct), maxTenureForProduct);

  const estimate = matchedProduct
    ? estimateMonthlyInstallment(amount, Number(matchedProduct.monthly_rate_pct), clampedTenure)
    : null;

  return (
    <section className="hero">
      <div className="container hero-grid">
        <div className="hero-copy">
          <h1>Financial inclusion, made possible.</h1>
          <h2>More Than Just Money. Creating Opportunity, Dignity, and Hope..</h2>
          <p className="hero-subhead">
            Fast, transparent, and responsible lending — apply online and know exactly what you'll repay before you commit.
          </p>
          <div className="hero-cta-row">
            <Link to="/register"><Button size="md">Apply for a loan</Button></Link>
            <a href="#calculator"><Button variant="secondary" size="md">Calculate my repayment</Button></a>
          </div>
        </div>

        <div className="hero-calculator" id="calculator">
          <h3>Loan calculator</h3>
          {products === null ? (
            <p>Loading current rates…</p>
          ) : products.length === 0 ? (
            <p>Calculator is temporarily unavailable — please try again shortly.</p>
          ) : (
            <>
              <label className="calc-label" htmlFor="calc-amount">
                Loan amount <span className="figure">{formatMoney(amount)}</span>
              </label>
              <input
                id="calc-amount"
                type="range"
                min={combinedMin}
                max={combinedMax}
                step={100}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="calc-slider"
              />

              <label className="calc-label" htmlFor="calc-tenure">
                Term <span className="figure">{clampedTenure} {clampedTenure === 1 ? "month" : "months"}</span>
              </label>
              <input
                id="calc-tenure"
                type="range"
                min={minTenureForProduct}
                max={maxTenureForProduct}
                step={1}
                value={clampedTenure}
                onChange={(e) => setTenure(Number(e.target.value))}
                className="calc-slider"
              />

              {estimate ? (
                <div className="calc-result">
                  <div className="calc-result-row">
                    <span>Estimated monthly payment</span>
                    <strong className="figure">{formatMoney(estimate.monthlyInstallment)}</strong>
                  </div>
                  <div className="calc-result-row">
                    <span>Total repayment</span>
                    <strong className="figure">{formatMoney(estimate.totalRepayable)}</strong>
                  </div>
                  <div className="calc-result-row calc-result-rate">
                    <span>{matchedProduct.name} · {matchedProduct.monthly_rate_pct}% MPR</span>
                  </div>
                </div>
              ) : (
                <p className="calc-no-match">
                  That amount is above our online loan limit — larger amounts are arranged directly with a loan officer.
                </p>
              )}
              <p className="calc-disclaimer">Estimate for planning purposes only. Your exact schedule is confirmed at approval.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function TrustBar() {
  return (
    <section className="trust-bar">
      <div className="container trust-bar-inner">
        {TRUST_SIGNALS.map((text) => (
          <div className="trust-item" key={text}>
            <span className="trust-item-mark" aria-hidden="true">✓</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function LoanProducts({ products }) {
  return (
    <section className="landing-section" id="products">
      <div className="container">
        <h2>Loan products</h2>
        <p className="section-subhead">Straightforward terms, quoted as a Monthly Percentage Rate — no surprises.</p>

        <div className="product-cards">
          {products?.map((p) => (
            <div className="product-card" key={p.id}>
              <h3>{p.name}</h3>
              <div className="product-card-rate">{p.monthly_rate_pct}% <span>MPR / month</span></div>
              <p>{formatMoney(p.min_amount)} – {formatMoney(p.max_amount)}</p>
              <p className="product-card-tenure">{p.min_tenure_months}–{p.max_tenure_months} month terms</p>
            </div>
          ))}
            <div className="product-card product-card-muted">
              <h3>Large loans</h3>
              <p>Need more than our largest online product? Larger amounts are arranged directly with a loan officer.</p>
              <p className="product-card-contact">Contact a branch to discuss your requirements:</p>
              
              <ul className="product-card-contact-list">
                <li>
                  <strong>Contact Number:</strong>{' '}
                  <a href="tel:+267712345678">+267 75 137 113</a>
                </li>
                <li>
                  <strong>WhatsApp:</strong>{' '}
                  <a 
                    href="https://wa.me/26775137113" 
                    target="_blank" 
                    rel="noopener noreferrer"
                  >
                    75 137 113
                  </a>
                </li>
                <li>
                  <strong>Email:</strong>{' '}
                  <a href="mailto:refofenovelty@gmail.com">refofenovelty@gmail.com</a>
                </li>
              </ul>
            </div>
        </div>
      </div>
    </section>
  );
}

function Requirements() {
  return (
    <section className="landing-section landing-section-muted" id="requirements">
      <div className="container">
        <h2>What you'll need to apply</h2>
        <p className="section-subhead">
          Our lending requires KYC information as per NBFIRA requirements. Have these ready before you start:
        </p>
        <ul className="requirements-list">
          {REQUIREMENTS.map((item) => (
            <li key={item}><span aria-hidden="true">✓</span> {item}</li>
          ))}
        </ul>
        <p className="requirements-rate-note">
          Interest rate: <strong>30% MPR</strong> on our Small Micro Loan (P500–P15,000), <strong>25% MPR</strong> on
          our Medium Loan (P15,000–P20,000) — see Loan Products above for full terms.
        </p>
      </div>
    </section>
  );
}

function CautionBanner() {
  return (
    <div className="caution-banner">
      <div className="container caution-banner-inner">
        <strong>CAUTION!</strong> Borrowing more than you can afford to repay could lead to severe financial difficulties.
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="landing-section" id="how-it-works">
      <div className="container">
        <h2>How it works</h2>
        <div className="steps-grid">
          {HOW_IT_WORKS.map(({ title, text }, i) => (
            <div className="step-card" key={title}>
              <div className="step-number">{i + 1}</div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RegulatoryTrust() {
  return (
    <section className="landing-section landing-section-muted" id="regulatory">
      <div className="container">
        <h2>Regulated and supervised</h2>
        <p className="section-subhead">We operate under, and report to, Botswana's financial regulatory bodies.</p>
        <div className="regulator-cards">
          {REGULATORS.map((r) => (
            <a className="regulator-card" href={r.url} target="_blank" rel="noopener noreferrer" key={r.name}>
              <h3>{r.name} <span aria-hidden="true">↗</span></h3>
              <p className="regulator-fullname">{r.fullName}</p>
              <p>{r.summary}</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function AboutUs() {
  return (
    <section className="landing-section" id="about">
      <div className="container about-grid">
        <div>
          <h2>About us</h2>
          {/* Placeholder copy — replace with your company's real history,
              mission, and licensing details before going live. */}
          <p>
            We're a Botswana-based micro-lending company focused on responsible, transparent lending for individuals
            and small businesses. We're licensed and regulated by NBFIRA, and every loan we offer is quoted with
            clear terms upfront — no hidden fees, no fine print surprises.
          </p>
        </div>
      </div>
    </section>
  );
}

function Faqs() {
  return (
    <section className="landing-section landing-section-muted" id="faqs">
      <div className="container">
        <h2>Frequently asked questions</h2>
        <div className="faq-list">
          {FAQS.map(({ q, a }) => (
            <details className="faq-item" key={q}>
              <summary>
                <span>{q}</span>
                <span className="faq-chevron" aria-hidden="true">▾</span>
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="container footer-inner">
        <div>
          <Logo size={90} wordmarkText="LMS" />
          <p className="footer-tagline">Licensed micro-lender, regulated by NBFIRA.</p>
        </div>
        <div className="footer-links">
          <a href="#faqs">Complaints procedure</a>
          <a href="#about">Responsible lending</a>
          <a href="https://www.nbfira.org.bw/" target="_blank" rel="noopener noreferrer">NBFIRA ↗</a>
          <a href="https://www.fia.org.bw/goamltrn/Home" target="_blank" rel="noopener noreferrer">FIA ↗</a>
          <Link to="/staff/login">Employee? Staff Portal login</Link>
        </div>
      </div>
    </footer>
  );
}
