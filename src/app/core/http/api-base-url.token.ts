import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

/**
 * URL base a cui ApiService antepone ogni path relativo.
 * Il valore di default viene da `environment.apiBaseUrl`; sovrascrivibile
 * esplicitamente nei provider di `app.config.ts` (es. per i test).
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => environment.apiBaseUrl,
});
