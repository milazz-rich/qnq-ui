import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { Client } from '../../../models';

/** Campi di Client inviabili in creazione/modifica (id assegnato dal backend). */
export type ClientDraft = Omit<Client, 'id'>;

/** Accesso backend per i Client (strumenti/browser di test). */
@Injectable({ providedIn: 'root' })
export class ClientService {
  private readonly api = inject(ApiService);

  /**
   * Recupera tutti i client definiti.
   *
   * @returns Observable che emette l'array di Client (vuoto se nessuno).
   *
   * Backend: GET /clients. Errori normalizzati in AppError dall'interceptor.
   */
  list(): Observable<Client[]> {
    return this.api.get<Client[]>('/clients');
  }

  /**
   * Crea un nuovo client.
   *
   * @param draft Dati del client da creare (senza id).
   * @returns Observable che emette il Client creato, con id assegnato dal backend.
   *
   * Backend: POST /clients. 201 -> Client creato; 422 -> dati non validi.
   */
  create(draft: ClientDraft): Observable<Client> {
    return this.api.post<Client>('/clients', draft);
  }

  /**
   * Aggiorna un client esistente.
   *
   * @param id Id del client da aggiornare.
   * @param draft Nuovo valore dei campi del client (sostituzione completa).
   * @returns Observable che emette il Client aggiornato.
   *
   * Backend: PUT /clients/{id}. 200 -> Client aggiornato; 404 -> inesistente.
   */
  update(id: string, draft: ClientDraft): Observable<Client> {
    return this.api.put<Client>(`/clients/${id}`, draft);
  }

  /**
   * Elimina un client dall'elenco.
   *
   * @param id Id del client da eliminare.
   * @returns Observable che completa a eliminazione avvenuta.
   *
   * Backend: DELETE /clients/{id}. 204 -> eliminato; 404 -> inesistente.
   */
  remove(id: string): Observable<void> {
    return this.api.delete<void>(`/clients/${id}`);
  }
}
