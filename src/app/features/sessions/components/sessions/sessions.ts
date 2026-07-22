import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, interval, of, Subscription, switchMap } from 'rxjs';
import { LoadingService } from '../../../../core/state/loading.service';
import { Protocol, Session, SessionItemStatus, SessionRunItem } from '../../../../models';
import { SessionDraft, SessionService } from '../../data/session.service';

/** Modello di visualizzazione di una sessione nell'elenco. */
interface SessionCard {
  session: Session;
  statusLabel: string;
  badgeClass: string;
  metaText: string;
  chips: {
    label: string;
    proto: Protocol;
    protoClass: string;
    dotClass: string;
    statusLabel: string;
    badgeClass: string;
  }[];
}

/** Stato di avanzamento di un item nel pannello della sessione attiva. */
interface ProgressItem {
  label: string;
  proto: Protocol;
  statusLabel: string;
  badgeClass: string;
  dotClass: string;
  barClass: string;
  pct: number;
  progressText: string;
}

/** Pannello di avanzamento della sessione in esecuzione. */
interface ProgressView {
  name: string;
  counterText: string;
  doneText: string;
  overallPct: number;
  items: ProgressItem[];
}

const mesi = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/** Sezione "Sessioni": elenco, avvio, modifica, rilancio, riproposizione ed eliminazione. */
@Component({
  selector: 'app-sessions',
  imports: [RouterLink],
  templateUrl: './sessions.html',
  styleUrl: './sessions.css',
})
export class Sessions implements OnInit {
  private readonly sessionService = inject(SessionService);
  private readonly loadingService = inject(LoadingService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = toSignal(this.loadingService.loading$, { initialValue: false });
  protected readonly loaded = signal(false);

  private readonly sessions = signal<Session[]>([]);
  protected readonly sessionCount = computed(() => this.sessions().length);
  protected readonly hasSessions = computed(() => this.sessions().length > 0);

  // ---- polling della sessione in esecuzione ----
  private pollingId: string | null = null;
  private pollSub: Subscription | null = null;

  protected readonly cards = computed<SessionCard[]>(() =>
    this.sessions().map((session) => {
      const reps = session.items.reduce((sum, i) => sum + i.total, 0);
      return {
        session,
        statusLabel: this.statusLabel(session.status),
        badgeClass: this.badgeClass(session.status),
        metaText: `${this.formatWhen(session)} · ${session.items.length} test · ${reps} misurazioni`,
        chips: session.items.map((i) => ({
          label: i.label,
          proto: i.proto,
          protoClass: this.protoClass(i.proto),
          dotClass: this.itemStatusDotClass(i.status),
          statusLabel: this.itemStatusLabel(i.status),
          badgeClass: this.itemStatusBadgeClass(i.status),
        })),
      };
    }),
  );

  protected readonly activeProgress = computed<ProgressView | null>(() => {
    const running = this.sessions().find((s) => s.status === 'running');
    if (!running) {
      return null;
    }
    const total = running.items.length;
    // "failed" è un esito risolto ai fini del completamento: il backend non
    // riproverà quell'item, quindi conta come item chiuso al pari di "completed".
    const doneN = running.items.filter(
      (i) => i.status === 'completed' || i.status === 'failed',
    ).length;
    const cur = Math.min(total, running.currentIndex + 1);
    const frac =
      running.items.reduce(
        (acc, i) =>
          acc +
          (i.status === 'completed' || i.status === 'failed'
            ? 1
            : i.status === 'running'
              ? i.done / i.total
              : 0),
        0,
      ) / (total || 1);
    return {
      name: running.name,
      counterText: doneN >= total ? 'Completata' : `Item ${cur} di ${total} in corso`,
      doneText: `${doneN} / ${total} test`,
      overallPct: Math.round(frac * 100),
      items: running.items.map((i) => this.progressItem(i)),
    };
  });

  // ---- modal di modifica / riproposizione ----
  protected readonly editorOpen = signal(false);
  protected readonly editorMode = signal<'edit' | 'repropose'>('edit');
  private editorSource: Session | null = null;
  protected readonly editorItems = signal<SessionRunItem[]>([]);
  protected readonly editorName = signal('');
  protected readonly saving = signal(false);

  protected readonly editorTitle = computed(() =>
    this.editorMode() === 'edit' ? 'Modifica sessione' : 'Modifica e riproponi',
  );
  protected readonly editorSub = computed(() =>
    this.editorMode() === 'edit'
      ? 'Rimuovi gli item o riordina la sequenza di esecuzione.'
      : 'Parti dagli stessi item: rimuovili o riordinali, poi crea una nuova sessione.',
  );
  protected readonly editorSaveLabel = computed(() =>
    this.saving() ? 'Salvataggio…' : this.editorMode() === 'edit' ? 'Salva modifiche' : 'Crea sessione',
  );
  protected readonly editorSaveDisabled = computed(
    () => this.saving() || this.editorItems().length === 0 || this.editorName().trim() === '',
  );
  protected readonly editorTotalText = computed(() => {
    const items = this.editorItems();
    const reps = items.reduce((sum, i) => sum + i.total, 0);
    return items.length ? `${items.length} test · ${reps} misurazioni` : 'Nessun item';
  });

  // ---- conferma eliminazione ----
  protected readonly confirmDeleteOpen = signal(false);
  private deleteTarget: Session | null = null;
  protected readonly confirmDeleteName = signal('');

  ngOnInit(): void {
    this.refresh(true);
  }

  /** Ricarica l'elenco dal backend e riallinea il polling. */
  private refresh(initial = false): void {
    this.sessionService
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sessions) => {
          this.sessions.set(sessions);
          if (initial) {
            this.loaded.set(true);
          }
          this.ensurePolling();
        },
        error: () => {
          if (initial) {
            this.loaded.set(true);
          }
        },
      });
  }

  /** Avvia una sessione pending; a esito positivo il polling parte via refresh. */
  protected avvia(session: Session): void {
    this.sessionService
      .start(session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.refresh(), error: () => {} });
  }

  /** Rilancia una sessione: crea una nuova sessione con gli stessi item e la avvia. */
  protected relaunch(session: Session): void {
    const draft = this.newDraft(session.name, session.items);
    this.sessionService
      .create(draft)
      .pipe(
        switchMap((created) => this.sessionService.start(created.id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({ next: () => this.refresh(), error: () => {} });
  }

  // ---- modal ----
  protected openEdit(session: Session): void {
    this.editorMode.set('edit');
    this.editorSource = session;
    this.editorItems.set(session.items.map((i) => ({ ...i })));
    this.editorName.set(session.name);
    this.editorOpen.set(true);
  }

  protected openRepropose(session: Session): void {
    this.editorMode.set('repropose');
    this.editorSource = session;
    // riparte dagli stessi item, azzerati a "pending"
    this.editorItems.set(
      session.items.map((i) => ({ ...i, done: 0, status: 'pending' })),
    );
    this.editorName.set(`${session.name} (copia)`);
    this.editorOpen.set(true);
  }

  protected setEditorName(value: string): void {
    this.editorName.set(value);
  }

  protected closeEditor(): void {
    this.editorOpen.set(false);
  }

  protected moveItem(index: number, dir: -1 | 1): void {
    const next = index + dir;
    this.editorItems.update((items) => {
      if (next < 0 || next >= items.length) {
        return items;
      }
      const copy = [...items];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  }

  protected removeItem(index: number): void {
    this.editorItems.update((items) => items.filter((_, i) => i !== index));
  }

  protected saveEditor(): void {
    if (this.editorSaveDisabled() || !this.editorSource) {
      return;
    }
    this.saving.set(true);
    const source = this.editorSource;
    const items = this.editorItems();
    const name = this.editorName().trim();

    const request =
      this.editorMode() === 'edit'
        ? this.sessionService.update(source.id, {
            name,
            when: source.when,
            status: source.status,
            currentIndex: source.currentIndex,
            items,
          })
        : this.sessionService.create(this.newDraft(name, items));

    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.editorOpen.set(false);
        this.refresh();
      },
      error: () => this.saving.set(false),
    });
  }

  // ---- eliminazione ----
  protected askDelete(session: Session): void {
    this.deleteTarget = session;
    this.confirmDeleteName.set(session.name);
    this.confirmDeleteOpen.set(true);
  }

  protected cancelDelete(): void {
    this.confirmDeleteOpen.set(false);
  }

  protected confirmDelete(): void {
    const target = this.deleteTarget;
    if (!target) {
      return;
    }
    this.saving.set(true);
    this.sessionService
      .remove(target.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.confirmDeleteOpen.set(false);
          if (this.pollingId === target.id) {
            this.stopPolling();
          }
          this.refresh();
        },
        error: () => this.saving.set(false),
      });
  }

  // ---- polling ----
  /** Assicura che il polling sia attivo sulla sessione in esecuzione (se presente). */
  private ensurePolling(): void {
    const running = this.sessions().find((s) => s.status === 'running');
    if (!running) {
      this.stopPolling();
      return;
    }
    if (this.pollingId !== running.id) {
      this.startPolling(running.id);
    }
  }

  /** Interroga il backend ogni 2s aggiornando la sessione; si ferma a "completed". */
  private startPolling(id: string): void {
    this.stopPolling();
    this.pollingId = id;
    this.pollSub = interval(2000)
      .pipe(
        switchMap(() => this.sessionService.get(id).pipe(catchError(() => of(null)))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.sessions.update((list) => list.map((s) => (s.id === updated.id ? updated : s)));
        if (updated.status === 'completed') {
          this.stopPolling();
        }
      });
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
    this.pollingId = null;
  }

  /** Costruisce il draft di una nuova sessione pending dagli item dati (azzerati). */
  private newDraft(name: string, items: SessionRunItem[]): SessionDraft {
    return {
      name,
      when: new Date().toISOString(),
      status: 'pending',
      currentIndex: 0,
      items: items.map((i) => ({ ...i, done: 0, status: 'pending' })),
    };
  }

  private progressItem(item: SessionRunItem): ProgressItem {
    const pct =
      item.status === 'completed' || item.status === 'failed'
        ? 100
        : item.status === 'running'
          ? Math.round((item.done / item.total) * 100)
          : 0;
    return {
      label: item.label,
      proto: item.proto,
      statusLabel: this.itemStatusLabel(item.status),
      badgeClass: this.itemStatusBadgeClass(item.status),
      dotClass: this.itemStatusDotClass(item.status),
      barClass:
        item.status === 'failed'
          ? 'bg-[var(--danger)]'
          : item.status === 'completed'
            ? 'bg-[var(--ok)]'
            : 'bg-[var(--accent)]',
      pct,
      progressText:
        item.status === 'pending'
          ? 'In attesa'
          : item.status === 'failed'
            ? 'Non misurabile'
            : `${item.done} / ${item.total} misurazioni`,
    };
  }

  protected itemMeta(item: SessionRunItem): string {
    return `${item.total} rip · ${item.proto}`;
  }

  /**
   * Badge di stato per una riga del modal di modifica: visibile solo in
   * modalità "edit" (sessione esistente, stati reali già noti); nascosto in
   * "repropose", dove gli item ripartono azzerati a "pending" senza storico.
   */
  protected editorItemStatusBadge(item: SessionRunItem): { label: string; badgeClass: string } | null {
    if (this.editorMode() !== 'edit') {
      return null;
    }
    return { label: this.itemStatusLabel(item.status), badgeClass: this.itemStatusBadgeClass(item.status) };
  }

  private itemStatusLabel(status: SessionItemStatus): string {
    switch (status) {
      case 'completed':
        return 'Completato';
      case 'running':
        return 'In corso';
      case 'failed':
        return 'Fallito';
      default:
        return 'In attesa';
    }
  }

  private itemStatusBadgeClass(status: SessionItemStatus): string {
    switch (status) {
      case 'completed':
        return 'bg-[var(--ok-soft)] text-[var(--ok)]';
      case 'running':
        return 'bg-[var(--accent-soft)] text-[var(--accent)]';
      case 'failed':
        return 'bg-[var(--danger-soft)] text-[var(--danger)]';
      default:
        return 'bg-[var(--bg-2)] text-[var(--text-faint)]';
    }
  }

  private itemStatusDotClass(status: SessionItemStatus): string {
    switch (status) {
      case 'completed':
        return 'bg-[var(--ok)]';
      case 'running':
        return 'bg-[var(--accent)]';
      case 'failed':
        return 'bg-[var(--danger)]';
      default:
        return 'bg-[var(--text-faint)]';
    }
  }

  private statusLabel(status: Session['status']): string {
    switch (status) {
      case 'running':
        return 'In corso';
      case 'completed':
        return 'Completata';
      default:
        return 'Da avviare';
    }
  }

  private badgeClass(status: Session['status']): string {
    switch (status) {
      case 'running':
        return 'bg-[var(--accent-soft)] text-[var(--accent)]';
      case 'completed':
        return 'bg-[var(--ok-soft)] text-[var(--ok)]';
      default:
        return 'bg-[var(--warn-soft)] text-[var(--warn)]';
    }
  }

  private protoClass(proto: Protocol): string {
    return proto === 'HTTP/3'
      ? 'bg-[var(--warn-soft)] text-[var(--warn)]'
      : 'bg-[var(--accent-soft)] text-[var(--accent)]';
  }

  /** Formatta il campo `when`: "In attesa" se pending, altrimenti data ISO leggibile. */
  private formatWhen(session: Session): string {
    if (session.status === 'pending') {
      return 'In attesa';
    }
    const date = new Date(session.when);
    if (Number.isNaN(date.getTime())) {
      return session.when;
    }
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${date.getDate()} ${mesi[date.getMonth()]} · ${hh}:${mm}`;
  }
}
