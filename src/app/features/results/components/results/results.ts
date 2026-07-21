import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, of } from 'rxjs';
import { LoadingService } from '../../../../core/state/loading.service';
import { Protocol, Result, Scenario, Session } from '../../../../models';
import { ScenarioService } from '../../../scenarios/data/scenario.service';
import { SessionService } from '../../../sessions/data/session.service';
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

/** Punto del grafico a linee: un giorno, un valore medio per protocollo. */
interface LineSeries {
  proto: Protocol;
  colorVar: string;
  points: string;
}

/** Barra del grafico a barre: uno scenario, un valore medio per protocollo. */
interface BarGroup {
  scenarioPath: string;
  h2: { valueText: string; heightPct: number } | null;
  h3: { valueText: string; heightPct: number } | null;
}

/** Riga della tabella delle misurazioni grezze. */
interface RunRow {
  result: Result;
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
  private readonly loadingService = inject(LoadingService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = toSignal(this.loadingService.loading$, { initialValue: false });
  protected readonly loaded = signal(false);

  private readonly results = signal<Result[]>([]);
  private readonly scenarios = signal<Scenario[]>([]);
  private readonly sessions = signal<Session[]>([]);

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
    const ms = (v: number) => `${v} ms`;
    const kb = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(2)} MB` : `${v} KB`);
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

  // ---- grafico a linee: andamento nel tempo per protocollo ----
  protected readonly lineChart = computed(() => {
    const done = this.completedResults();
    const dayOf = (r: Result) => {
      const d = new Date(r.time);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    };
    const days = Array.from(new Set(done.map(dayOf).filter((d): d is string => !!d))).sort();
    if (days.length === 0) {
      return null;
    }
    const W = 680;
    const H = 220;
    const padX = 8;
    const padTop = 10;
    const padBot = 10;
    const plotH = H - padTop - padBot;
    const xAt = (i: number) => (days.length === 1 ? W / 2 : padX + (i * (W - padX * 2)) / (days.length - 1));

    const seriesFor = (proto: Protocol): LineSeries | null => {
      const byDay = days.map((day) => {
        const vals = done.filter((r) => r.actualProto === proto && dayOf(r) === day).map((r) => r.total);
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      });
      const known = byDay.filter((v): v is number => v !== null);
      if (known.length === 0) {
        return null;
      }
      const top = Math.ceil(Math.max(...known) / 10) * 10 + 10;
      const yAt = (v: number) => padTop + plotH - (v / top) * plotH;
      const points = byDay
        .map((v, i) => (v === null ? null : `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`))
        .filter((p): p is string => p !== null)
        .join(' ');
      return { proto, colorVar: proto === 'HTTP/3' ? H3_COLOR : H2_COLOR, points };
    };

    const series = (['HTTP/2', 'HTTP/3'] as Protocol[])
      .map(seriesFor)
      .filter((s): s is LineSeries => !!s);
    if (series.length === 0) {
      return null;
    }

    const allValues = done.map((r) => r.total);
    const top = Math.ceil(Math.max(...allValues) / 10) * 10 + 10;
    const yTicks = Array.from({ length: 5 }, (_, i) => {
      const v = Math.round((top * (4 - i)) / 4);
      return { label: String(v), topPct: ((padTop + (plotH * i) / 4) / H) * 100 };
    });
    const gridLines = Array.from({ length: 5 }, (_, i) => padTop + (plotH * i) / 4);
    const xLabels = days.map((d) => {
      const dt = new Date(d);
      return `${dt.getDate()}/${dt.getMonth() + 1}`;
    });

    return { series, yTicks, gridLines, xLabels, viewBox: `0 0 ${W} ${H}` };
  });

  // ---- grafico a barre: confronto tra scenari ----
  protected readonly barChart = computed(() => {
    const done = this.completedResults();
    if (done.length === 0) {
      return null;
    }
    const scenarioPaths = Array.from(new Set(done.map((r) => r.scenarioPath))).sort();
    const meanFor = (path: string, proto: Protocol) => {
      const vals = done.filter((r) => r.scenarioPath === path && r.actualProto === proto).map((r) => r.total);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };
    const raw = scenarioPaths.map((path) => ({
      path,
      h2: meanFor(path, 'HTTP/2'),
      h3: meanFor(path, 'HTTP/3'),
    }));
    const top = Math.ceil(Math.max(...raw.flatMap((r) => [r.h2 ?? 0, r.h3 ?? 0])) / 50) * 50 + 50;
    const bars: BarGroup[] = raw.map((r) => ({
      scenarioPath: r.path,
      h2: r.h2 === null ? null : { valueText: `${r.h2} ms`, heightPct: Math.max(4, (r.h2 / top) * 100) },
      h3: r.h3 === null ? null : { valueText: `${r.h3} ms`, heightPct: Math.max(4, (r.h3 / top) * 100) },
    }));
    return bars;
  });

  // ---- tabella misurazioni grezze ----
  protected readonly runRows = computed<RunRow[]>(() =>
    this.filteredResults().map((r) => ({
      result: r,
      protoLabel: r.proto,
      protoClass: this.protoTintClass(r.proto),
      totalText: r.status === 'completed' ? `${r.total} ms` : '—',
      ttfbText: r.status === 'completed' ? `${r.ttfb} ms` : '—',
      kbText: r.status === 'completed' ? this.formatKb(r.kb) : '—',
      statusLabel: r.status === 'completed' ? 'Completato' : 'Fallito',
      statusClass:
        r.status === 'completed'
          ? 'bg-[var(--ok-soft)] text-[var(--ok)]'
          : 'bg-[var(--danger-soft)] text-[var(--danger)]',
    })),
  );
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
        value: r.status === 'completed' ? `${r.total} ms` : '—',
        colorClass: 'text-[var(--text)]',
      },
      {
        label: 'Time to First Byte',
        value: r.status === 'completed' ? `${r.ttfb} ms` : '—',
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
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ results, scenarios, sessions }) => {
        this.results.set(results);
        this.scenarios.set(scenarios);
        this.sessions.set(sessions);
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

  private mean(list: Result[], key: 'total' | 'ttfb' | 'kb'): number {
    if (list.length === 0) return 0;
    return Math.round(list.reduce((sum, r) => sum + r[key], 0) / list.length);
  }

  private formatKb(kb: number): string {
    return kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb} KB`;
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
