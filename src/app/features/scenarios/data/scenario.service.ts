import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { Scenario } from '../../../models';

/** Campi di Scenario inviabili in creazione/modifica (id assegnato dal backend). */
export type ScenarioDraft = Omit<Scenario, 'id'>;

/** Accesso backend per gli Scenario (percorsi da misurare). */
@Injectable({ providedIn: 'root' })
export class ScenarioService {
  private readonly api = inject(ApiService);

  /**
   * Recupera tutti gli scenari disponibili.
   *
   * @returns Observable che emette l'array di Scenario (vuoto se nessuno).
   *
   * Backend: GET /scenarios. Errori normalizzati in AppError dall'interceptor.
   */
  list(): Observable<Scenario[]> {
    return this.api.get<Scenario[]>('/scenarios');
  }

  /**
   * Crea un nuovo scenario.
   *
   * @param draft Dati dello scenario da creare (senza id).
   * @returns Observable che emette lo Scenario creato, con id assegnato dal backend.
   *
   * Backend: POST /scenarios. 201 -> Scenario creato; 422 -> dati non validi.
   */
  create(draft: ScenarioDraft): Observable<Scenario> {
    return this.api.post<Scenario>('/scenarios', draft);
  }

  /**
   * Aggiorna uno scenario esistente.
   *
   * @param id Id dello scenario da aggiornare.
   * @param draft Nuovo valore dei campi dello scenario (sostituzione completa).
   * @returns Observable che emette lo Scenario aggiornato.
   *
   * Backend: PUT /scenarios/{id}. 200 -> Scenario aggiornato; 404 -> inesistente.
   */
  update(id: string, draft: ScenarioDraft): Observable<Scenario> {
    return this.api.put<Scenario>(`/scenarios/${id}`, draft);
  }

  /**
   * Elimina uno scenario dalla gestione.
   *
   * @param id Id dello scenario da eliminare.
   * @returns Observable che completa a eliminazione avvenuta.
   *
   * Backend: DELETE /scenarios/{id}. 204 -> eliminato; 404 -> inesistente.
   */
  remove(id: string): Observable<void> {
    return this.api.delete<void>(`/scenarios/${id}`);
  }
}
