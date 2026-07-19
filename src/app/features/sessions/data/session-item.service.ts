import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { SessionItem } from '../../../models';

/** Campi di SessionItem inviabili in creazione (id assegnato dal backend). */
export type SessionItemDraft = Omit<SessionItem, 'id'>;

/** Accesso backend per i SessionItem (misure configurate). */
@Injectable({ providedIn: 'root' })
export class SessionItemService {
  private readonly api = inject(ApiService);

  /**
   * Recupera tutte le misure configurate.
   *
   * @returns Observable che emette l'array di SessionItem (vuoto se nessuno).
   *
   * Backend: GET /session-items. Errori normalizzati in AppError dall'interceptor.
   */
  list(): Observable<SessionItem[]> {
    return this.api.get<SessionItem[]>('/session-items');
  }

  /**
   * Crea una nuova misura configurata (combinazione target × scenario × client).
   *
   * @param draft Dati della misura da creare (senza id).
   * @returns Observable che emette il SessionItem creato, con id assegnato dal backend.
   *
   * Backend: POST /session-items. 201 -> SessionItem creato; 422 -> dati non validi.
   */
  create(draft: SessionItemDraft): Observable<SessionItem> {
    return this.api.post<SessionItem>('/session-items', draft);
  }
}
