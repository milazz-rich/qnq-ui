import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { LoadingService } from '../../../../core/state/loading.service';
import { Protocol, Target, TargetStatus } from '../../../../models';
import { TargetDraft, TargetService } from '../../data/target.service';

/** Valore usato nel filtro per rappresentare "tutte le etichette". */
const ALL_TAGS = 'all';

/** Valori di default per un nuovo target in creazione. */
function emptyDraft(): TargetDraft {
  return { name: '', host: '', port: 443, protocol: 'HTTP/2', tag: '', status: 'idle' };
}

/** Sezione "Server": elenco, filtro per etichetta, creazione, modifica ed eliminazione dei Target. */
@Component({
  selector: 'app-servers',
  imports: [],
  templateUrl: './servers.html',
  styleUrl: './servers.css',
})
export class Servers implements OnInit {
  private readonly targetService = inject(TargetService);
  private readonly loadingService = inject(LoadingService);
  private readonly destroyRef = inject(DestroyRef);

  /** Stato di caricamento globale (osservabile via LoadingService). */
  protected readonly loading = toSignal(this.loadingService.loading$, { initialValue: false });
  /** true dopo il primo caricamento dell'elenco (successo o fallback vuoto). */
  protected readonly loaded = signal(false);

  private readonly targets = signal<Target[]>([]);
  protected readonly serverCount = computed(() => this.targets().length);

  // ---- filtro per etichetta ----
  protected readonly tagFilter = signal<string>(ALL_TAGS);
  protected readonly tagOptions = computed(() => {
    // `?? ''` difensivo: il backend può ancora non restituire `tag` (campo
    // nuovo lato frontend), quindi normalizziamo l'assenza a stringa vuota.
    const tags = Array.from(
      new Set(this.targets().map((t) => (t.tag ?? '').trim()).filter((tag) => tag !== '')),
    ).sort((a, b) => a.localeCompare(b));
    return [{ value: ALL_TAGS, label: 'Tutte le etichette' }, ...tags.map((t) => ({ value: t, label: t }))];
  });
  private readonly filteredTargets = computed(() => {
    const filter = this.tagFilter();
    const list = this.targets();
    return filter === ALL_TAGS ? list : list.filter((t) => (t.tag ?? '') === filter);
  });

  protected readonly rows = computed(() =>
    this.filteredTargets().map((t) => ({
      target: t,
      dotClass: this.statusDotClass(t.status),
      badgeClass: this.statusBadgeClass(t.status),
      statusLabel: this.statusLabel(t.status),
    })),
  );

  // ---- drawer editor ----
  protected readonly editorOpen = signal(false);
  protected readonly editorMode = signal<'add' | 'edit'>('add');
  private readonly editorId = signal<string | null>(null);
  protected readonly draft = signal<TargetDraft>(emptyDraft());
  protected readonly saving = signal(false);

  protected readonly editorTitle = computed(() =>
    this.editorMode() === 'edit' ? 'Modifica server' : 'Aggiungi server',
  );
  protected readonly editorSub = computed(() =>
    this.editorMode() === 'edit'
      ? 'Aggiorna i dati del server, incluso lo stato.'
      : 'Configura un nuovo server bersaglio per i test.',
  );
  protected readonly saveLabel = computed(() => (this.saving() ? 'Salvataggio…' : 'Salva'));
  protected readonly saveDisabled = computed(
    () => this.saving() || !this.draft().name.trim() || !this.draft().host.trim(),
  );

  // ---- conferma eliminazione ----
  protected readonly confirmDeleteOpen = signal(false);
  protected readonly confirmDeleteName = computed(() => this.draft().name || 'questo server');

  protected readonly protocolOptions: Protocol[] = ['HTTP/2', 'HTTP/3'];
  protected readonly statusOptions: { value: TargetStatus; label: string }[] = [
    { value: 'online', label: 'Online' },
    { value: 'idle', label: 'Inattivo' },
    { value: 'offline', label: 'Offline' },
  ];

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.targetService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (targets) => {
          this.targets.set(targets);
          this.loaded.set(true);
        },
        error: () => this.loaded.set(true),
      });
  }

  protected openAdd(): void {
    this.editorMode.set('add');
    this.editorId.set(null);
    this.draft.set(emptyDraft());
    this.editorOpen.set(true);
  }

  protected openEdit(target: Target): void {
    this.editorMode.set('edit');
    this.editorId.set(target.id);
    const { id, ...draft } = target;
    this.draft.set({ ...draft });
    this.editorOpen.set(true);
  }

  protected closeEditor(): void {
    this.editorOpen.set(false);
  }

  protected setName(value: string): void {
    this.draft.update((d) => ({ ...d, name: value }));
  }

  protected setHost(value: string): void {
    this.draft.update((d) => ({ ...d, host: value }));
  }

  protected setPort(value: string): void {
    const port = parseInt(value, 10);
    this.draft.update((d) => ({ ...d, port: Number.isNaN(port) ? d.port : port }));
  }

  protected setTag(value: string): void {
    this.draft.update((d) => ({ ...d, tag: value }));
  }

  protected setTagFilter(value: string): void {
    this.tagFilter.set(value);
  }

  protected setProtocol(protocol: Protocol): void {
    this.draft.update((d) => ({ ...d, protocol }));
  }

  protected setStatus(status: TargetStatus): void {
    this.draft.update((d) => ({ ...d, status }));
  }

  protected protocolButtonClass(protocol: Protocol): string {
    return this.draft().protocol === protocol
      ? 'flex-1 bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]'
      : 'flex-1 text-[var(--text-muted)]';
  }

  protected statusButtonClass(status: TargetStatus): string {
    return this.draft().status === status
      ? 'flex-1 bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]'
      : 'flex-1 text-[var(--text-muted)]';
  }

  protected saveDraft(): void {
    if (this.saveDisabled()) {
      return;
    }
    const clean: TargetDraft = {
      ...this.draft(),
      name: this.draft().name.trim(),
      host: this.draft().host.trim(),
    };
    this.saving.set(true);
    const id = this.editorId();
    const request =
      this.editorMode() === 'edit' && id
        ? this.targetService.update(id, clean)
        : this.targetService.create(clean);

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.targets.update((list) =>
          this.editorMode() === 'edit'
            ? list.map((t) => (t.id === saved.id ? saved : t))
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
    this.targetService
      .remove(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.targets.update((list) => list.filter((t) => t.id !== id));
          this.saving.set(false);
          this.confirmDeleteOpen.set(false);
          this.editorOpen.set(false);
        },
        error: () => this.saving.set(false),
      });
  }

  private statusDotClass(status: TargetStatus): string {
    switch (status) {
      case 'online':
        return 'bg-[var(--ok)]';
      case 'idle':
        return 'bg-[var(--warn)]';
      default:
        return 'bg-[var(--text-faint)]';
    }
  }

  private statusBadgeClass(status: TargetStatus): string {
    switch (status) {
      case 'online':
        return 'bg-[var(--ok-soft)] text-[var(--ok)]';
      case 'idle':
        return 'bg-[var(--warn-soft)] text-[var(--warn)]';
      default:
        return 'bg-[var(--bg-2)] text-[var(--text-faint)]';
    }
  }

  private statusLabel(status: TargetStatus): string {
    switch (status) {
      case 'online':
        return 'Online';
      case 'idle':
        return 'Inattivo';
      default:
        return 'Offline';
    }
  }
}
