import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';
import { ThemeService } from '../../../../core/state/theme.service';

type LoginStatus = 'idle' | 'loading' | 'success';

/** Mappa i codici di errore di Firebase Auth in messaggi utente in italiano. */
const FIREBASE_ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'Inserisci un indirizzo email valido.',
  'auth/invalid-credential': 'Email o password non corretti.',
  'auth/user-not-found': 'Email o password non corretti.',
  'auth/wrong-password': 'Email o password non corretti.',
  'auth/user-disabled': 'Questo account è stato disabilitato.',
  'auth/too-many-requests': 'Troppi tentativi. Riprova tra qualche minuto.',
  'auth/network-request-failed': 'Impossibile contattare il server. Verifica la connessione.',
};
const FIREBASE_ERROR_FALLBACK = 'Accesso non riuscito. Riprova.';

/** Pagina di login: form email/password autenticato via Firebase Auth. */
@Component({
  selector: 'app-login',
  imports: [],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly themeService = inject(ThemeService);

  protected readonly theme = this.themeService.theme;
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly showPassword = signal(false);
  protected readonly error = signal('');
  protected readonly status = signal<LoginStatus>('idle');

  private readonly activeSegmentClass =
    'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]';
  private readonly inactiveSegmentClass = 'text-[var(--text-muted)]';

  protected readonly lightSegmentClass = computed(() =>
    this.theme() === 'light' ? this.activeSegmentClass : this.inactiveSegmentClass,
  );
  protected readonly darkSegmentClass = computed(() =>
    this.theme() === 'dark' ? this.activeSegmentClass : this.inactiveSegmentClass,
  );

  protected setTheme(theme: 'light' | 'dark'): void {
    this.themeService.setTheme(theme);
  }

  protected onEmailChange(value: string): void {
    this.email.set(value);
    this.error.set('');
    this.status.set('idle');
  }

  protected onPasswordChange(value: string): void {
    this.password.set(value);
    this.error.set('');
    this.status.set('idle');
  }

  protected togglePasswordVisibility(): void {
    this.showPassword.update((show) => !show);
  }

  protected submit(): void {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email().trim());
    if (!emailOk) {
      this.error.set('Inserisci un indirizzo email valido.');
      return;
    }
    if (!this.password()) {
      this.error.set('Inserisci la password.');
      return;
    }

    this.error.set('');
    this.status.set('loading');
    this.auth.login(this.email().trim(), this.password()).subscribe({
      next: () => {
        this.status.set('success');
        this.router.navigateByUrl('/');
      },
      error: (err: unknown) => {
        this.status.set('idle');
        this.error.set(this.mapFirebaseError(err));
      },
    });
  }

  /** Converte un errore di Firebase Auth in un messaggio utente in italiano. */
  private mapFirebaseError(err: unknown): string {
    const code = (err as { code?: string } | null)?.code;
    return (code && FIREBASE_ERROR_MESSAGES[code]) || FIREBASE_ERROR_FALLBACK;
  }
}
