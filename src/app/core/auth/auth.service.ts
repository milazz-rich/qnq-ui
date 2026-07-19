import { Injectable, signal } from '@angular/core';
import { delay, Observable, of, tap } from 'rxjs';

/**
 * Gestione mock dell'autenticazione: nessun backend reale, lo stato
 * "autenticato" vive solo in memoria per la durata della sessione browser.
 * Da sostituire con chiamate HTTP reali quando il backend sarà disponibile.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly authenticatedState = signal(false);
  private readonly emailState = signal<string | null>(null);

  /** Segnale di sola lettura: true se l'utente ha effettuato un login mock. */
  readonly isAuthenticated = this.authenticatedState.asReadonly();

  /** Email dell'utente autenticato, null se non loggato. */
  readonly userEmail = this.emailState.asReadonly();

  /**
   * Simula una richiesta di login. Accetta qualsiasi email/password non
   * vuote e imposta lo stato "autenticato" dopo una breve latenza finta.
   *
   * @param email Email inserita dall'utente (non validata lato service).
   * @param password Password inserita dall'utente (non validata lato service).
   * @returns Observable che emette `true` a login riuscito.
   *
   * Backend: nessuno. Mock in memoria che simula ~800ms di latenza di rete.
   */
  login(email: string, password: string): Observable<boolean> {
    return of(true).pipe(
      delay(800),
      tap(() => {
        this.authenticatedState.set(true);
        this.emailState.set(email);
      }),
    );
  }

  /**
   * Azzera lo stato "autenticato" in memoria.
   *
   * @returns void
   *
   * Backend: nessuno. Mock in memoria, nessun effetto persistente.
   */
  logout(): void {
    this.authenticatedState.set(false);
    this.emailState.set(null);
  }
}
