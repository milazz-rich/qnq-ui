import { Component, computed, DestroyRef, inject, OnInit, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, of } from 'rxjs';
import { LoadingService } from '../../../../core/state/loading.service';
import { Client, Protocol, Result, Scenario, Session, Target } from '../../../../models';
import { ClientService } from '../../../clients/data/client.service';
import { ScenarioService } from '../../../scenarios/data/scenario.service';
import { SessionService } from '../../../sessions/data/session.service';
import { TargetService } from '../../../targets/data/target.service';
import { ResultFilters, ResultPage, ResultService } from '../../data/result.service';

/** Riga di confronto H2 vs H3 per una singola metrica aggregata. */
interface CompareRow {
  label: string;
  h2Text: string;
  h3Text: string;
  h2Winner: boolean;
  h3Winner: boolean;
  winnerLabel: string;
  deltaText: string;
  badgeClass: string;
}

/** Barra del grafico a barre: un server, valore medio colorato per protocollo. */
interface ServerBar {
  name: string;
  valueText: string;
  heightPct: number;
  colorVar: string;
}

/** Barra del confronto tra sessioni: una sessione × un protocollo. */
interface CompareBar {
  name: string;
  protoLabel: Protocol;
  valueText: string;
  heightPct: number;
  colorVar: string;
}

/** Gruppo di barre per una singola metrica nel confronto tra due sessioni. */
interface CompareMetric {
  label: string;
  bars: CompareBar[];
}

/** Riga della tabella delle misurazioni grezze. */
interface RunRow {
  result: Result;
  hasTag: boolean;
  tagText: string;
  clientLabel: string;
  protoLabel: string;
  protoClass: string;
  totalText: string;
  ttfbText: string;
  kbText: string;
  statusLabel: string;
  statusClass: string;
}

/** Riga del drawer di dettaglio di una singola misurazione. */
interface DetailRow {
  label: string;
  value: string;
  colorClass: string;
}

const H2_COLOR = 'var(--accent)';
const H3_COLOR = 'var(--warn)';

/** Righe per pagina richieste al backend per la tabella delle misurazioni grezze. */
const PAGE_SIZE = 25;

/**
 * Sezione "Risultati": confronto aggregato HTTP/2 vs HTTP/3, filtri per
 * scenario e sessione, grafici di andamento/confronto e tabella grezza con
 * drawer di dettaglio. Tutti i dati derivano da ResultService: nessun valore
 * simulato o hardcoded.
 */
@Component({
  selector: 'app-results',
  imports: [],
  templateUrl: './results.html',
  styleUrl: './results.css',
})
export class Results implements OnInit {
  private readonly resultService = inject(ResultService);
  private readonly scenarioService = inject(ScenarioService);
  private readonly sessionService = inject(SessionService);
  private readonly targetService = inject(TargetService);
  private readonly clientService = inject(ClientService);
  private readonly loadingService = inject(LoadingService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = toSignal(this.loadingService.loading$, { initialValue: false });
  protected readonly loaded = signal(false);

  /**
   * Insieme **completo** dei Result che soddisfano i filtri correnti (nessuna
   * paginazione): alimenta gli aggregati (confronto protocolli, grafici) e
   * l'export Excel, che devono ragionare su tutti i dati, non sulla pagina.
   */
  private readonly results = signal<Result[]>([]);
  /** Sola pagina corrente, richiesta al backend: alimenta la tabella grezza. */
  private readonly pageResults = signal<Result[]>([]);
  private readonly scenarios = signal<Scenario[]>([]);
  private readonly sessions = signal<Session[]>([]);
  private readonly targets = signal<Target[]>([]);
  private readonly clients = signal<Client[]>([]);

  /** Etichetta del Target per id (Result.targetId è un FK diretto e univoco). */
  private readonly targetTagById = computed(() => {
    const map = new Map<string, string>();
    for (const t of this.targets()) {
      map.set(t.id, t.tag);
    }
    return map;
  });

  /** Nome del Client per id (Result.clientId è un FK diretto e univoco). */
  private readonly clientNameById = computed(() => {
    const map = new Map<string, string>();
    for (const c of this.clients()) {
      map.set(c.id, c.name);
    }
    return map;
  });

  // ---- filtri ----
  protected readonly scenarioFilter = signal<string>('all');
  protected readonly sessionFilter = signal<string>('all');
  protected readonly clientFilter = signal<string>('all');

  protected readonly scenarioOptions = computed(() => [
    { value: 'all', label: 'Tutti gli scenari' },
    ...this.scenarios().map((s) => ({ value: s.id, label: `${s.name} · ${s.path}` })),
  ]);
  protected readonly sessionOptions = computed(() => [
    { value: 'all', label: 'Tutte le sessioni' },
    ...this.sessions().map((s) => ({ value: s.id, label: s.name })),
  ]);
  protected readonly clientOptions = computed(() => [
    { value: 'all', label: 'Tutti i client' },
    ...this.clients().map((c) => ({ value: c.id, label: c.name })),
  ]);

  private readonly selectedScenario = computed(
    () => this.scenarios().find((s) => s.id === this.scenarioFilter()) ?? null,
  );
  private readonly selectedSession = computed(
    () => this.sessions().find((s) => s.id === this.sessionFilter()) ?? null,
  );

  // ---- paginazione (server-side) della tabella grezza ----
  protected readonly page = signal(1);
  /** Totale dei Result che soddisfano i filtri, restituito dal backend. */
  private readonly total = signal(0);
  protected readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / PAGE_SIZE)),
  );
  protected readonly paginationText = computed(
    () => `Pagina ${this.page()} di ${this.totalPages()}`,
  );
  protected readonly canPrevPage = computed(() => this.page() > 1);
  protected readonly canNextPage = computed(() => this.page() < this.totalPages());

  // ---- confronto tra due sessioni (grafico dedicato) ----
  protected readonly compareSessionA = signal<string>('');
  protected readonly compareSessionB = signal<string>('');
  // Result delle due sessioni scelte, caricati separatamente dai filtri in cima
  // (via sessionId): null = nessuna sessione selezionata / caricamento in corso.
  private readonly compareResultsA = signal<Result[] | null>(null);
  private readonly compareResultsB = signal<Result[] | null>(null);

  protected readonly compareSessionOptions = computed(() => [
    { value: '', label: 'Seleziona sessione' },
    ...this.sessions().map((s) => ({ value: s.id, label: s.name })),
  ]);

  /**
   * Tutti i filtri (sessione, scenario, client) sono applicati **lato backend**
   * in `reloadResults`: è indispensabile con la paginazione server-side, perché
   * un filtro client-side sulla sola pagina corrente falserebbe sia le righe
   * mostrate sia il `total` usato per contare le pagine. Qui quindi non resta
   * alcun filtro da applicare: `results` è già l'insieme filtrato completo.
   */
  private readonly filteredResults = computed(() => this.results());

  private readonly completedResults = computed(() =>
    this.filteredResults().filter((r) => r.status === 'completed'),
  );

  protected readonly scopeText = computed(() => {
    const session = this.selectedSession();
    const scenario = this.selectedScenario();
    const client = this.clients().find((c) => c.id === this.clientFilter()) ?? null;
    const parts: string[] = [];
    parts.push(session ? session.name : 'Tutte le sessioni');
    parts.push(scenario ? scenario.path : 'tutti gli scenari');
    if (client) {
      parts.push(client.name);
    }
    return parts.join(' · ');
  });

  // ---- confronto HTTP/2 vs HTTP/3 ----
  protected readonly hasCompare = computed(() => {
    const done = this.completedResults();
    return (
      done.some((r) => r.actualProto === 'HTTP/2') && done.some((r) => r.actualProto === 'HTTP/3')
    );
  });

  protected readonly compareRows = computed<CompareRow[]>(() => {
    if (!this.hasCompare()) {
      return [];
    }
    const done = this.completedResults();
    const h2 = done.filter((r) => r.actualProto === 'HTTP/2');
    const h3 = done.filter((r) => r.actualProto === 'HTTP/3');
    const ms = (v: number) => `${v.toFixed(3)} ms`;
    const kb = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(3)} MB` : `${v.toFixed(3)} KB`);
    return [
      this.buildCompareRow('Tempo totale di risposta medio', this.mean(h2, 'total'), this.mean(h3, 'total'), ms),
      this.buildCompareRow('Time to First Byte medio', this.mean(h2, 'ttfb'), this.mean(h3, 'ttfb'), ms),
      this.buildCompareRow('Dati trasferiti medi', this.mean(h2, 'kb'), this.mean(h3, 'kb'), kb),
    ];
  });

  protected readonly overallWinner = computed<'HTTP/2' | 'HTTP/3' | 'tie'>(() => {
    const rows = this.compareRows();
    const h3wins = rows.filter((r) => /HTTP\/3/.test(r.winnerLabel)).length;
    const h2wins = rows.filter((r) => /HTTP\/2/.test(r.winnerLabel)).length;
    if (h3wins > h2wins) return 'HTTP/3';
    if (h2wins > h3wins) return 'HTTP/2';
    return 'tie';
  });

  protected readonly overallText = computed(() => {
    const rows = this.compareRows();
    const winner = this.overallWinner();
    if (winner === 'tie' || rows.length === 0) {
      return 'Prestazioni equivalenti';
    }
    const wins = rows.filter((r) => r.winnerLabel.startsWith(winner)).length;
    return `${winner} vince ${wins}/${rows.length} metriche`;
  });

  protected readonly overallBadgeClass = computed(() => this.protoTintClass(this.overallWinner()));

  // ---- confronto tra due sessioni: barre affiancate per metrica ----
  /**
   * Costruisce, per ogni metrica principale (tempo totale, TTFB), una barra per
   * ciascuna combinazione sessione × protocollo con misurazioni completate.
   * Vuoto finché entrambe le sessioni non sono selezionate e caricate.
   */
  protected readonly sessCompareMetrics = computed<CompareMetric[]>(() => {
    const a = this.compareResultsA();
    const b = this.compareResultsB();
    const sessA = this.sessions().find((s) => s.id === this.compareSessionA()) ?? null;
    const sessB = this.sessions().find((s) => s.id === this.compareSessionB()) ?? null;
    if (!a || !b || !sessA || !sessB) {
      return [];
    }
    const slots = [
      { session: sessA, results: a.filter((r) => r.status === 'completed') },
      { session: sessB, results: b.filter((r) => r.status === 'completed') },
    ];
    const protos: Protocol[] = ['HTTP/2', 'HTTP/3'];
    const metrics: { key: 'total' | 'ttfb'; label: string }[] = [
      { key: 'total', label: 'Tempo totale medio (ms)' },
      { key: 'ttfb', label: 'TTFB medio (ms)' },
    ];
    return metrics.map(({ key, label }) => {
      const raw = slots.flatMap((slot) =>
        protos
          .map((proto) => {
            const vals = slot.results
              .filter((r) => r.actualProto === proto)
              .map((r) => r[key]);
            if (vals.length === 0) {
              return null;
            }
            return { name: slot.session.name, proto, value: this.average(vals) };
          })
          .filter((x): x is { name: string; proto: Protocol; value: number } => x !== null),
      );
      const top = raw.length
        ? Math.ceil(Math.max(...raw.map((r) => r.value)) / 10) * 10 + 10
        : 10;
      const bars: CompareBar[] = raw.map((r) => ({
        name: r.name,
        protoLabel: r.proto,
        valueText: `${r.value.toFixed(3)} ms`,
        heightPct: Math.max(4, (r.value / top) * 100),
        colorVar: r.proto === 'HTTP/3' ? H3_COLOR : H2_COLOR,
      }));
      return { label, bars };
    });
  });

  protected readonly sessCompareReady = computed(() =>
    this.sessCompareMetrics().some((m) => m.bars.length > 0),
  );
  /** Messaggio dello stato vuoto: nessuna scelta vs sessioni senza misurazioni. */
  protected readonly sessCompareMessage = computed(() =>
    !this.compareSessionA() || !this.compareSessionB()
      ? 'Scegli due sessioni da confrontare.'
      : 'Nessuna misurazione disponibile per una delle sessioni selezionate.',
  );

  // ---- grafico a barre: tempo medio per server ----
  /**
   * Una barra per server (target) tra i Result filtrati, con il tempo totale
   * medio; il colore riflette il protocollo prevalente delle sue misurazioni.
   */
  protected readonly serverBars = computed<ServerBar[] | null>(() => {
    const done = this.completedResults();
    if (done.length === 0) {
      return null;
    }
    const names = Array.from(new Set(done.map((r) => r.target)));
    const raw = names.map((name) => {
      const rs = done.filter((r) => r.target === name);
      const h3 = rs.filter((r) => r.actualProto === 'HTTP/3').length;
      const proto: Protocol = h3 * 2 >= rs.length ? 'HTTP/3' : 'HTTP/2';
      return { name, value: this.average(rs.map((r) => r.total)), proto };
    });
    const top = Math.ceil(Math.max(...raw.map((r) => r.value)) / 50) * 50 + 50;
    return raw.map((r) => ({
      name: r.name,
      valueText: `${r.value.toFixed(3)} ms`,
      heightPct: Math.max(4, (r.value / top) * 100),
      colorVar: r.proto === 'HTTP/3' ? H3_COLOR : H2_COLOR,
    }));
  });

  // ---- tabella misurazioni grezze (solo la pagina corrente) ----
  protected readonly runRows = computed<RunRow[]>(() => {
    const tagById = this.targetTagById();
    const clientById = this.clientNameById();
    return this.pageResults().map((r) => {
      const tag = tagById.get(r.targetId) ?? '';
      return {
        result: r,
        hasTag: tag.trim() !== '',
        tagText: tag,
        clientLabel: clientById.get(r.clientId) ?? '—',
        protoLabel: r.proto,
        protoClass: this.protoTintClass(r.proto),
        totalText: r.status === 'completed' ? `${r.total.toFixed(3)} ms` : '—',
        ttfbText: r.status === 'completed' ? `${r.ttfb.toFixed(3)} ms` : '—',
        kbText: r.status === 'completed' ? this.formatKb(r.kb) : '—',
        statusLabel: r.status === 'completed' ? 'Completato' : 'Fallito',
        statusClass:
          r.status === 'completed'
            ? 'bg-[var(--ok-soft)] text-[var(--ok)]'
            : 'bg-[var(--danger-soft)] text-[var(--danger)]',
      };
    });
  });
  /** Conteggio complessivo (dal backend), non della sola pagina mostrata. */
  protected readonly runCountText = computed(() => `${this.total()} misurazioni`);

  // ---- drawer di dettaglio ----
  private readonly selectedResult = signal<Result | null>(null);
  protected readonly detailOpen = computed(() => this.selectedResult() !== null);
  protected readonly detailTitle = computed(() => this.selectedResult()?.target ?? '');
  protected readonly detailSub = computed(() => this.selectedResult()?.scenarioPath ?? '');
  protected readonly detailRows = computed<DetailRow[]>(() => {
    const r = this.selectedResult();
    if (!r) {
      return [];
    }
    const fell = r.actualProto !== r.proto;
    return [
      { label: 'Scenario', value: r.scenarioPath, colorClass: 'text-[var(--text-muted)]' },
      {
        label: 'Stato',
        value: r.status === 'failed' ? 'Fallito (timeout)' : 'Completato',
        colorClass: r.status === 'failed' ? 'text-[var(--danger)]' : 'text-[var(--ok)]',
      },
      {
        label: 'Tempo totale di risposta',
        value: r.status === 'completed' ? `${r.total.toFixed(3)} ms` : '—',
        colorClass: 'text-[var(--text)]',
      },
      {
        label: 'Time to First Byte',
        value: r.status === 'completed' ? `${r.ttfb.toFixed(3)} ms` : '—',
        colorClass: 'text-[var(--text)]',
      },
      {
        label: 'Dati trasferiti',
        value: r.status === 'completed' ? this.formatKb(r.kb) : '—',
        colorClass: 'text-[var(--text)]',
      },
      { label: 'Protocollo richiesto', value: r.proto, colorClass: 'text-[var(--text-muted)]' },
      {
        label: 'Protocollo realmente usato',
        value: r.actualProto,
        colorClass: fell ? 'text-[var(--warn)]' : 'text-[var(--text-muted)]',
      },
    ];
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    const filters = this.currentFilters();
    forkJoin({
      page: this.pageRequest(filters, 1),
      all: this.allRequest(filters),
      scenarios: this.scenarioService.list().pipe(catchError(() => of<Scenario[]>([]))),
      sessions: this.sessionService.list().pipe(catchError(() => of<Session[]>([]))),
      targets: this.targetService.list().pipe(catchError(() => of<Target[]>([]))),
      clients: this.clientService.list().pipe(catchError(() => of<Client[]>([]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ page, all, scenarios, sessions, targets, clients }) => {
        this.applyPage(page);
        this.results.set(all);
        this.scenarios.set(scenarios);
        this.sessions.set(sessions);
        this.targets.set(targets);
        this.clients.set(clients);
        this.loaded.set(true);
      });
  }

  protected setScenarioFilter(value: string): void {
    this.scenarioFilter.set(value);
    this.onFiltersChanged();
  }

  protected setSessionFilter(value: string): void {
    this.sessionFilter.set(value);
    this.onFiltersChanged();
  }

  protected setClientFilter(value: string): void {
    this.clientFilter.set(value);
    this.onFiltersChanged();
  }

  // ---- paginazione ----
  protected prevPage(): void {
    if (!this.canPrevPage()) {
      return;
    }
    this.page.update((p) => p - 1);
    this.reloadPage();
  }

  protected nextPage(): void {
    if (!this.canNextPage()) {
      return;
    }
    this.page.update((p) => p + 1);
    this.reloadPage();
  }

  protected setCompareSessionA(value: string): void {
    this.compareSessionA.set(value);
    this.loadCompareResults(value, this.compareResultsA);
  }

  protected setCompareSessionB(value: string): void {
    this.compareSessionB.set(value);
    this.loadCompareResults(value, this.compareResultsB);
  }

  /**
   * Carica i Result della sessione scelta per il grafico di confronto, tramite
   * il filtro `sessionId` del backend, indipendentemente dai filtri in cima.
   * Con id vuoto (nessuna scelta) azzera il relativo insieme.
   */
  private loadCompareResults(sessionId: string, target: WritableSignal<Result[] | null>): void {
    if (!sessionId) {
      target.set(null);
      return;
    }
    target.set(null);
    // listAll: il confronto media tutte le misure della sessione, non le prime 200.
    this.resultService
      .listAll({ sessionId })
      .pipe(
        catchError(() => of<Result[]>([])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => target.set(results));
  }

  /** Filtri correnti tradotti in query param per il backend ("all" = nessun filtro). */
  private currentFilters(): ResultFilters {
    const filters: ResultFilters = {};
    const sessionId = this.sessionFilter();
    const clientId = this.clientFilter();
    const scenario = this.selectedScenario();
    if (sessionId !== 'all') {
      filters.sessionId = sessionId;
    }
    if (clientId !== 'all') {
      filters.clientId = clientId;
    }
    if (scenario) {
      filters.scenarioPath = scenario.path;
    }
    return filters;
  }

  /** Richiesta della sola pagina indicata (tabella grezza). */
  private pageRequest(filters: ResultFilters, page: number) {
    return this.resultService
      .list({ ...filters, page, pageSize: PAGE_SIZE })
      .pipe(catchError(() => of<ResultPage>({ items: [], total: 0, page, pageSize: PAGE_SIZE })));
  }

  /**
   * Richiesta dell'insieme completo filtrato (aggregati/grafici ed export).
   * Usa `listAll`, che ricompone tutte le pagine: il backend limita `pageSize`
   * a 200, quindi una singola richiesta non basta a coprire l'intero dataset.
   */
  private allRequest(filters: ResultFilters) {
    return this.resultService.listAll(filters).pipe(catchError(() => of<Result[]>([])));
  }

  private applyPage(page: ResultPage): void {
    this.pageResults.set(page.items);
    this.total.set(page.total);
  }

  /**
   * Un cambio di filtro riparte sempre da pagina 1 e ricarica entrambi gli
   * insiemi: la pagina corrente (tabella) e il set completo (aggregati/export).
   */
  private onFiltersChanged(): void {
    this.page.set(1);
    const filters = this.currentFilters();
    forkJoin({
      page: this.pageRequest(filters, 1),
      all: this.allRequest(filters),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ page, all }) => {
        this.applyPage(page);
        this.results.set(all);
      });
  }

  /**
   * Cambio di pagina: ricarica solo la pagina richiesta. Gli aggregati non
   * dipendono dalla paginazione, quindi il set completo resta invariato.
   */
  private reloadPage(): void {
    this.pageRequest(this.currentFilters(), this.page())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((page) => this.applyPage(page));
  }

  protected openDetail(result: Result): void {
    this.selectedResult.set(result);
  }

  protected closeDetail(): void {
    this.selectedResult.set(null);
  }

  /**
   * Esporta in .xlsx (client-side, via SheetJS) **tutti** i Result che
   * soddisfano i filtri correnti (sessione, scenario, client), non la sola
   * pagina visibile in tabella: l'export usa `filteredResults`, cioè l'insieme
   * completo caricato per gli aggregati.
   * SheetJS è caricata on-demand (~300 KB) solo al click, per non appesantire
   * il bundle iniziale con una libreria usata raramente.
   */
  protected async exportExcel(): Promise<void> {
    const XLSX = await import('xlsx');
    const clientById = this.clientNameById();
    const rows = this.filteredResults().map((r) => ({
      Target: r.target,
      Client: clientById.get(r.clientId) ?? '',
      Scenario: r.scenarioPath,
      'Protocollo richiesto': r.proto,
      'Protocollo effettivo': r.actualProto,
      'Tempo totale (ms)': r.status === 'completed' ? Number(r.total.toFixed(3)) : null,
      'TTFB (ms)': r.status === 'completed' ? Number(r.ttfb.toFixed(3)) : null,
      'Dati trasferiti (KB)': r.status === 'completed' ? Number(r.kb.toFixed(3)) : null,
      Stato: r.status === 'completed' ? 'Completato' : 'Fallito',
      Timestamp: r.time,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Risultati');
    XLSX.writeFile(workbook, `risultati-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  /**
   * Media di una metrica su un insieme di Result, a piena precisione: la
   * riduzione a 3 decimali avviene solo in visualizzazione (vedi `ms`/`kb` in
   * `compareRows`), mai su questo valore intermedio.
   */
  private mean(list: Result[], key: 'total' | 'ttfb' | 'kb'): number {
    if (list.length === 0) return 0;
    return list.reduce((sum, r) => sum + r[key], 0) / list.length;
  }

  /** Media a piena precisione di un elenco di valori numerici (0 se vuoto). */
  private average(vals: number[]): number {
    if (vals.length === 0) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  /** Formatta un valore in KB a 3 decimali, convertendo in MB oltre 1024 KB. */
  private formatKb(kb: number): string {
    return kb >= 1024 ? `${(kb / 1024).toFixed(3)} MB` : `${kb.toFixed(3)} KB`;
  }

  private buildCompareRow(
    label: string,
    h2: number,
    h3: number,
    fmt: (v: number) => string,
  ): CompareRow {
    const tie = h2 === h3;
    const h3Better = h3 < h2;
    const winner = tie ? 'Pari' : h3Better ? 'HTTP/3' : 'HTTP/2';
    const diff = h2 === 0 ? 0 : (Math.abs(h3 - h2) / h2) * 100;
    return {
      label,
      h2Text: fmt(h2),
      h3Text: fmt(h3),
      h2Winner: !tie && !h3Better,
      h3Winner: !tie && h3Better,
      winnerLabel: tie ? 'Pari' : `${winner} più veloce`,
      deltaText: diff < 0.5 ? '≈ pari' : `−${diff.toFixed(0)}%`,
      badgeClass: this.protoTintClass(tie ? 'tie' : (winner as Protocol)),
    };
  }

  private protoTintClass(proto: Protocol | 'tie'): string {
    if (proto === 'HTTP/3') return 'bg-[var(--warn-soft)] text-[var(--warn)]';
    if (proto === 'HTTP/2') return 'bg-[var(--accent-soft)] text-[var(--accent)]';
    return 'bg-[var(--bg-2)] text-[var(--text-faint)]';
  }
}
