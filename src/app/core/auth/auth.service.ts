import { inject, Injectable, signal } from '@angular/core';
import {
  Auth,
  User,
  user,
  updateProfile,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
} from '@angular/fire/auth';
import { from, Observable } from 'rxjs';

/**
 * Autenticazione reale via Firebase Auth. Lo stato dell'utente corrente è
 * tenuto sincronizzato con lo stream `user()` di AngularFire (basato su
 * `onAuthStateChanged`) e specchiato in un signal, letto tramite `currentUser`.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly firebaseAuth = inject(Auth);
  private readonly currentUserSig = signal<User | null>(null);
  private readonly user$: Observable<User | null> = user(this.firebaseAuth);

  constructor() {
    this.user$.subscribe((u) => this.currentUserSig.set(u));
  }

  /** Utente Firebase attualmente autenticato, `null` se nessuno. */
  get currentUser(): User | null {
    return this.currentUserSig();
  }

  /**
   * Registra un nuovo utente con email/password e imposta il nome visualizzato.
   * Non ancora collegato a nessuna UI: predisposto per un futuro form di registrazione.
   *
   * @param email Email del nuovo account.
   * @param username Nome visualizzato da assegnare al profilo.
   * @param password Password del nuovo account (min. 6 caratteri per Firebase).
   * @returns Observable che completa a registrazione avvenuta.
   *
   * Firebase: createUserWithEmailAndPassword + updateProfile.
   * Errori tipici: auth/email-already-in-use, auth/invalid-email, auth/weak-password.
   */
  register(email: string, username: string, password: string): Observable<void> {
    const promise = createUserWithEmailAndPassword(
      this.firebaseAuth,
      email,
      password,
    ).then((response) => updateProfile(response.user, { displayName: username }));
    return from(promise);
  }

  /**
   * Effettua il login con email e password.
   *
   * @param email Email dell'account.
   * @param password Password dell'account.
   * @returns Observable che completa a login avvenuto; `currentUser` si
   * aggiorna automaticamente subito dopo tramite lo stream `user()`.
   *
   * Firebase: signInWithEmailAndPassword.
   * Errori tipici: auth/invalid-email, auth/invalid-credential (credenziali
   * errate), auth/user-disabled, auth/too-many-requests, auth/network-request-failed.
   */
  login(email: string, password: string): Observable<void> {
    const promise = signInWithEmailAndPassword(this.firebaseAuth, email, password).then(() => {});
    return from(promise);
  }

  /**
   * Effettua il login tramite popup Google.
   * Non ancora collegato a nessuna UI: predisposto per un futuro pulsante "Accedi con Google".
   *
   * @returns Observable che completa a login avvenuto.
   *
   * Firebase: signInWithPopup + GoogleAuthProvider.
   * Errori tipici: auth/popup-closed-by-user, auth/popup-blocked, auth/cancelled-popup-request.
   */
  google(): Observable<void> {
    const promise = signInWithPopup(this.firebaseAuth, new GoogleAuthProvider()).then(() => {});
    return from(promise);
  }

  /**
   * Disconnette l'utente corrente.
   *
   * @returns Observable che completa a logout avvenuto; `currentUser` torna a `null`.
   *
   * Firebase: signOut.
   */
  logout(): Observable<void> {
    const promise = signOut(this.firebaseAuth);
    return from(promise);
  }

  /**
   * Invia l'email di reset password.
   * Non ancora collegato a nessuna UI: predisposto per il link "Password dimenticata?".
   *
   * @param email Email dell'account per cui resettare la password.
   * @returns Observable che completa a invio avvenuto.
   *
   * Firebase: sendPasswordResetEmail.
   * Errori tipici: auth/invalid-email, auth/user-not-found.
   */
  askPasswordReset(email: string): Observable<void> {
    const promise = sendPasswordResetEmail(this.firebaseAuth, email).then(() => {});
    return from(promise);
  }

  /**
   * Verifica la validità di un codice di reset password ricevuto via email.
   * Non ancora collegato a nessuna UI: predisposto per la pagina di conferma reset.
   *
   * @param oobCode Codice ricevuto via link nell'email di reset.
   * @returns Observable che completa se il codice è valido.
   *
   * Firebase: verifyPasswordResetCode.
   * Errori tipici: auth/expired-action-code, auth/invalid-action-code.
   */
  verifyPasswordReset(oobCode: string): Observable<void> {
    const promise = verifyPasswordResetCode(this.firebaseAuth, oobCode).then(() => {});
    return from(promise);
  }

  /**
   * Conferma il reset password impostando la nuova password.
   * Non ancora collegato a nessuna UI: predisposto per la pagina di conferma reset.
   *
   * @param oobCode Codice ricevuto via link nell'email di reset.
   * @param newPassword Nuova password da impostare.
   * @returns Observable che completa a reset avvenuto.
   *
   * Firebase: confirmPasswordReset.
   * Errori tipici: auth/expired-action-code, auth/invalid-action-code, auth/weak-password.
   */
  confirmPasswordReset(oobCode: string, newPassword: string): Observable<void> {
    const promise = confirmPasswordReset(this.firebaseAuth, oobCode, newPassword).then(() => {});
    return from(promise);
  }
}
