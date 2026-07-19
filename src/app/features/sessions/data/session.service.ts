import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { Session } from '../../../models';

/** Campi di Session inviabili in creazione/modifica (id assegnato dal backend). */
export type SessionDraft = Omit<Session, 'id'>;

/** Accesso backend per le Session (esecuzioni di misura). */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(ApiService);

  /**
   * Recupera l'elenco delle sessioni.
   *
   * @returns Observable che emette l'array di Session (vuoto se nessuna).
   *
   * Backend: GET /sessions. Errori normalizzati in AppError dall'interceptor.
   */
  list(): Observable<Session[]> {
    return this.api.get<Session[]>('/sessions');
  }

  /**
   * Recupera una singola sessione col suo stato di avanzamento aggiornato.
   * Usata dal polling delle sessioni in esecuzione.
   *
   * @param id Id della sessione da recuperare.
   * @returns Observable che emette la Session con currentIndex e items aggiornati.
   *
   * Backend: GET /sessions/{id}. 200 -> Session; 404 -> inesistente.
   */
  get(id: string): Observable<Session> {
    return this.api.get<Session>(`/sessions/${id}`);
  }

  /**
   * Crea una nuova sessione già popolata di item, in stato "pending".
   * Non avvia l'esecuzione: la sessione resta in attesa finché non viene avviata.
   *
   * @param draft Dati della sessione da creare (senza id).
   * @returns Observable che emette la Session creata, con id assegnato dal backend.
   *
   * Backend: POST /sessions. 201 -> Session creata; 422 -> dati non validi.
   */
  create(draft: SessionDraft): Observable<Session> {
    return this.api.post<Session>('/sessions', draft);
  }

  /**
   * Avvia l'esecuzione di una sessione "pending".
   *
   * @param id Id della sessione da avviare.
   * @returns Observable che emette la Session aggiornata (status "running").
   *
   * Backend: POST /sessions/{id}/start. 200 -> Session in esecuzione;
   * 404 -> inesistente; 409 -> non avviabile (già in corso o completata).
   */
  start(id: string): Observable<Session> {
    return this.api.post<Session>(`/sessions/${id}/start`, {});
  }

  /**
   * Aggiorna una sessione esistente (es. riordino/rimozione degli item).
   *
   * @param id Id della sessione da aggiornare.
   * @param draft Nuovo valore dei campi della sessione (sostituzione completa).
   * @returns Observable che emette la Session aggiornata.
   *
   * Backend: PUT /sessions/{id}. 200 -> Session aggiornata; 404 -> inesistente.
   */
  update(id: string, draft: SessionDraft): Observable<Session> {
    return this.api.put<Session>(`/sessions/${id}`, draft);
  }

  /**
   * Rimuove una sessione dallo storico.
   *
   * @param id Id della sessione da eliminare.
   * @returns Observable che completa a eliminazione avvenuta.
   *
   * Backend: DELETE /sessions/{id}. 204 -> eliminata; 404 -> inesistente.
   */
  remove(id: string): Observable<void> {
    return this.api.delete<void>(`/sessions/${id}`);
  }
}
