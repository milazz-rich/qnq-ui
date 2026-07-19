import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { Target } from '../../../models';

/** Campi di Target inviabili in creazione/modifica (id assegnato dal backend). */
export type TargetDraft = Omit<Target, 'id'>;

/** Accesso backend per i Target (server bersaglio). */
@Injectable({ providedIn: 'root' })
export class TargetService {
  private readonly api = inject(ApiService);

  /**
   * Recupera tutti i target configurati.
   *
   * @returns Observable che emette l'array di Target (vuoto se nessuno).
   *
   * Backend: GET /targets. Errori normalizzati in AppError dall'interceptor.
   */
  list(): Observable<Target[]> {
    return this.api.get<Target[]>('/targets');
  }

  /**
   * Crea un nuovo target.
   *
   * @param draft Dati del target da creare (senza id).
   * @returns Observable che emette il Target creato, con id assegnato dal backend.
   *
   * Backend: POST /targets. 201 -> Target creato; 422 -> dati non validi.
   */
  create(draft: TargetDraft): Observable<Target> {
    return this.api.post<Target>('/targets', draft);
  }

  /**
   * Aggiorna un target esistente, incluso lo stato.
   *
   * @param id Id del target da aggiornare.
   * @param draft Nuovo valore dei campi del target (sostituzione completa).
   * @returns Observable che emette il Target aggiornato.
   *
   * Backend: PUT /targets/{id}. 200 -> Target aggiornato; 404 -> inesistente.
   */
  update(id: string, draft: TargetDraft): Observable<Target> {
    return this.api.put<Target>(`/targets/${id}`, draft);
  }

  /**
   * Elimina un target dalla configurazione.
   *
   * @param id Id del target da eliminare.
   * @returns Observable che completa a eliminazione avvenuta.
   *
   * Backend: DELETE /targets/{id}. 204 -> eliminato; 404 -> inesistente.
   */
  remove(id: string): Observable<void> {
    return this.api.delete<void>(`/targets/${id}`);
  }
}
