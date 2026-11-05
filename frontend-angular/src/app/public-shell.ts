import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-public-nav',
  standalone: true,
  imports: [RouterLink],
  template: `
    <header class="public-nav" [class.nav-open]="menuOpen">
      <button class="menu-toggle" type="button" (click)="toggleMenu()" [attr.aria-expanded]="menuOpen"
        aria-controls="public-navigation" [attr.aria-label]="menuOpen ? 'Close navigation menu' : 'Open navigation menu'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          @if (menuOpen) { <path d="m6 6 12 12M18 6 6 18"/> } @else { <path d="M3 6h18M3 12h18M3 18h18"/> }
        </svg>
      </button>
      <a class="brand" routerLink="/" aria-label="Refofe Novelty home">
        <img class="brand-logo" src="/images/refofe-novelty-logo.jpeg" alt="Refofe Novelty Proprietary Limited">
      </a>
      <form class="header-search" role="search" (submit)="searchSite($event)">
        <button type="submit" aria-label="Find a page">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>
          </svg>
        </button>
        <input type="search" placeholder="Find a page" aria-label="Find a page" [value]="searchQuery"
          (input)="setSearchQuery($event)">
      </form>
      <div class="nav-actions">
        <a class="button button-quiet" routerLink="/login">Log in</a>
        <a class="button button-primary" routerLink="/how-to-apply">Apply now <span aria-hidden="true">↗</span></a>
      </div>
      <nav id="public-navigation" aria-label="Main navigation" [attr.aria-hidden]="!menuOpen">
        <a routerLink="/" (click)="closeMenu()">Home</a>
        <a routerLink="/products" (click)="closeMenu()">Loan Products</a>
        <a routerLink="/calculator" (click)="closeMenu()">Repayment Calculator</a>
        <a routerLink="/about" (click)="closeMenu()">About</a>
        <a routerLink="/regulatory" (click)="closeMenu()">Regulatory Information</a>
        <a routerLink="/how-to-apply" (click)="closeMenu()">How to Apply</a>
      </nav>
    </header>
    @if (searchMessage) { <div class="search-message" role="status">{{ searchMessage }}</div> }
  `,
})
export class PublicNav {
  private readonly router = inject(Router);
  menuOpen = false;
  searchQuery = '';
  searchMessage = '';

  private readonly destinations: { path: string; terms: string[] }[] = [
    { path: '/products', terms: ['loan', 'product', 'interest', 'rate', 'amount', 'term'] },
    { path: '/calculator', terms: ['calculator', 'repayment', 'estimate', 'payment'] },
    { path: '/about', terms: ['about', 'company', 'refofe', 'who'] },
    { path: '/regulatory', terms: ['regulatory', 'nbfira', 'licence', 'license', 'disclosure'] },
    { path: '/how-to-apply', terms: ['apply', 'application', 'documents', 'requirements'] },
    { path: '/login', terms: ['login', 'log in', 'sign in', 'account'] },
  ];

  toggleMenu(): void {
    this.menuOpen = !this.menuOpen;
  }

  closeMenu(): void {
    this.menuOpen = false;
  }

  setSearchQuery(event: Event): void {
    this.searchQuery = (event.target as HTMLInputElement).value;
    this.searchMessage = '';
  }

  searchSite(event: Event): void {
    event.preventDefault();
    const query = this.searchQuery.trim().toLocaleLowerCase();
    if (!query) {
      this.searchMessage = 'Enter a search term to find a page.';
      return;
    }

    const destination = this.destinations.find(({ terms }) => terms.some((term) => query.includes(term)));
    if (!destination) {
      this.searchMessage = `No page found for "${this.searchQuery.trim()}".`;
      return;
    }

    this.searchMessage = '';
    this.closeMenu();
    void this.router.navigateByUrl(destination.path);
  }
}

@Component({
  selector: 'app-public-footer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <footer class="site-footer">
      <div class="container footer-inner">
        <a class="brand" routerLink="/" aria-label="Refofe Novelty home">
          <img class="brand-logo" src="/images/refofe-novelty-logo.jpeg" alt="Refofe Novelty Proprietary Limited">
        </a>
        <span>Responsible lending. Clear terms. Human decisions.</span>
        <a routerLink="/login-staff">Staff sign in</a>
      </div>
    </footer>
  `,
})
export class PublicFooter {}
