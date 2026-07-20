import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Theme, ThemeService } from '../../core/state/theme.service';

/** Voce di navigazione della sidebar. */
interface NavItem {
  label: string;
  link: string;
  exact: boolean;
}

/**
 * Barra laterale a tutta altezza: logo, navigazione principale e, in fondo,
 * commutazione tema e menu utente con disconnessione.
 */
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  private readonly themeService = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly navItems: NavItem[] = [
    { label: 'Dashboard', link: '/', exact: true },
    { label: 'Nuova sessione', link: '/new-session', exact: false },
    { label: 'Sessioni', link: '/sessions', exact: false },
    { label: 'Server', link: '/servers', exact: false },
    { label: 'Client', link: '/clients', exact: false },
    { label: 'Scenari', link: '/scenarios', exact: false },
    { label: 'Risultati', link: '/results', exact: false },
  ];

  protected readonly theme = this.themeService.theme;
  protected readonly userMenuOpen = signal(false);

  protected readonly userEmail = computed(() => this.auth.currentUser?.email ?? null);
  protected readonly avatarInitial = computed(() =>
    (this.userEmail() ?? '?').charAt(0).toUpperCase(),
  );

  private readonly activeSegmentClass =
    'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]';
  private readonly inactiveSegmentClass = 'text-[var(--text-muted)]';

  protected readonly lightSegmentClass = computed(() =>
    this.theme() === 'light' ? this.activeSegmentClass : this.inactiveSegmentClass,
  );
  protected readonly darkSegmentClass = computed(() =>
    this.theme() === 'dark' ? this.activeSegmentClass : this.inactiveSegmentClass,
  );

  protected setTheme(theme: Theme): void {
    this.themeService.setTheme(theme);
  }

  protected toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }

  protected closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }

  protected logout(): void {
    this.userMenuOpen.set(false);
    this.auth.logout().subscribe(() => this.router.navigateByUrl('/login'));
  }
}
