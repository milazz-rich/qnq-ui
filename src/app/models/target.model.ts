import { Protocol } from './protocol.model';

export type TargetStatus = 'online' | 'idle' | 'offline';

/** Server bersaglio su cui misurare le prestazioni. */
export interface Target {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: Protocol; // HTTP/2 | HTTP/3
  tag: string; // etichetta libera
  status: TargetStatus; // online | idle | offline
}
