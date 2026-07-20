import { Injectable, signal } from '@angular/core';

/** Tema visivo dell'applicazione. */
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'qnq-theme';

/** Legge il tema salvato in precedenza, se presente e valido. */
function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    // localStorage non disponibile (privacy mode, ecc.): nessuna persistenza.
    return null;
  }
}

/**
 * Stato del tema (chiaro/scuro) condiviso dall'app shell. Il layout applica
 * il valore come attributo `data-theme`; la sidebar lo commuta. La preferenza
 * è persistita in `localStorage` e ripristinata a ogni caricamento dell'app.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly current = signal<Theme>(readStoredTheme() ?? 'light');

  /** Tema attivo, in sola lettura. */
  readonly theme = this.current.asReadonly();

  /**
   * Imposta il tema attivo e lo salva in `localStorage` per le sessioni future.
   *
   * @param theme Tema da applicare ('light' | 'dark').
   * @returns void
   */
  setTheme(theme: Theme): void {
    this.current.set(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage non disponibile: la preferenza resta solo per la sessione corrente.
    }
  }
}
