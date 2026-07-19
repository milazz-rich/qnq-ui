import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AppError } from '../errors/app-error';
import { ErrorService } from '../errors/error.service';

/**
 * Normalizza un HttpErrorResponse nel tipo unico AppError dell'app.
 *
 * @param error Errore emesso da HttpClient.
 * @returns AppError con code/message/status/details coerenti.
 */
function toAppError(error: HttpErrorResponse): AppError {
  // status 0 => errore di rete / risposta assente.
  if (error.status === 0) {
    return {
      code: 'network',
      message: 'Impossibile contattare il server. Verifica la connessione.',
      status: 0,
      details: error.error,
    };
  }
  const serverMessage =
    typeof error.error?.message === 'string' ? error.error.message : error.message;
  return {
    code: `http_${error.status}`,
    message: serverMessage || `Errore ${error.status}.`,
    status: error.status,
    details: error.error,
  };
}

/**
 * Interceptor funzionale di gestione errori centralizzata: converte ogni
 * HttpErrorResponse in AppError, lo inoltra a ErrorService per la notifica UI
 * e lo rilancia così che il chiamante possa comunque reagire.
 */
export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const errorService = inject(ErrorService);
  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const appError = toAppError(error);
      errorService.report(appError);
      return throwError(() => appError);
    }),
  );
};
