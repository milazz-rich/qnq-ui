import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { LoadingService } from '../../../../core/state/loading.service';
import { Client, Result, Scenario, Session, Target } from '../../../../models';
import { ClientService } from '../../../clients/data/client.service';
import { ResultService } from '../../../results/data/result.service';
import { ScenarioService } from '../../../scenarios/data/scenario.service';
import { SessionService } from '../../../sessions/data/session.service';
import { TargetService } from '../../../targets/data/target.service';

/** Riga di confronto HTTP/2 vs HTTP/3 per una singola metrica. */
interface CompareRow {
  label: string;
  h2Text: string;
  h3Text: string;
  h2Winner: boolean;
  h3Winner: boolean;
  deltaText: string;
  winner: 'HTTP/2' | 'HTTP/3' | 'tie';
}

/** Riga sintetica di una sessione recente per la dashboard. */
interface RecentSessionRow {
  id: string;
  name: string;
  statusLabel: string;
  badgeClass: string;
  dotClass: string;
  metaText: string;
  running: boolean;
  pct: number;
}

/** Pagina Dashboard: panoramica del banco di prova, dati da service reali. */
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  /** Passi (statici) del flusso di creazione di una sessione. */
  protected readonly quickFlow = [
    { n: 1, label: 'Server' },
    { n: 2, label: 'Scenari' },
    { n: 3, label: 'Configurazione' },
    { n: 4, label: 'Sessione' },
  ];

  private readonly targetService = inject(TargetService);
  private readonly scenarioService = inject(ScenarioService);
  private readonly clientService = inject(ClientService);
  private readonly sessionService = inject(SessionService);
  private readonly resultService = inject(ResultService);
  private readonly loadingService = inject(LoadingService);
  private readonly destroyRef = inject(DestroyRef);

  /** Stato di caricamento globale (osservabile via LoadingService). */
  protected readonly loading = toSignal(this.loadingService.loading$, { initialValue: false });
  /** true dopo il primo caricamento completato (successo o fallback vuoto). */
  protected readonly loaded = signal(false);

  private readonly targets = signal<Target[]>([]);
  private readonly scenarios = signal<Scenario[]>([]);
  private readonly clients = signal<Client[]>([]);
  private readonly sessions = signal<Session[]>([]);
  private readonly results = signal<Result[]>([]);

  /** Sottotitolo con la data odierna in italiano. */
  protected readonly todayLabel = computed(() => {
    const formatted = new Intl.DateTimeFormat('it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date());
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  });

  // ---- card entità ----
  protected readonly serverCount = computed(() => this.targets().length);
  protected readonly onlineCount = computed(
    () => this.targets().filter((t) => t.status === 'online').length,
  );
  protected readonly idleCount = computed(
    () => this.targets().filter((t) => t.status === 'idle').length,
  );
  protected readonly offlineCount = computed(
    () => this.targets().filter((t) => t.status === 'offline').length,
  );

  protected readonly scenarioCount = computed(() => this.scenarios().length);
  protected readonly scenarioTagCount = computed(
    () => new Set(this.scenarios().map((s) => s.tag).filter((tag) => tag.trim() !== '')).size,
  );

  /** Unico client supportato dal backend, mostrato in sola lettura. */
  protected readonly client = computed(() => this.clients()[0] ?? null);

  // ---- sessioni recenti ----
  protected readonly recentSessions = computed<RecentSessionRow[]>(() =>
    this.sessions()
      .slice(0, 5)
      .map((session) => {
        const meta = this.sessionStatusMeta(session.status);
        const total = session.items.reduce((sum, i) => sum + i.total, 0);
        // "failed" è un esito risolto (il backend non riproverà l'item): conta
        // per intero ai fini dell'avanzamento, come un item completato.
        const done = session.items.reduce(
          (sum, i) => sum + (i.status === 'failed' ? i.total : i.done),
          0,
        );
        return {
          id: session.id,
          name: session.name,
          statusLabel: meta.label,
          badgeClass: meta.badgeClass,
          dotClass: meta.dotClass,
          metaText: `${session.items.length} test · ${session.when}`,
          running: session.status === 'running',
          pct: total > 0 ? Math.round((done / total) * 100) : 0,
        };
      }),
  );

  protected readonly hasSessions = computed(() => this.sessions().length > 0);

  // ---- confronto HTTP/2 vs HTTP/3 (dai Result reali) ----
  private readonly completedResults = computed(() =>
    this.results().filter((r) => r.status === 'completed'),
  );

  protected readonly hasCompare = computed(() => {
    const done = this.completedResults();
    const h2 = done.some((r) => r.actualProto === 'HTTP/2');
    const h3 = done.some((r) => r.actualProto === 'HTTP/3');
    return h2 && h3;
  });

  protected readonly compareRows = computed<CompareRow[]>(() => {
    const done = this.completedResults();
    const h2 = done.filter((r) => r.actualProto === 'HTTP/2');
    const h3 = done.filter((r) => r.actualProto === 'HTTP/3');
    if (h2.length === 0 || h3.length === 0) {
      return [];
    }
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
    const h3wins = rows.filter((r) => r.winner === 'HTTP/3').length;
    const h2wins = rows.filter((r) => r.winner === 'HTTP/2').length;
    if (h3wins > h2wins) return 'HTTP/3';
    if (h2wins > h3wins) return 'HTTP/2';
    return 'tie';
  });

  protected readonly overallText = computed(() => {
    const rows = this.compareRows();
    const winner = this.overallWinner();
    if (winner === 'tie') {
      return 'Prestazioni equivalenti';
    }
    const wins = rows.filter((r) => r.winner === winner).length;
    return `${winner} vince ${wins}/${rows.length} metriche`;
  });

  ngOnInit(): void {
    this.load();
  }

  /** Carica in parallelo tutte le entità della dashboard dai service reali. */
  private load(): void {
    forkJoin({
      targets: this.targetService.list().pipe(catchError(() => of<Target[]>([]))),
      scenarios: this.scenarioService.list().pipe(catchError(() => of<Scenario[]>([]))),
      clients: this.clientService.list().pipe(catchError(() => of<Client[]>([]))),
      sessions: this.sessionService.list().pipe(catchError(() => of<Session[]>([]))),
      results: this.resultService.list().pipe(catchError(() => of<Result[]>([]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ targets, scenarios, clients, sessions, results }) => {
        this.targets.set(targets);
        this.scenarios.set(scenarios);
        this.clients.set(clients);
        this.sessions.set(sessions);
        this.results.set(results);
        this.loaded.set(true);
      });
  }

  /** Media intera di una metrica numerica su un insieme di Result. */
  private mean(list: Result[], key: 'total' | 'ttfb' | 'kb'): number {
    if (list.length === 0) return 0;
    return Math.round(list.reduce((sum, r) => sum + r[key], 0) / list.length);
  }

  /** Costruisce una riga di confronto con vincitore e delta percentuale. */
  private buildCompareRow(
    label: string,
    h2: number,
    h3: number,
    fmt: (v: number) => string,
  ): CompareRow {
    const tie = h2 === h3;
    const h3Better = h3 < h2;
    const winner: CompareRow['winner'] = tie ? 'tie' : h3Better ? 'HTTP/3' : 'HTTP/2';
    const diff = h2 === 0 ? 0 : (Math.abs(h3 - h2) / h2) * 100;
    return {
      label,
      h2Text: fmt(h2),
      h3Text: fmt(h3),
      h2Winner: !tie && !h3Better,
      h3Winner: !tie && h3Better,
      deltaText: diff < 0.5 ? '≈ pari' : `−${diff.toFixed(0)}%`,
      winner,
    };
  }

  /** Classi di stile (badge/dot/label) per lo stato di una sessione. */
  private sessionStatusMeta(status: Session['status']): {
    label: string;
    badgeClass: string;
    dotClass: string;
  } {
    switch (status) {
      case 'completed':
        return {
          label: 'Completato',
          badgeClass: 'bg-[var(--ok-soft)] text-[var(--ok)]',
          dotClass: 'bg-[var(--ok)]',
        };
      case 'running':
        return {
          label: 'In corso',
          badgeClass: 'bg-[var(--accent-soft)] text-[var(--accent)]',
          dotClass: 'bg-[var(--accent)]',
        };
      default:
        return {
          label: 'In attesa',
          badgeClass: 'bg-[var(--bg-2)] text-[var(--text-faint)]',
          dotClass: 'bg-[var(--text-faint)]',
        };
    }
  }

  /** Classe del badge riepilogo per il vincitore complessivo. */
  protected overallBadgeClass(): string {
    switch (this.overallWinner()) {
      case 'HTTP/3':
        return 'bg-[var(--warn-soft)] text-[var(--warn)]';
      case 'HTTP/2':
        return 'bg-[var(--accent-soft)] text-[var(--accent)]';
      default:
        return 'bg-[var(--bg-2)] text-[var(--text-faint)]';
    }
  }

  /** Classe del badge vincitore per una singola riga di confronto. */
  protected rowBadgeClass(winner: CompareRow['winner']): string {
    switch (winner) {
      case 'HTTP/3':
        return 'bg-[var(--warn-soft)] text-[var(--warn)]';
      case 'HTTP/2':
        return 'bg-[var(--accent-soft)] text-[var(--accent)]';
      default:
        return 'bg-[var(--bg-2)] text-[var(--text-faint)]';
    }
  }
}
