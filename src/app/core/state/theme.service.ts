import { Injectable, signal } from '@angular/core';

/** Tema visivo dell'applicazione. */
export type Theme = 'light' | 'dark';

/**
 * Stato del tema (chiaro/scuro) condiviso dall'app shell. Il layout applica
 * il valore come attributo `data-theme`; l'header lo commuta.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly current = signal<Theme>('light');

  /** Tema attivo, in sola lettura. */
  readonly theme = this.current.asReadonly();

  /**
   * Imposta il tema attivo.
   *
   * @param theme Tema da applicare ('light' | 'dark').
   * @returns void
   */
  setTheme(theme: Theme): void {
    this.current.set(theme);
  }
}
