import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, forkJoin, of, switchMap } from 'rxjs';
import { LoadingService } from '../../../../core/state/loading.service';
import { Client, Scenario, SessionRunItem, Target } from '../../../../models';
import { ClientService } from '../../../clients/data/client.service';
import { ScenarioService } from '../../../scenarios/data/scenario.service';
import { SessionItemDraft, SessionItemService } from '../../../sessions/data/session-item.service';
import { SessionDraft, SessionService } from '../../../sessions/data/session.service';
import { TargetService } from '../../../targets/data/target.service';

type WizardStep = 1 | 2 | 3;

/** Valore usato nel filtro per rappresentare "tutte le etichette". */
const ALL_TAGS = 'all';

/** Parametri di esecuzione comuni a tutti i test generati. */
interface Config {
  reps: number;
  timeout: number;
  clientId: string;
}

/** Riga di riepilogo mostrata nel pannello laterale. */
interface SummaryRow {
  label: string;
  value: string;
  dim: boolean;
}

/**
 * Wizard "Nuova sessione": selezione multipla di Target e Scenari, configurazione
 * comune e client. Al termine genera i SessionItem (prodotto cartesiano Target ×
 * Scenario) e crea una Session già popolata in stato "pending" (non avviata).
 */
@Component({
  selector: 'app-new-session',
  imports: [],
  templateUrl: './new-session.html',
  styleUrl: './new-session.css',
})
export class NewSession implements OnInit {
  private readonly targetService = inject(TargetService);
  private readonly scenarioService = inject(ScenarioService);
  private readonly clientService = inject(ClientService);
  private readonly sessionItemService = inject(SessionItemService);
  private readonly sessionService = inject(SessionService);
  private readonly loadingService = inject(LoadingService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = toSignal(this.loadingService.loading$, { initialValue: false });
  protected readonly loaded = signal(false);
  protected readonly creating = signal(false);

  protected readonly targets = signal<Target[]>([]);
  protected readonly scenarios = signal<Scenario[]>([]);
  protected readonly clients = signal<Client[]>([]);

  protected readonly step = signal<WizardStep>(1);
  protected readonly selectedTargetIds = signal<string[]>([]);
  protected readonly selectedScenarioIds = signal<string[]>([]);
  protected readonly cfg = signal<Config>({ reps: 30, timeout: 10000, clientId: '' });
  protected readonly sessionName = signal('');

  protected readonly selectedTargets = computed(() =>
    this.selectedTargetIds()
      .map((id) => this.targets().find((t) => t.id === id))
      .filter((t): t is Target => !!t),
  );
  protected readonly selectedScenarios = computed(() =>
    this.selectedScenarioIds()
      .map((id) => this.scenarios().find((s) => s.id === id))
      .filter((s): s is Scenario => !!s),
  );

  // ---- filtro per etichetta (step Scenario) ----
  protected readonly wizScenarioTagFilter = signal<string>(ALL_TAGS);
  protected readonly wizScenarioTagOptions = computed(() => {
    const tags = Array.from(
      new Set(this.scenarios().map((s) => s.tag).filter((tag) => tag.trim() !== '')),
    ).sort((a, b) => a.localeCompare(b));
    return [{ value: ALL_TAGS, label: 'Tutte le etichette' }, ...tags.map((t) => ({ value: t, label: t }))];
  });
  protected readonly filteredWizScenarios = computed(() => {
    const filter = this.wizScenarioTagFilter();
    const list = this.scenarios();
    return filter === ALL_TAGS ? list : list.filter((s) => s.tag === filter);
  });

  protected readonly comboCount = computed(
    () => this.selectedTargets().length * this.selectedScenarios().length,
  );

  protected readonly stepMeta = computed(() => {
    const step = this.step();
    return [
      { n: 1, label: 'Server', kicker: 'Passo 1', done: this.selectedTargets().length > 0 },
      { n: 2, label: 'Scenario', kicker: 'Passo 2', done: this.selectedScenarios().length > 0 },
      { n: 3, label: 'Configurazione', kicker: 'Passo 3', done: false },
    ].map((m) => ({
      ...m,
      active: step === m.n,
      complete: m.done && step > m.n,
      locked: !this.canGo(m.n as WizardStep),
    }));
  });

  protected readonly summaryRows = computed<SummaryRow[]>(() => {
    const targets = this.selectedTargets();
    const scenarios = this.selectedScenarios();
    const cfg = this.cfg();
    const protoSet = Array.from(new Set(targets.map((t) => t.protocol)));
    const client = this.clients().find((c) => c.id === cfg.clientId);
    const tgtLabel =
      targets.length === 0 ? 'Da scegliere' : targets.length === 1 ? targets[0].name : `${targets.length} server`;
    const scLabel =
      scenarios.length === 0
        ? 'Da scegliere'
        : scenarios.length === 1
          ? scenarios[0].path
          : `${scenarios.length} scenari`;
    return [
      { label: 'Server', value: tgtLabel, dim: targets.length === 0 },
      { label: 'Protocollo', value: protoSet.length ? protoSet.join(' · ') : '—', dim: targets.length === 0 },
      { label: scenarios.length > 1 ? 'Scenari' : 'Scenario', value: scLabel, dim: scenarios.length === 0 },
      { label: 'Test', value: this.comboCount() ? String(this.comboCount()) : '—', dim: this.comboCount() === 0 },
      { label: 'Client', value: client?.name ?? '—', dim: !client },
      { label: 'Ripetizioni', value: String(cfg.reps), dim: false },
      { label: 'Timeout', value: `${cfg.timeout} ms`, dim: false },
    ];
  });

  protected readonly sessionPreview = computed(() => {
    const count = this.comboCount();
    if (count === 0) {
      return 'Seleziona server e scenari per generare i test.';
    }
    return `Verranno generati ${count} test in una nuova sessione, pronta da avviare.`;
  });

  protected readonly nextDisabled = computed(() =>
    this.step() === 1
      ? this.selectedTargets().length === 0
      : this.step() === 2
        ? this.selectedScenarios().length === 0
        : true,
  );
  protected readonly createDisabled = computed(
    () =>
      this.creating() ||
      this.selectedTargets().length === 0 ||
      this.selectedScenarios().length === 0 ||
      !this.cfg().clientId,
  );

  ngOnInit(): void {
    forkJoin({
      targets: this.targetService.list().pipe(catchError(() => of<Target[]>([]))),
      scenarios: this.scenarioService.list().pipe(catchError(() => of<Scenario[]>([]))),
      clients: this.clientService.list().pipe(catchError(() => of<Client[]>([]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ targets, scenarios, clients }) => {
        this.targets.set(targets);
        this.scenarios.set(scenarios);
        this.clients.set(clients);
        if (clients.length > 0) {
          this.cfg.update((c) => ({ ...c, clientId: clients[0].id }));
        }
        this.loaded.set(true);
      });
  }

  // ---- selezione (target/scenario deselezionabili) ----
  protected isTargetSelected(id: string): boolean {
    return this.selectedTargetIds().includes(id);
  }

  protected toggleTarget(target: Target): void {
    if (target.status === 'offline') {
      return;
    }
    this.selectedTargetIds.update((ids) =>
      ids.includes(target.id) ? ids.filter((x) => x !== target.id) : [...ids, target.id],
    );
  }

  protected isScenarioSelected(id: string): boolean {
    return this.selectedScenarioIds().includes(id);
  }

  protected toggleScenario(scenario: Scenario): void {
    this.selectedScenarioIds.update((ids) =>
      ids.includes(scenario.id) ? ids.filter((x) => x !== scenario.id) : [...ids, scenario.id],
    );
  }

  protected setWizScenarioTagFilter(value: string): void {
    this.wizScenarioTagFilter.set(value);
  }

  // ---- navigazione step ----
  private canGo(step: WizardStep): boolean {
    if (step <= 1) {
      return true;
    }
    if (step === 2) {
      return this.selectedTargets().length > 0;
    }
    return this.selectedTargets().length > 0 && this.selectedScenarios().length > 0;
  }

  protected goStep(step: number): void {
    if (this.canGo(step as WizardStep)) {
      this.step.set(step as WizardStep);
    }
  }

  protected next(): void {
    const target = Math.min(3, this.step() + 1) as WizardStep;
    if (this.canGo(target)) {
      this.step.set(target);
    }
  }

  protected prev(): void {
    this.step.set(Math.max(1, this.step() - 1) as WizardStep);
  }

  protected reset(): void {
    this.step.set(1);
    this.selectedTargetIds.set([]);
    this.selectedScenarioIds.set([]);
    this.wizScenarioTagFilter.set(ALL_TAGS);
    this.cfg.set({
      reps: 30,
      timeout: 10000,
      clientId: this.clients()[0]?.id ?? '',
    });
    this.sessionName.set('');
  }

  // ---- configurazione ----
  protected incReps(): void {
    this.cfg.update((c) => ({ ...c, reps: Math.min(500, c.reps + 5) }));
  }

  protected decReps(): void {
    this.cfg.update((c) => ({ ...c, reps: Math.max(1, c.reps - 5) }));
  }

  protected setReps(value: string): void {
    const n = parseInt(value, 10);
    this.cfg.update((c) => ({ ...c, reps: Number.isNaN(n) ? 1 : Math.max(1, Math.min(500, n)) }));
  }

  protected setTimeout(value: string): void {
    const n = parseInt(value, 10);
    this.cfg.update((c) => ({ ...c, timeout: Number.isNaN(n) ? 100 : Math.max(100, n) }));
  }

  protected setClient(clientId: string): void {
    this.cfg.update((c) => ({ ...c, clientId }));
  }

  protected setSessionName(value: string): void {
    this.sessionName.set(value);
  }

  /**
   * Genera i SessionItem (prodotto cartesiano Target × Scenario, stessa
   * configurazione e client) e crea una Session "pending" già popolata.
   * A esito positivo resetta il wizard e naviga all'elenco sessioni.
   */
  protected create(): void {
    if (this.createDisabled()) {
      return;
    }
    const cfg = this.cfg();
    const targets = this.selectedTargets();
    const scenarios = this.selectedScenarios();

    // ogni target selezionato × ogni scenario selezionato
    const pairs = targets.flatMap((t) =>
      scenarios.map((sc) => ({
        draft: {
          targetId: t.id,
          scenarioId: sc.id,
          clientId: cfg.clientId,
          reps: cfg.reps,
          timeout: cfg.timeout,
        } satisfies SessionItemDraft,
        label: `${t.name} · ${sc.path}`,
        proto: t.protocol,
      })),
    );

    const name = this.sessionName().trim() || this.autoName();
    this.creating.set(true);

    forkJoin(pairs.map((p) => this.sessionItemService.create(p.draft)))
      .pipe(
        switchMap((items) => {
          const runItems: SessionRunItem[] = items.map((item, i) => ({
            sessionItemId: item.id,
            label: pairs[i].label,
            proto: pairs[i].proto,
            total: cfg.reps,
            done: 0,
            status: 'pending',
          }));
          const draft: SessionDraft = {
            name,
            when: new Date().toISOString(),
            status: 'pending',
            currentIndex: 0,
            items: runItems,
          };
          return this.sessionService.create(draft);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.creating.set(false);
          this.reset();
          this.router.navigateByUrl('/sessions');
        },
        error: () => this.creating.set(false),
      });
  }

  /** Nome automatico basato su server e scenari selezionati. */
  private autoName(): string {
    const targets = this.selectedTargets();
    const scenarios = this.selectedScenarios();
    const namePart = targets.length > 1 ? `${targets.length} server` : targets[0].name;
    const scPart = scenarios.length > 1 ? `${scenarios.length} scenari` : scenarios[0].path;
    return `${namePart} · ${scPart}`;
  }
}
