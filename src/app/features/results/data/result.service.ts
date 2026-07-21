import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { Result } from '../../../models';

/** Filtri opzionali applicabili lato backend all'elenco dei risultati. */
export interface ResultFilters {
  /** Restringe ai risultati del solo scenario con questo path (es. "/images"). */
  scenarioPath?: string;
  /** Restringe ai risultati della sessione con questo id (join diretto e univoco). */
  sessionId?: string;
}

/** Accesso backend per i Result (misure prodotte dalle sessioni). */
@Injectable({ providedIn: 'root' })
export class ResultService {
  private readonly api = inject(ApiService);

  /**
   * Recupera i risultati di misura, opzionalmente filtrati per scenario e/o sessione.
   *
   * @param filters Filtri opzionali; se omessi recupera tutti i risultati.
   * @returns Observable che emette l'array di Result (vuoto se nessuno).
   *
   * Backend: GET /results[?scenarioPath=...][&sessionId=...]. `sessionId`
   * filtra sul campo Result.sessionId, riferimento diretto e univoco alla
   * Session generatrice — a differenza di Result.sessionItemId (condiviso tra
   * una Session e i suoi rilanci), non è ambiguo. Errori normalizzati in
   * AppError dall'interceptor.
   */
  list(filters?: ResultFilters): Observable<Result[]> {
    const params: Record<string, string> = {};
    if (filters?.scenarioPath) {
      params['scenarioPath'] = filters.scenarioPath;
    }
    if (filters?.sessionId) {
      params['sessionId'] = filters.sessionId;
    }
    return this.api.get<Result[]>('/results', Object.keys(params).length ? params : undefined);
  }
}
