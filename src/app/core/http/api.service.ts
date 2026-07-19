import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { finalize, Observable } from 'rxjs';
import { LoadingService } from '../state/loading.service';
import { API_BASE_URL } from './api-base-url.token';

/** Mappa di query params accettata dai metodi di ApiService. */
export type QueryParams = Record<string, string | number | boolean>;

/**
 * Unico punto dell'app che usa HttpClient direttamente. Antepone il base URL
 * a ogni path, applica gli header comuni e traccia lo stato di loading globale.
 * Gli errori NON sono gestiti qui: fluiscono all'interceptor centralizzato.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly loading = inject(LoadingService);
  private readonly baseUrl = inject(API_BASE_URL);

  private readonly defaultHeaders = { 'Content-Type': 'application/json' };

  /**
   * Esegue una GET.
   *
   * @param path Path relativo al base URL (es. "/targets").
   * @param params Query params opzionali.
   * @returns Observable che emette il corpo della risposta tipizzato come T.
   *
   * Backend: GET {baseUrl}{path}. Errori normalizzati in AppError dall'interceptor.
   */
  get<T>(path: string, params?: QueryParams): Observable<T> {
    return this.track(
      this.http.get<T>(this.url(path), {
        headers: this.defaultHeaders,
        params: this.toHttpParams(params),
      }),
    );
  }

  /**
   * Esegue una POST.
   *
   * @param path Path relativo al base URL.
   * @param body Corpo della richiesta (serializzato in JSON).
   * @returns Observable che emette il corpo della risposta tipizzato come T.
   *
   * Backend: POST {baseUrl}{path}. Errori normalizzati in AppError dall'interceptor.
   */
  post<T>(path: string, body: unknown): Observable<T> {
    return this.track(
      this.http.post<T>(this.url(path), body, { headers: this.defaultHeaders }),
    );
  }

  /**
   * Esegue una PUT.
   *
   * @param path Path relativo al base URL.
   * @param body Corpo della richiesta (serializzato in JSON).
   * @returns Observable che emette il corpo della risposta tipizzato come T.
   *
   * Backend: PUT {baseUrl}{path}. Errori normalizzati in AppError dall'interceptor.
   */
  put<T>(path: string, body: unknown): Observable<T> {
    return this.track(
      this.http.put<T>(this.url(path), body, { headers: this.defaultHeaders }),
    );
  }

  /**
   * Esegue una PATCH.
   *
   * @param path Path relativo al base URL.
   * @param body Corpo parziale della richiesta (serializzato in JSON).
   * @returns Observable che emette il corpo della risposta tipizzato come T.
   *
   * Backend: PATCH {baseUrl}{path}. Errori normalizzati in AppError dall'interceptor.
   */
  patch<T>(path: string, body: unknown): Observable<T> {
    return this.track(
      this.http.patch<T>(this.url(path), body, { headers: this.defaultHeaders }),
    );
  }

  /**
   * Esegue una DELETE.
   *
   * @param path Path relativo al base URL.
   * @returns Observable che emette il corpo della risposta tipizzato come T.
   *
   * Backend: DELETE {baseUrl}{path}. Errori normalizzati in AppError dall'interceptor.
   */
  delete<T>(path: string): Observable<T> {
    return this.track(
      this.http.delete<T>(this.url(path), { headers: this.defaultHeaders }),
    );
  }

  /** Compone l'URL assoluto anteponendo il base URL al path relativo. */
  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /** Converte una mappa piatta in HttpParams; undefined se assente. */
  private toHttpParams(params?: QueryParams): HttpParams | undefined {
    if (!params) {
      return undefined;
    }
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      httpParams = httpParams.set(key, String(value));
    }
    return httpParams;
  }

  /** Traccia la richiesta nel LoadingService (begin/end garantito da finalize). */
  private track<T>(request$: Observable<T>): Observable<T> {
    this.loading.begin();
    return request$.pipe(finalize(() => this.loading.end()));
  }
}
