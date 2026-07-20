import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideAuth, getAuth } from '@angular/fire/auth';

import { routes } from './app.routes';
import { httpErrorInterceptor } from './core/http/http-error.interceptor';
import { firebaseConfig } from './core/auth/firebase.config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([httpErrorInterceptor])),
    // API_BASE_URL: default da environment.apiBaseUrl (vedi core/http/api-base-url.token.ts).
    // Firebase: sostituire i placeholder in core/auth/firebase.config.ts
    // con le credenziali del progetto reale prima del deploy.
    provideFirebaseApp(() => initializeApp(firebaseConfig)),
    provideAuth(() => getAuth()),
  ]
};
