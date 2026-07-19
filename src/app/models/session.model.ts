import { Protocol } from './protocol.model';

export type SessionStatus = 'pending' | 'running' | 'completed';

/** Stato di avanzamento runtime di un SessionItem dentro una Session. */
export interface SessionRunItem {
  sessionItemId: string; // FK -> SessionItem.id
  label: string;
  proto: Protocol; // protocollo di questa esecuzione
  total: number; // ripetizioni totali da eseguire
  done: number; // ripetizioni completate
  status: SessionStatus; // pending | running | completed
}

/** Esecuzione ordinata di una lista di misure (SessionItem). */
export interface Session {
  id: string;
  name: string;
  when: string; // timestamp ISO 8601
  status: SessionStatus; // pending | running | completed
  currentIndex: number; // indice dell'item in esecuzione
  items: SessionRunItem[]; // avanzamento per ciascun item
}
