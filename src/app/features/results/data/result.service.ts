import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { Result } from '../../../models';

/** Filtri opzionali applicabili lato backend all'elenco dei risultati. */
export interface ResultFilters {
  /** Restringe ai risultati del solo scenario con questo path (es. "/images"). */
  scenarioPath?: string;
  /** Restringe ai risultati generati dai SessionItem indicati (join per id). */
  sessionItemIds?: string[];
}

/** Accesso backend per i Result (misure prodotte dalle sessioni). */
@Injectable({ providedIn: 'root' })
export class ResultService {
  private readonly api = inject(ApiService);

  /**
   * Recupera i risultati di misura, opzionalmente filtrati per scenario e/o
   * per gli item di una sessione.
   *
   * @param filters Filtri opzionali; se omessi recupera tutti i risultati.
   * @returns Observable che emette l'array di Result (vuoto se nessuno).
   *
   * Backend: GET /results[?scenarioPath=...][&sessionItemIds=id1,id2,...].
   * `sessionItemIds` filtra sul campo Result.sessionItemId (join diretto per
   * id con i SessionRunItem di una Session). Errori normalizzati in AppError
   * dall'interceptor.
   */
  list(filters?: ResultFilters): Observable<Result[]> {
    const params: Record<string, string> = {};
    if (filters?.scenarioPath) {
      params['scenarioPath'] = filters.scenarioPath;
    }
    if (filters?.sessionItemIds?.length) {
      params['sessionItemIds'] = filters.sessionItemIds.join(',');
    }
    return this.api.get<Result[]>('/results', Object.keys(params).length ? params : undefined);
  }
}
