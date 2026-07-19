/**
 * Errore normalizzato dell'applicazione. Ogni errore HTTP viene convertito
 * in questa forma dall'interceptor centralizzato, così la UI e i chiamanti
 * lavorano su un tipo unico indipendente dal dettaglio di trasporto.
 */
export interface AppError {
  /** Codice sintetico e stabile (es. "http_500", "network", "unknown"). */
  code: string;
  /** Messaggio leggibile mostrabile all'utente. */
  message: string;
  /** Status HTTP originale (0 se errore di rete/nessuna risposta). */
  status: number;
  /** Payload/diagnostica opzionale associata all'errore. */
  details?: unknown;
}
