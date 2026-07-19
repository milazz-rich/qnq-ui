import { Injectable } from '@angular/core';
import { BehaviorSubject, distinctUntilChanged, map, Observable } from 'rxjs';

/**
 * Stato di loading globale osservabile. Tiene un contatore delle richieste
 * HTTP in volo; `loading$` emette true finché almeno una è attiva.
 * L'incremento/decremento è gestito centralmente da ApiService, non dai
 * singoli componenti.
 */
@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly inFlight = new BehaviorSubject<number>(0);

  /** true finché c'è almeno una richiesta in corso. */
  readonly loading$: Observable<boolean> = this.inFlight.pipe(
    map((count) => count > 0),
    distinctUntilChanged(),
  );

  /**
   * Registra l'inizio di una richiesta (incrementa il contatore).
   *
   * @returns void
   */
  begin(): void {
    this.inFlight.next(this.inFlight.value + 1);
  }

  /**
   * Registra la fine di una richiesta (decrementa il contatore, mai sotto 0).
   *
   * @returns void
   */
  end(): void {
    this.inFlight.next(Math.max(0, this.inFlight.value - 1));
  }
}
