import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';

type LoginStatus = 'idle' | 'loading' | 'success';
type Theme = 'light' | 'dark';

/** Pagina di login: form email/password con autenticazione mock. */
@Component({
  selector: 'app-login',
  imports: [],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly theme = signal<Theme>('light');
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

  protected setTheme(theme: Theme): void {
    this.theme.set(theme);
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
    this.auth.login(this.email().trim(), this.password()).subscribe(() => {
      this.status.set('success');
      this.router.navigateByUrl('/');
    });
  }
}
