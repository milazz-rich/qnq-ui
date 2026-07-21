import { Protocol } from './protocol.model';

export type ResultStatus = 'completed' | 'failed';

/** Risultato di una singola esecuzione (una ripetizione misurata). */
export interface Result {
  id: string;
  idx: number;
  sessionId: string; // FK -> Session.id (Sessione univoca che ha generato la misura)
  sessionItemId: string; // FK -> SessionRunItem.sessionItemId (configurazione target/scenario/client)
  target: string; // nome del target misurato
  scenarioPath: string; // path dello scenario, es. "/images"
  proto: Protocol; // protocollo richiesto
  actualProto: Protocol; // protocollo effettivo (può ricadere su HTTP/2)
  total: number; // ms, tempo totale di risposta
  ttfb: number; // ms, Time to First Byte
  kb: number; // dati trasferiti (KB)
  status: ResultStatus; // completed | failed
  time: string; // timestamp ISO 8601
}
