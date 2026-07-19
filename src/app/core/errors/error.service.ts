import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { AppError } from './app-error';

/**
 * Raccolta centralizzata degli errori applicativi. L'interceptor HTTP
 * inoltra qui ogni AppError; la UI (toast/banner) si sottoscrive a `errors$`
 * per notificarli. I service non mostrano errori da soli.
 */
@Injectable({ providedIn: 'root' })
export class ErrorService {
  private readonly errorSubject = new Subject<AppError>();

  /** Stream degli errori applicativi emessi nel tempo. */
  readonly errors$: Observable<AppError> = this.errorSubject.asObservable();

  /**
   * Segnala un errore normalizzato ai sottoscrittori di `errors$`.
   *
   * @param error Errore già normalizzato in forma AppError.
   * @returns void
   */
  report(error: AppError): void {
    this.errorSubject.next(error);
  }
}
