import { Component, computed, DestroyRef, inject, OnInit, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, of } from 'rxjs';
import { LoadingService } from '../../../../core/state/loading.service';
import { Protocol, Result, Scenario, Session, Target } from '../../../../models';
import { ScenarioService } from '../../../scenarios/data/scenario.service';
import { SessionService } from '../../../sessions/data/session.service';
import { TargetService } from '../../../targets/data/target.service';
import { ResultFilters, ResultService } from '../../data/result.service';

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
  private readonly loadingService = inject(LoadingService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = toSignal(this.loadingService.loading$, { initialValue: false });
  protected readonly loaded = signal(false);

  private readonly results = signal<Result[]>([]);
  private readonly scenarios = signal<Scenario[]>([]);
  private readonly sessions = signal<Session[]>([]);
  private readonly targets = signal<Target[]>([]);

  /** Etichetta del Target per id (Result.targetId è un FK diretto e univoco). */
  private readonly targetTagById = computed(() => {
    const map = new Map<string, string>();
    for (const t of this.targets()) {
      map.set(t.id, t.tag);
    }
    return map;
  });

  // ---- filtri ----
  protected readonly scenarioFilter = signal<string>('all');
  protected readonly sessionFilter = signal<string>('all');

  protected readonly scenarioOptions = computed(() => [
    { value: 'all', label: 'Tutti gli scenari' },
    ...this.scenarios().map((s) => ({ value: s.id, label: `${s.name} · ${s.path}` })),
  ]);
  protected readonly sessionOptions = computed(() => [
    { value: 'all', label: 'Tutte le sessioni' },
    ...this.sessions().map((s) => ({ value: s.id, label: s.name })),
  ]);

  private readonly selectedScenario = computed(
    () => this.scenarios().find((s) => s.id === this.scenarioFilter()) ?? null,
  );
  private readonly selectedSession = computed(
    () => this.sessions().find((s) => s.id === this.sessionFilter()) ?? null,
  );

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
   * Il filtro per sessione è applicato lato backend (vedi `reloadResults`):
   * `results` contiene già solo i Result della sessione selezionata, tramite
   * Result.sessionId (riferimento diretto e univoco). Qui resta solo il
   * filtro per scenario, che invece è puramente client-side.
   */
  private readonly filteredResults = computed(() => {
    const scenario = this.selectedScenario();
    return scenario ? this.results().filter((r) => r.scenarioPath === scenario.path) : this.results();
  });

  private readonly completedResults = computed(() =>
    this.filteredResults().filter((r) => r.status === 'completed'),
  );

  protected readonly scopeText = computed(() => {
    const session = this.selectedSession();
    const scenario = this.selectedScenario();
    const parts: string[] = [];
    parts.push(session ? session.name : 'Tutte le sessioni');
    parts.push(scenario ? scenario.path : 'tutti gli scenari');
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

  // ---- tabella misurazioni grezze ----
  protected readonly runRows = computed<RunRow[]>(() => {
    const tagById = this.targetTagById();
    return this.filteredResults().map((r) => {
      const tag = tagById.get(r.targetId) ?? '';
      return {
        result: r,
        hasTag: tag.trim() !== '',
        tagText: tag,
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
  protected readonly runCountText = computed(() => `${this.runRows().length} misurazioni`);

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
    forkJoin({
      results: this.resultService.list().pipe(catchError(() => of<Result[]>([]))),
      scenarios: this.scenarioService.list().pipe(catchError(() => of<Scenario[]>([]))),
      sessions: this.sessionService.list().pipe(catchError(() => of<Session[]>([]))),
      targets: this.targetService.list().pipe(catchError(() => of<Target[]>([]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ results, scenarios, sessions, targets }) => {
        this.results.set(results);
        this.scenarios.set(scenarios);
        this.sessions.set(sessions);
        this.targets.set(targets);
        this.loaded.set(true);
      });
  }

  protected setScenarioFilter(value: string): void {
    this.scenarioFilter.set(value);
  }

  protected setSessionFilter(value: string): void {
    this.sessionFilter.set(value);
    this.reloadResults();
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
    this.resultService
      .list({ sessionId })
      .pipe(
        catchError(() => of<Result[]>([])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => target.set(results));
  }

  /**
   * Ricarica i Result dal backend applicando il filtro per sessione corrente
   * (query param `sessionId`), o senza filtro se è selezionato "Tutte le sessioni".
   */
  private reloadResults(): void {
    const sessionId = this.sessionFilter();
    const filters: ResultFilters | undefined = sessionId === 'all' ? undefined : { sessionId };
    this.resultService
      .list(filters)
      .pipe(
        catchError(() => of<Result[]>([])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((results) => this.results.set(results));
  }

  protected openDetail(result: Result): void {
    this.selectedResult.set(result);
  }

  protected closeDetail(): void {
    this.selectedResult.set(null);
  }

  /**
   * Esporta in .xlsx (client-side, via SheetJS) esattamente i Result
   * attualmente filtrati — la stessa selezione visibile nella tabella grezza
   * (filtro scenario + sessione già applicati a `filteredResults`).
   * SheetJS è caricata on-demand (~300 KB) solo al click, per non appesantire
   * il bundle iniziale con una libreria usata raramente.
   */
  protected async exportExcel(): Promise<void> {
    const XLSX = await import('xlsx');
    const rows = this.filteredResults().map((r) => ({
      Target: r.target,
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
