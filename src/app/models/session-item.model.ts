/**
 * Singola misura configurata: combinazione target × scenario × client
 * con i parametri di esecuzione. È l'unità componibile in una Session.
 */
export interface SessionItem {
  id: string;
  targetId: string; // FK -> Target.id
  scenarioId: string; // FK -> Scenario.id
  clientId: string; // FK -> Client.id
  reps: number; // numero ripetizioni
  timeout: number; // ms
}
