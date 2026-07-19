import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { LoadingService } from '../../../../core/state/loading.service';
import { Scenario } from '../../../../models';
import { ScenarioDraft, ScenarioService } from '../../data/scenario.service';

/** Valore usato nel filtro per rappresentare "tutte le etichette". */
const ALL_TAGS = 'all';

/** Valori di default per un nuovo scenario in creazione. */
function emptyDraft(): ScenarioDraft {
  return { name: '', path: '', desc: '', tag: '' };
}

/** Sezione "Scenari": elenco, filtro per etichetta, creazione, modifica ed eliminazione. */
@Component({
  selector: 'app-scenarios',
  imports: [],
  templateUrl: './scenarios.html',
  styleUrl: './scenarios.css',
})
export class Scenarios implements OnInit {
  private readonly scenarioService = inject(ScenarioService);
  private readonly loadingService = inject(LoadingService);
  private readonly destroyRef = inject(DestroyRef);

  /** Stato di caricamento globale (osservabile via LoadingService). */
  protected readonly loading = toSignal(this.loadingService.loading$, { initialValue: false });
  /** true dopo il primo caricamento dell'elenco (successo o fallback vuoto). */
  protected readonly loaded = signal(false);

  private readonly scenarios = signal<Scenario[]>([]);
  protected readonly scenarioCount = computed(() => this.scenarios().length);

  // ---- filtro per etichetta ----
  protected readonly tagFilter = signal<string>(ALL_TAGS);
  protected readonly tagOptions = computed(() => {
    const tags = Array.from(
      new Set(this.scenarios().map((s) => s.tag).filter((tag) => tag.trim() !== '')),
    ).sort((a, b) => a.localeCompare(b));
    return [{ value: ALL_TAGS, label: 'Tutte le etichette' }, ...tags.map((t) => ({ value: t, label: t }))];
  });

  protected readonly filteredScenarios = computed(() => {
    const filter = this.tagFilter();
    const list = this.scenarios();
    return filter === ALL_TAGS ? list : list.filter((s) => s.tag === filter);
  });

  // ---- drawer editor ----
  protected readonly editorOpen = signal(false);
  protected readonly editorMode = signal<'add' | 'edit'>('add');
  private readonly editorId = signal<string | null>(null);
  protected readonly draft = signal<ScenarioDraft>(emptyDraft());
  protected readonly saving = signal(false);

  protected readonly editorTitle = computed(() =>
    this.editorMode() === 'edit' ? 'Modifica scenario' : 'Nuovo scenario',
  );
  protected readonly editorSub = computed(() =>
    this.editorMode() === 'edit'
      ? 'Aggiorna i dati dello scenario.'
      : 'Definisci una nuova pagina da testare, riutilizzabile su più server.',
  );
  protected readonly saveLabel = computed(() => (this.saving() ? 'Salvataggio…' : 'Salva'));
  protected readonly saveDisabled = computed(
    () => this.saving() || !this.draft().name.trim() || !this.draft().path.trim(),
  );
  protected readonly pathPreview = computed(() => this.normalizePath(this.draft().path));

  // ---- conferma eliminazione ----
  protected readonly confirmDeleteOpen = signal(false);
  protected readonly confirmDeleteName = computed(() => this.draft().name || 'questo scenario');

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.scenarioService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (scenarios) => {
          this.scenarios.set(scenarios);
          this.loaded.set(true);
        },
        error: () => this.loaded.set(true),
      });
  }

  protected setTagFilter(value: string): void {
    this.tagFilter.set(value);
  }

  protected openAdd(): void {
    this.editorMode.set('add');
    this.editorId.set(null);
    this.draft.set(emptyDraft());
    this.editorOpen.set(true);
  }

  protected openEdit(scenario: Scenario): void {
    this.editorMode.set('edit');
    this.editorId.set(scenario.id);
    const { id, ...draft } = scenario;
    this.draft.set({ ...draft });
    this.editorOpen.set(true);
  }

  protected closeEditor(): void {
    this.editorOpen.set(false);
  }

  protected setName(value: string): void {
    this.draft.update((d) => ({ ...d, name: value }));
  }

  protected setPath(value: string): void {
    this.draft.update((d) => ({ ...d, path: value }));
  }

  protected setDesc(value: string): void {
    this.draft.update((d) => ({ ...d, desc: value }));
  }

  protected setTag(value: string): void {
    this.draft.update((d) => ({ ...d, tag: value }));
  }

  protected saveDraft(): void {
    if (this.saveDisabled()) {
      return;
    }
    const clean: ScenarioDraft = {
      name: this.draft().name.trim(),
      path: this.normalizePath(this.draft().path),
      desc: this.draft().desc.trim(),
      tag: this.draft().tag.trim(),
    };
    this.saving.set(true);
    const id = this.editorId();
    const request =
      this.editorMode() === 'edit' && id
        ? this.scenarioService.update(id, clean)
        : this.scenarioService.create(clean);

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.scenarios.update((list) =>
          this.editorMode() === 'edit'
            ? list.map((s) => (s.id === saved.id ? saved : s))
            : [...list, saved],
        );
        this.saving.set(false);
        this.editorOpen.set(false);
      },
      error: () => this.saving.set(false),
    });
  }

  protected askDelete(): void {
    this.confirmDeleteOpen.set(true);
  }

  protected cancelDelete(): void {
    this.confirmDeleteOpen.set(false);
  }

  protected confirmDelete(): void {
    const id = this.editorId();
    if (!id) {
      return;
    }
    this.saving.set(true);
    this.scenarioService
      .remove(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.scenarios.update((list) => list.filter((s) => s.id !== id));
          this.saving.set(false);
          this.confirmDeleteOpen.set(false);
          this.editorOpen.set(false);
        },
        error: () => this.saving.set(false),
      });
  }

  /** Normalizza il path garantendo lo slash iniziale. */
  private normalizePath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) {
      return trimmed;
    }
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
}
