import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { Client } from '../../../models';

/**
 * Accesso backend per i Client (strumenti/browser di test). Sola lettura: il
 * backend supporta un unico client fisso ("curl"), quindi non esiste più
 * creazione/modifica/eliminazione lato UI — usato solo per popolare il
 * riepilogo in Dashboard e la configurazione del wizard Nuova sessione.
 */
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
}
