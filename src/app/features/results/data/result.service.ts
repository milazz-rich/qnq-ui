import { inject, Injectable } from '@angular/core';
import { EMPTY, expand, Observable, reduce } from 'rxjs';
import { ApiService, QueryParams } from '../../../core/http/api.service';
import { Result } from '../../../models';

/**
 * Massimo `pageSize` accettato dal backend (oltre risponde 422). Determina
 * quante richieste servono a `listAll` per ricomporre l'insieme completo.
 */
const MAX_PAGE_SIZE = 200;

/**
 * Tetto di sicurezza al numero di pagine che `listAll` incatena: evita di
 * sommergere il backend se il dataset cresce oltre le attese (200 × 50 =
 * 10.000 record). Oltre questa soglia l'insieme restituito è troncato.
 */
const MAX_PAGES = 50;

/** Filtri opzionali applicabili lato backend all'elenco dei risultati. */
export interface ResultFilters {
  /** Restringe ai risultati del solo scenario con questo path (es. "/images"). */
  scenarioPath?: string;
  /** Restringe ai risultati della sessione con questo id (join diretto e univoco). */
  sessionId?: string;
  /** Restringe ai risultati prodotti dal client con questo id. */
  clientId?: string;
  /** Pagina richiesta (1-based). Se omessa il backend restituisce l'insieme completo. */
  page?: number;
  /** Dimensione pagina. Se omessa il backend restituisce l'insieme completo. */
  pageSize?: number;
}

/**
 * Risposta paginata di GET /results: il backend non restituisce più un array
 * semplice ma un envelope con l'elenco della pagina corrente e il conteggio
 * totale dei record che soddisfano i filtri (indipendente dalla paginazione).
 */
export interface ResultPage {
  items: Result[];
  total: number;
  page: number;
  pageSize: number;
}

/** Accesso backend per i Result (misure prodotte dalle sessioni). */
@Injectable({ providedIn: 'root' })
export class ResultService {
  private readonly api = inject(ApiService);

  /**
   * Recupera i risultati di misura, opzionalmente filtrati e paginati.
   *
   * @param filters Filtri opzionali (scenario, sessione, client) e paginazione
   *   (`page`/`pageSize`); se la paginazione è omessa il backend restituisce
   *   tutti i record che soddisfano i filtri.
   * @returns Observable che emette l'envelope `ResultPage`: `items` è la sola
   *   pagina richiesta, `total` il conteggio complessivo dopo i filtri.
   *
   * Backend: GET /results[?scenarioPath=...][&sessionId=...][&clientId=...]
   * [&page=...][&pageSize=...]. `sessionId` filtra sul campo Result.sessionId,
   * riferimento diretto e univoco alla Session generatrice — a differenza di
   * Result.sessionItemId (condiviso tra una Session e i suoi rilanci), non è
   * ambiguo. Errori normalizzati in AppError dall'interceptor.
   */
  list(filters?: ResultFilters): Observable<ResultPage> {
    const params: QueryParams = {};
    if (filters?.scenarioPath) {
      params['scenarioPath'] = filters.scenarioPath;
    }
    if (filters?.sessionId) {
      params['sessionId'] = filters.sessionId;
    }
    if (filters?.clientId) {
      params['clientId'] = filters.clientId;
    }
    if (filters?.page !== undefined) {
      params['page'] = filters.page;
    }
    if (filters?.pageSize !== undefined) {
      params['pageSize'] = filters.pageSize;
    }
    return this.api.get<ResultPage>('/results', Object.keys(params).length ? params : undefined);
  }

  /**
   * Recupera **tutti** i Result che soddisfano i filtri, ricomponendoli dalle
   * pagine successive. Serve a chi ragiona sull'insieme completo e non su una
   * pagina: aggregati/grafici e export Excel.
   *
   * @param filters Filtri opzionali (senza paginazione: è gestita qui).
   * @returns Observable che emette una sola volta l'array completo dei Result.
   *
   * Backend: GET /results paginato con `pageSize` = {@link MAX_PAGE_SIZE} (il
   * massimo accettato: valori superiori danno 422) ripetuto finché non sono
   * stati letti `total` record, con tetto di {@link MAX_PAGES} pagine. Nota:
   * omettere `page`/`pageSize` NON restituisce tutto — il backend applica
   * comunque un `pageSize` di default (50).
   */
  listAll(filters?: ResultFilters): Observable<Result[]> {
    return this.list({ ...filters, page: 1, pageSize: MAX_PAGE_SIZE }).pipe(
      expand((page) => {
        const fetched = page.page * MAX_PAGE_SIZE;
        const hasMore = fetched < page.total && page.page < MAX_PAGES;
        return hasMore
          ? this.list({ ...filters, page: page.page + 1, pageSize: MAX_PAGE_SIZE })
          : EMPTY;
      }),
      reduce((acc, page) => acc.concat(page.items), [] as Result[]),
    );
  }
}
