import { InjectionToken } from '@angular/core';

/**
 * URL base a cui ApiService antepone ogni path relativo.
 * Valore di default sovrascrivibile nei provider di `app.config.ts`.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/api',
});
