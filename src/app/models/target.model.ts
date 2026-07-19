import { Protocol } from './protocol.model';

export type TargetStatus = 'online' | 'idle' | 'offline';

/** Server bersaglio su cui misurare le prestazioni. */
export interface Target {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: Protocol; // HTTP/2 | HTTP/3
  maxc: number; // max connessioni concorrenti
  status: TargetStatus; // online | idle | offline
  latency: number; // ms
}
