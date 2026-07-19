import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { LoadingService } from '../../../../core/state/loading.service';
import { Client } from '../../../../models';
import { ClientDraft, ClientService } from '../../data/client.service';

/** Valore di default per un nuovo client in creazione. */
function emptyDraft(): ClientDraft {
  return { name: '' };
}

/** Sezione "Client": elenco, creazione, modifica ed eliminazione. */
@Component({
  selector: 'app-clients',
  imports: [],
  templateUrl: './clients.html',
  styleUrl: './clients.css',
})
export class Clients implements OnInit {
  private readonly clientService = inject(ClientService);
  private readonly loadingService = inject(LoadingService);
  private readonly destroyRef = inject(DestroyRef);

  /** Stato di caricamento globale (osservabile via LoadingService). */
  protected readonly loading = toSignal(this.loadingService.loading$, { initialValue: false });
  /** true dopo il primo caricamento dell'elenco (successo o fallback vuoto). */
  protected readonly loaded = signal(false);

  private readonly clients = signal<Client[]>([]);
  protected readonly clientCount = computed(() => this.clients().length);
  protected readonly sortedClients = computed(() =>
    [...this.clients()].sort((a, b) => a.name.localeCompare(b.name)),
  );

  // ---- drawer editor ----
  protected readonly editorOpen = signal(false);
  protected readonly editorMode = signal<'add' | 'edit'>('add');
  private readonly editorId = signal<string | null>(null);
  protected readonly draft = signal<ClientDraft>(emptyDraft());
  protected readonly saving = signal(false);

  protected readonly editorTitle = computed(() =>
    this.editorMode() === 'edit' ? 'Modifica client' : 'Nuovo client',
  );
  protected readonly editorSub = computed(() =>
    this.editorMode() === 'edit'
      ? 'Rinomina lo strumento/browser di test.'
      : "Aggiungi lo strumento o il browser usato per eseguire i test.",
  );
  protected readonly saveLabel = computed(() => (this.saving() ? 'Salvataggio…' : 'Salva'));
  protected readonly saveDisabled = computed(() => this.saving() || !this.draft().name.trim());

  // ---- conferma eliminazione ----
  protected readonly confirmDeleteOpen = signal(false);
  protected readonly confirmDeleteName = computed(() => this.draft().name || 'questo client');

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.clientService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (clients) => {
          this.clients.set(clients);
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

  protected openEdit(client: Client): void {
    this.editorMode.set('edit');
    this.editorId.set(client.id);
    this.draft.set({ name: client.name });
    this.editorOpen.set(true);
  }

  protected closeEditor(): void {
    this.editorOpen.set(false);
  }

  protected setName(value: string): void {
    this.draft.update((d) => ({ ...d, name: value }));
  }

  protected saveDraft(): void {
    if (this.saveDisabled()) {
      return;
    }
    const clean: ClientDraft = { name: this.draft().name.trim() };
    this.saving.set(true);
    const id = this.editorId();
    const request =
      this.editorMode() === 'edit' && id
        ? this.clientService.update(id, clean)
        : this.clientService.create(clean);

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.clients.update((list) =>
          this.editorMode() === 'edit'
            ? list.map((c) => (c.id === saved.id ? saved : c))
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
    this.clientService
      .remove(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.clients.update((list) => list.filter((c) => c.id !== id));
          this.saving.set(false);
          this.confirmDeleteOpen.set(false);
          this.editorOpen.set(false);
        },
        error: () => this.saving.set(false),
      });
  }
}
