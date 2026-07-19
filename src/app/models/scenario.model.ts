/** Percorso/pagina specifica da misurare su un target. */
export interface Scenario {
  id: string;
  name: string;
  path: string; // es. "/images"
  desc: string;
  tag: string; // etichetta libera
}
