# AGENTS.md — qnq-ui

Riferimento vincolante per ogni prompt e ogni file generato in questo progetto.

**Dominio:** tool per il **confronto prestazionale tra HTTP/2 e HTTP/3** su pagine
web specifiche. La UI Angular permette di definire i server bersaglio (target), i
percorsi da misurare (scenari), gli strumenti/browser usati (client), di comporre
ed eseguire sessioni di misura e di confrontare i risultati (tempo totale, TTFB,
dati trasferiti, protocollo effettivo vs richiesto).

Stack rilevato nel repo (non cambiarlo senza richiesta esplicita):

- Angular **22**, componenti **standalone** (nessun `NgModule`).
- **Signals** per lo stato di componente; **RxJS** per lo stream HTTP e lo stato di loading.
- Naming file Angular moderno: `nome.ts` / `nome.html` / `nome.css` (**senza** suffisso `.component`).
- Prefix selettori: `app`.
- **Tailwind v4** (via `@tailwindcss/postcss`) per lo styling.
- Test con **Vitest** (`ng test`).
- `prefer const`, `strict` TypeScript attivo.

> Regola d'oro: quando scrivi un file, imita lo stile del codice circostante
> (densità di commenti, naming, idiomi) e rispetta le convenzioni qui sotto.

---

## 1. Struttura cartelle

Tutto il codice applicativo vive sotto `src/app/`. La struttura è **per feature**,
con cartelle trasversali condivise.

```
src/app/
├── core/                        # servizi singleton, infrastruttura trasversale
│   ├── http/
│   │   ├── api.service.ts        # wrapper HttpClient (base URL, header comuni)
│   │   └── http-error.interceptor.ts   # gestione errori centralizzata
│   ├── auth/
│   │   ├── auth.service.ts       # autenticazione Firebase Auth (login, registrazione, Google, reset password)
│   │   └── firebase.config.ts    # configurazione progetto Firebase (apiKey, projectId, ...)
│   ├── state/
│   │   ├── loading.service.ts    # stato di loading osservabile globale
│   │   └── theme.service.ts      # tema chiaro/scuro, persistito in localStorage
│   └── errors/
│       ├── app-error.ts          # tipo di errore normalizzato dell'app
│       └── error.service.ts      # raccolta/notifica errori centralizzata
│
├── models/                      # SOLO tipi/interfacce (nessuna logica)
│   ├── protocol.model.ts         # tipo Protocol condiviso (HTTP/2 | HTTP/3)
│   ├── target.model.ts
│   ├── scenario.model.ts
│   ├── client.model.ts
│   ├── session-item.model.ts
│   ├── session.model.ts
│   ├── result.model.ts
│   └── index.ts                  # barrel: re-export di tutti i modelli
│
├── features/                    # una cartella per feature di dominio
│   ├── auth/
│   │   └── components/login/            # componente standalone di login
│   ├── targets/
│   │   ├── data/target.service.ts       # accesso backend per Target
│   │   └── components/...               # componenti standalone della feature
│   ├── scenarios/
│   │   ├── data/scenario.service.ts
│   │   └── components/...
│   ├── clients/
│   │   ├── data/client.service.ts
│   │   └── components/...
│   ├── sessions/
│   │   ├── data/session.service.ts
│   │   └── components/...
│   └── results/
│       ├── data/result.service.ts
│       └── components/...
│
├── shared/                      # componenti/pipe/direttive riusabili, senza dominio
│   ├── ui/                       # bottoni, spinner, badge, tabelle generiche
│   └── pipes/
│
├── app.ts / app.html / app.css
├── app.config.ts                # provider globali (router, http, interceptor)
└── app.routes.ts                # routing con lazy loading per pagina/feature
```

Fuori da `src/app/`, sibling di quest'ultimo:

```
src/environments/
├── environment.ts                # produzione (default); apiBaseUrl del backend
└── environment.development.ts    # sviluppo (`ng serve`); via fileReplacements in angular.json
```

Regole strutturali:

- **`models/`** contiene esclusivamente `interface`/`type`/`enum`. Nessun import di Angular, nessuna logica.
- **`features/<feature>/data/`** contiene i service che parlano col backend.
- **`features/<feature>/components/`** contiene componenti standalone; una cartella per componente con il trio `ts/html/css`.
- **`core/`** è per singleton d'infrastruttura (`providedIn: 'root'`): HTTP, auth, loading, errori. Non contiene logica di dominio.
- **`shared/`** è riusabile e privo di dominio; non deve importare da `features/`.
- Le **pagine** in `pages/` orchestrano i componenti di feature e sono i target del router (lazy).

Naming:

- File: `kebab-case`. Componenti `nome-componente.ts`, service `nome.service.ts`, modelli `nome.model.ts`.
- Classi: `PascalCase` (componente `TargetList`, service `TargetService`).
- Selettori: `app-<kebab>` (es. `app-target-list`).

---

## 2. Modello dati completo

Modello **definito e finale**: usa esattamente questi campi, non aggiungerne né
rinominarne. Definito in `src/app/models/`. Ogni entità è una `interface`. Gli id
sono `string`. I valori di tempo (`total`, `ttfb`, `latency`, `timeout`) sono in
**millisecondi**. I campi `when` / `time` sono timestamp (stringa ISO 8601).

### `protocol.model.ts` — tipo condiviso

```ts
/** Protocollo di trasporto confrontato dal tool. */
export type Protocol = 'HTTP/2' | 'HTTP/3';
```

### `target.model.ts` — server bersaglio

```ts
import { Protocol } from './protocol.model';

export type TargetStatus = 'online' | 'idle' | 'offline';

/** Server bersaglio su cui misurare le prestazioni. */
export interface Target {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: Protocol;            // HTTP/2 | HTTP/3
  maxc: number;                  // max connessioni concorrenti
  status: TargetStatus;          // online | idle | offline
  latency: number;               // ms
}
```

### `scenario.model.ts` — percorso da misurare

```ts
/** Percorso/pagina specifica da misurare su un target. */
export interface Scenario {
  id: string;
  name: string;
  path: string;                  // es. "/images"
  desc: string;
  tag: string;                   // etichetta libera
}
```

### `client.model.ts` — strumento/browser di test

```ts
/** Strumento o browser usato per eseguire il test. */
export interface Client {
  id: string;
  name: string;                  // es. "curl", "Chrome", "Firefox"
}
```

### `session-item.model.ts` — riga di configurazione di una misura

```ts
/**
 * Singola misura configurata: combinazione target × scenario × client
 * con i parametri di esecuzione. È l'unità componibile in una Session.
 */
export interface SessionItem {
  id: string;
  targetId: string;              // FK -> Target.id
  scenarioId: string;            // FK -> Scenario.id
  clientId: string;              // FK -> Client.id
  reps: number;                  // numero ripetizioni
  timeout: number;               // ms
}
```

### `session.model.ts` — esecuzione e avanzamento

```ts
import { Protocol } from './protocol.model';

export type SessionStatus = 'pending' | 'running' | 'completed';

// "failed": il backend non riesce a misurare l'item (client non supportato,
// configurazione rotta). È uno stato SOLO di SessionRunItem, non di Session:
// una Session non ha uno stato "failed" complessivo, resta pending/running/completed
// anche se uno o più suoi item sono falliti (vedi nota sotto).
export type SessionItemStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Stato di avanzamento runtime di un SessionItem dentro una Session. */
export interface SessionRunItem {
  sessionItemId: string;         // FK -> SessionItem.id
  label: string;
  proto: Protocol;               // protocollo di questa esecuzione
  total: number;                 // ripetizioni totali da eseguire
  done: number;                  // ripetizioni completate
  status: SessionItemStatus;     // pending | running | completed | failed
}

/** Esecuzione ordinata di una lista di misure (SessionItem). */
export interface Session {
  id: string;
  name: string;
  when: string;                  // timestamp ISO 8601
  status: SessionStatus;         // pending | running | completed
  currentIndex: number;          // indice dell'item in esecuzione
  items: SessionRunItem[];       // avanzamento per ciascun item
}
```

Nota su `SessionRunItem.status === 'failed'`: ai fini del **completamento della
Session**, un item `failed` va trattato come **risolto**, esattamente come
`completed` — il backend non lo rimisurerà, quindi non deve bloccare
l'avanzamento né il conteggio "N / totale test" in nessuna UI (elenco Sessioni,
pannello di avanzamento, riepiloghi). Va invece distinto visivamente (colore
`--danger`, label "Fallito"/"Non misurabile") perché non rappresenta un successo.

### `result.model.ts` — misura prodotta

```ts
import { Protocol } from './protocol.model';

export type ResultStatus = 'completed' | 'failed';

/** Risultato di una singola esecuzione (una ripetizione misurata). */
export interface Result {
  id: string;
  idx: number;
  sessionItemId: string;         // FK -> SessionRunItem.sessionItemId (Session generatrice)
  target: string;                // nome del target misurato
  scenarioPath: string;          // path dello scenario, es. "/images"
  proto: Protocol;               // protocollo richiesto
  actualProto: Protocol;         // protocollo effettivo (può ricadere su HTTP/2)
  total: number;                 // ms, tempo totale di risposta
  ttfb: number;                  // ms, Time to First Byte
  kb: number;                    // dati trasferiti (KB)
  status: ResultStatus;          // completed | failed
  time: string;                  // timestamp ISO 8601
}
```

### Relazioni

```
SessionItem >── 1 Target
SessionItem >── 1 Scenario
SessionItem >── 1 Client
Session 1 ──< N SessionRunItem  (ogni SessionRunItem riferisce un SessionItem)
SessionRunItem 1 ──< N Result   (join diretto per id: Result.sessionItemId)
```

Nota sul confronto HTTP/2 vs HTTP/3: `Result.proto` è il protocollo **richiesto**,
`Result.actualProto` è quello **effettivamente negoziato** — il delta (es. un HTTP/3
richiesto che ricade su HTTP/2) è un dato di primaria importanza per la UI.

Nota su `Result.sessionItemId`: è il join esplicito verso `SessionRunItem.sessionItemId`
(non verso `SessionItem.id` di configurazione). Permette a viste come "Risultati" di
filtrare i Result appartenenti a una Session specifica per id, senza ricorrere a
matching testuale su nome target / path scenario.

### `index.ts` (barrel)

```ts
export * from './protocol.model';
export * from './target.model';
export * from './scenario.model';
export * from './client.model';
export * from './session-item.model';
export * from './session.model';
export * from './result.model';
```

---

## 3. Convenzioni di codice (obbligatorie in ogni file)

### 3.1 Service (`*.service.ts`)

- Annotati con `@Injectable({ providedIn: 'root' })`.
- Dipendenze iniettate con la funzione **`inject()`** (non constructor DI), es. `private readonly api = inject(ApiService);`.
- **Ogni metodo pubblico ha un blocco JSDoc** che documenta:
  - cosa fa;
  - **`@param`** per ogni parametro (tipo e significato);
  - **`@returns`** con il tipo dell'`Observable` e cosa emette;
  - una riga **"Backend:"** che descrive l'operazione lato server (metodo HTTP, endpoint, effetti collaterali, codici d'errore attesi).
- I metodi ritornano `Observable<T>` (mai `Promise` salvo richiesta esplicita); l'HTTP passa **sempre** da `ApiService`.
- Nessuna gestione di errore inline con `try/catch`/`alert`: l'errore fluisce all'interceptor centralizzato (vedi 3.3).
- Lo stato di loading è tracciato in modo osservabile (vedi 3.4), non con flag booleani sparsi.

Esempio di forma attesa:

```ts
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import { Session } from '../../../models';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(ApiService);

  /**
   * Recupera l'elenco delle sessioni di misura.
   *
   * @returns Observable che emette l'array di Session (vuoto se nessuna).
   *
   * Backend: GET /sessions.
   * 200 -> lista; errori normalizzati in AppError dall'interceptor.
   */
  list(): Observable<Session[]> {
    return this.api.get<Session[]>('/sessions');
  }

  /**
   * Avvia l'esecuzione di una sessione già composta.
   *
   * @param sessionId Id della Session da eseguire.
   * @returns Observable che emette la Session aggiornata (status "running").
   *
   * Backend: POST /sessions/{sessionId}/start.
   * 200 -> Session in esecuzione; 404 -> inesistente; 409 -> già in corso.
   */
  start(sessionId: string): Observable<Session> {
    return this.api.post<Session>(`/sessions/${sessionId}/start`, {});
  }
}
```

### 3.2 `ApiService` (wrapper HTTP)

- Unico punto che usa `HttpClient` direttamente.
- Espone `get<T>`, `post<T>`, `put<T>`, `patch<T>`, `delete<T>` che antepongono il base URL e gli header comuni.
- Ogni metodo ha JSDoc con `@param`/`@returns` come i service.
- Il base URL viene da un token di configurazione (`API_BASE_URL`), non hard-coded nei service.

### 3.3 Gestione errori centralizzata

- Un **HTTP interceptor funzionale** (`http-error.interceptor.ts`, registrato con `withInterceptors` in `app.config.ts`) intercetta ogni `HttpErrorResponse`.
- L'interceptor normalizza l'errore in un tipo unico **`AppError`** `{ code, message, status, details? }` e lo inoltra a `ErrorService`.
- `ErrorService` espone uno stream osservabile di errori (`errors$`) che la UI (toast/banner) consuma; i service **non** mostrano errori da soli.
- Dopo la notifica, l'interceptor rilancia (`throwError`) così che il chiamante possa comunque reagire se necessario.

### 3.4 Stato di loading osservabile

- `LoadingService` mantiene un contatore di richieste in volo ed espone `loading$: Observable<boolean>` (true finché almeno una richiesta è attiva).
- Incremento/decremento gestiti centralmente (interceptor o `ApiService`), non manualmente in ogni componente.
- Per loading locale di feature, il service espone un signal/`BehaviorSubject` dedicato (es. `sessionsLoading$`); i componenti si sottoscrivono, **niente flag booleani mutati a mano**.

### 3.5 Componenti standalone

- `standalone` implicito (Angular 22): `@Component({ selector, imports: [...], templateUrl, styleUrl })`, **senza** `NgModule`.
- Stato locale con **signals** (`signal`, `computed`); i dati dal backend arrivano via service e vengono esposti alla view con `signal`/`toSignal` o `async` pipe.
- Le sottoscrizioni usano `async` pipe nel template quando possibile; se sottoscrivi in TS usa `takeUntilDestroyed()`.
- Nessuna chiamata `HttpClient` diretta nei componenti: sempre tramite i service di feature.
- Membri esposti solo alla view: `protected`; dipendenze iniettate: `private readonly` via `inject()`.
- Styling con classi Tailwind nel template; CSS del componente solo per casi non copribili da utility.

### 3.6 Regole generali

- TypeScript `strict`: niente `any` (usa `unknown` + narrowing); tipi espliciti sui confini pubblici.
- Import ordinati: Angular/core, librerie, poi import relativi al progetto.
- I modelli si importano dal barrel `src/app/models`.
- Il protocollo si tipizza sempre col tipo condiviso `Protocol` (`HTTP/2` | `HTTP/3`), mai stringhe libere.
- Immutabilità dei dati dal backend: non mutare gli oggetti ricevuti, crea nuove copie.
- Ogni service e ogni metodo pubblico devono avere JSDoc; i componenti documentano con JSDoc solo la logica non ovvia.
- Formattazione via Prettier (`.prettierrc` del repo); test co-locati `*.spec.ts` con Vitest.

---

## 4. Autenticazione, tema e ambienti

### 4.1 Autenticazione (Firebase Auth)

L'app usa **Firebase Auth reale** via `@angular/fire`, non un mock. `AuthService`
(`src/app/core/auth/auth.service.ts`) espone:

- `login(email, password)` — email/password, in uso nella UI (pagina Login).
- `register(email, username, password)` — registrazione con `displayName`.
- `google()` — login con popup Google (`GoogleAuthProvider`).
- `logout()` — disconnessione.
- `askPasswordReset(email)`, `verifyPasswordReset(oobCode)`, `confirmPasswordReset(oobCode, newPassword)` — flusso di reset password via email.
- `currentUser` — getter sincrono sull'utente Firebase corrente (backed da un signal aggiornato tramite lo stream `user()` di AngularFire).

Tutti i metodi ritornano `Observable` (wrapper di `from()` sulle Promise dell'SDK
Firebase). Le credenziali del progetto vivono in `core/auth/firebase.config.ts` e
sono iniettate in `app.config.ts` via `provideFirebaseApp` / `provideAuth`.

### 4.2 Route guard

Definiti in `app.routes.ts` con `@angular/fire/auth-guard`:

- `redirectUnauthorizedTo(['/login'])` su `canActivate` della route radice
  (il `MainLayout` con tutte le sezioni protette come children) — un utente non
  autenticato che prova ad accedere a una sezione viene rimandato al login.
- `redirectLoggedInTo([''])` su `canActivate` della route `login` — un utente
  già autenticato che prova ad aprire `/login` viene rimandato alla home.

Entrambi passano tramite `data: { authGuardPipe: ... }` e `canActivate: [AuthGuard]`,
il pattern standard di AngularFire.

### 4.3 Tema chiaro/scuro

`ThemeService` (`src/app/core/state/theme.service.ts`) tiene lo stato del tema in
un signal e lo **persiste in `localStorage`** a ogni `setTheme()`; al bootstrap
dell'app il valore viene riletto da `localStorage` per ripristinare la preferenza
dell'utente. Se `localStorage` non è disponibile (privacy mode), il servizio
degrada silenziosamente a stato solo in memoria per la sessione corrente.

### 4.4 Ambienti

`API_BASE_URL` (usato da `ApiService`) ha come default `environment.apiBaseUrl`
da `src/environments/`, non un valore hardcoded. `environment.development.ts`
sostituisce `environment.ts` in build/serve di sviluppo tramite `fileReplacements`
in `angular.json`. Aggiungere qui l'URL del backend per un nuovo ambiente, non
in `app.config.ts` o nei service.
