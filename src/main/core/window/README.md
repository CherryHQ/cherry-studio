# WindowManager

Lifecycle-managed service for creating, tracking, and reusing application windows. Provides three lifecycle modes (default, singleton, pooled), inter-service events, IPC broadcast, and elastic pool reuse.

## Architecture Overview

WindowManager is an `@Injectable()` service (`Phase.WhenReady`, priority 5) registered in the lifecycle system. Window configurations live in `windowRegistry.ts`; WindowManager consumes them at runtime.

### Core Type Relationships

```
WindowType (enum)
  └─ WindowTypeMetadata (discriminated union on `lifecycle`)
       ├─ { lifecycle: 'default' }
       ├─ { lifecycle: 'singleton' }
       └─ { lifecycle: 'pooled', poolConfig: PoolConfig }

WindowManager
  ├─ windows: Map<windowId, ManagedWindow>       ── all tracked windows
  ├─ windowsByType: Map<WindowType, Set<windowId>> ── type index
  ├─ pools: Map<WindowType, PoolState>            ── per-type pool runtime state
  └─ initDataStore: Map<windowId, unknown>        ── one-shot init data
```

### Three Lifecycle Modes

```
┌────────── open() ──────────┐
│                             │
│   ┌─────────────────────┐   │
│   │  lifecycle check    │   │
│   └────────┬────────────┘   │
│       ┌────┼────┐           │
│       ▼    ▼    ▼           │
│   default  singleton  pooled│
│     │        │          │   │
│     │     existing?  idle?  │
│     │     ┌──┴──┐  ┌──┴──┐ │
│     │     Y     N  Y     N │
│     │     │     │  │     │  │
│     │  show()   │ recycle │ │
│     │  focus()  │  │     │  │
│     │     │     ▼  │     ▼  │
│     └─────┼─ create() ──┘  │
│           │     │           │
│           ▼     ▼           │
│      return windowId        │
└─────────────────────────────┘
```

### Key Features

| Feature | Description |
|---------|-------------|
| Lifecycle modes | `default`, `singleton`, `pooled` — covers all window patterns |
| Window lifecycle hooks (`onWindowCreated` / `onWindowDestroyed`) | Domain services inject behavior at creation and clean up on destruction via typed `Emitter<ManagedWindow>` events |
| `broadcast()` / `broadcastToType()` | IPC fan-out to all or type-filtered windows |
| `open({ initData })` / `create({ initData })` / `setInitData()` / `getInitData()` | Init payload passed atomically on open/create; automatically pushed to renderer via `WindowManager_Reused` on reuse paths |
| `suspendPool()` / `resumePool()` | Pause pool tracking without destroying in-use windows |
| macOS Dock visibility management | Automatic based on visible windows and `showInDock` metadata |
| `setTitleBarOverlay()` | Batch update overlay on all applicable windows |

## Quick Start

### 1. Add the WindowType enum value

In `types.ts`:

```typescript
export enum WindowType {
  Main = 'main',
  // ... existing types
  Settings = 'settings',  // <-- add your new type
}
```

### 2. Register in the window registry

In `windowRegistry.ts`:

```typescript
WINDOW_TYPE_REGISTRY[WindowType.Settings] = {
  type: WindowType.Settings,
  lifecycle: 'singleton',
  htmlPath: 'settings.html',
  preload: 'standard',
  show: 'auto',
  defaultConfig: {
    ...DEFAULT_WINDOW_CONFIG,
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
  },
}
```

### 3. Open the window

```typescript
import { application } from '@application'
import { WindowType } from '@main/core/window/types'

const wm = application.get('WindowManager')

// open() is lifecycle-aware — handles singleton reuse, pool recycle, etc.
const windowId = wm.open(WindowType.Settings)
```

### 4. Inject domain behavior via onWindowCreated

```typescript
// In your domain service's onInit():
const wm = application.get('WindowManager')
wm.onWindowCreated((managed) => {
  if (managed.type !== WindowType.Settings) return

  // Store the windowId for later use
  this.settingsWindowId = managed.id

  // Attach event listeners BEFORE content loads
  managed.window.on('closed', () => {
    this.settingsWindowId = undefined
  })
})
```

## Lifecycle Modes

### `default` — Create on Open, Destroy on Close

Multi-instance mode. Every `open()` call creates a fresh window. `close()` destroys it permanently.

**Use for**: windows that appear many times simultaneously (e.g., detached tabs).

```typescript
// windowRegistry.ts
WINDOW_TYPE_REGISTRY[WindowType.DetachedTab] = {
  type: WindowType.DetachedTab,
  lifecycle: 'default',
  htmlPath: 'detached-tab.html',
  defaultConfig: { ...DEFAULT_WINDOW_CONFIG },
}

// Usage — each call creates a new window
const tab1 = wm.open(WindowType.DetachedTab)
const tab2 = wm.open(WindowType.DetachedTab)
wm.close(tab1) // destroyed
```

### `singleton` — At Most One Instance, Reuse on Open

Only one instance can exist at a time. `open()` shows and focuses the existing window if present; creates one if absent. `create()` throws if one already exists.

**Use for**: windows that should never have duplicates (e.g., main window, settings).

```typescript
WINDOW_TYPE_REGISTRY[WindowType.Main] = {
  type: WindowType.Main,
  lifecycle: 'singleton',
  htmlPath: 'index.html',
  defaultConfig: { ...DEFAULT_WINDOW_CONFIG, minWidth: 350, minHeight: 400 },
}

// First call creates; second call shows + focuses the existing window
const id1 = wm.open(WindowType.Main) // creates
const id2 = wm.open(WindowType.Main) // shows + focuses, id2 === id1
```

### `pooled` — Two-Axis Pool with Active Standby + Passive Recycle

Windows are reused rather than destroyed. The pool has two orthogonal axes:

1. **Producer axis (`standbySize`):** Pre-warmed spares are always maintained in the idle queue, actively replenished on every `open()` via `setImmediate`. Guarantees zero-wait for the next caller regardless of concurrent usage.
2. **Consumer axis (`recycleMinSize` / `recycleMaxSize`):** On `close()`, windows are pushed back to the idle queue (bounded by `recycleMaxSize`) for reuse. `recycleMinSize` is a passive decay floor.

Both axes are independently enabled via config. `open()` pops an idle window (firing `WindowManager_Reused` IPC when `initData` is provided) or creates fresh if empty. `close()` either recycles or destroys depending on the recycle config.

**Use for**: frequently opened windows where creation cost is high (selection actions, screenshot overlays).

```typescript
// Example: SelectionAction — hybrid (standby + recycle).
WINDOW_TYPE_REGISTRY[WindowType.SelectionAction] = {
  type: WindowType.SelectionAction,
  lifecycle: 'pooled',
  htmlPath: 'selection-action.html',
  poolConfig: {
    standbySize: 1,          // always keep 1 pre-warmed spare
    recycleMaxSize: 3,       // recycle up to 3 windows for burst handling
    decayInterval: 60,       // decay one excess idle per minute
    inactivityTimeout: 300,  // after 5min idle, trim back to standbySize
    warmup: 'eager'
  },
  defaultConfig: { ...DEFAULT_WINDOW_CONFIG, width: 400, height: 300 },
}
```

## Pool Mechanics

### Two-Axis Model: Standby (Producer) vs Recycle (Consumer)

Each pooled window type has a `PoolState` tracking:

- **`managed: Set<string>`** — All window IDs belonging to this pool (in-use + idle).
- **`idle: string[]`** — FIFO queue of windows available for reuse.
- **`inflightCreates: number`** — Standby replenishments scheduled via `setImmediate` but not yet executed.

The invariant `idle ⊆ managed` holds throughout. A window enters `managed` on creation, enters `idle` on `close()` (if recycled), leaves `idle` on `open()` recycle, and leaves both on destruction (via the centralized `closed` event listener).

**Four configuration scenarios:**

| Scenario | `standbySize` | `recycleMinSize` | `recycleMaxSize` | Semantics |
|---|---|---|---|---|
| ① | 0 | 0 | 0 | Per-open sync create, close destroys (≈ `default` lifecycle) |
| ② | `K` | 0 | 0 | **Pure pre-warm queue** — always K spares, close destroys (one-shot) |
| ③ | 0 | `N` | `M` | Pure recycle pool — legacy behavior, reuse on close |
| ④ | `K` | `N` | `M` | Hybrid — pre-warm + recycle together |

### Pool Configuration

| Field | Axis | Dimension | Description |
|-------|------|-----------|-------------|
| `standbySize` | Producer | idle count | Pre-warmed spares, actively maintained via `setImmediate` replenish on `open()`. Not bound by `recycleMaxSize`. |
| `initialSize` | Producer | managed count | Warmup target. Defaults to `max(standbySize, recycleMinSize)`. |
| `recycleMinSize` | Consumer | idle count | Decay floor — idle above this is subject to eviction. Meaningless without `recycleMaxSize`. |
| `recycleMaxSize` | Consumer | managed count | Soft cap on recyclable managed. `close()` destroys when exceeded. `0`/`undefined` disables recycling entirely. |
| `warmup` | Lifecycle | — | `'eager'` = pre-create at `onAllReady()`, `'lazy'` = backfill on first `close()`. Defaults to `'eager'` if `standbySize > 0` or `initialSize > 0`. |
| `decayInterval` | Timing | seconds | Interval between evicting one idle above `max(standbySize, recycleMinSize)`. `0` = no decay. |
| `inactivityTimeout` | Timing | seconds | Seconds of no `open()` before trimming idle down to `standbySize` (standby preserved). `0` = never. |

### `recycleMaxSize` Strategy (Soft Cap)

`recycleMaxSize` is a **soft cap on the recyclable managed count**. `open()` and `create()` log a warning but allow creation beyond the limit when all idle are consumed. When a window is returned via `close()` and `managed.size + inflightCreates > recycleMaxSize`, it is destroyed instead of pooled, recovering capacity without waiting for decay.

**Important:** `standbySize`-maintained windows are **not** counted against `recycleMaxSize`. During bursts, `managed` may temporarily equal `in-use + standbySize`, exceeding `recycleMaxSize`. Subsequent close calls converge it back.

### GC Timer

A single shared `setInterval` (60s) runs two checks per pool type, in priority order:

1. **Inactivity timeout** (checked first): If `now - lastOpenAt > inactivityTimeout`, trim the idle queue down to `standbySize` (destroy the oldest excess). `recycleMinSize` is NOT preserved — prolonged inactivity means the recycle buffer is stale.
2. **Decay** (only when inactivity did not fire): If `idle.length > max(standbySize, recycleMinSize)` and enough time has passed since both the last `open()` and the last decay, destroy one idle window from the front.

The decay floor uses `max(standbySize, recycleMinSize)` so decay can never drop `idle` below `standbySize`. The inactivity trim uses `standbySize` only — an intentional asymmetry expressing that `standbySize` is a permanent availability commitment while `recycleMinSize` is a short-term retention buffer.

The timer is demand-driven: started on first `releaseToPool()` or standby replenish, stopped when no pool has idle windows.

| Setting | Effect |
|---------|--------|
| `decayInterval: 0` | No gradual decay |
| `inactivityTimeout: 0` | No full-trim on inactivity |
| Both 0 | Idle windows beyond `standbySize` are never automatically reclaimed |

### Warmup Strategies

**Eager** (`warmup: 'eager'`, default when `standbySize > 0`): Pre-creates `initialSize` hidden windows during `onAllReady()`, after all domain services have subscribed to `onWindowCreated`. First `open()` is zero-wait.

**Lazy** (`warmup: 'lazy'`, default when neither `standbySize` nor `initialSize` is set): No pre-creation. First `open()` synchronously creates. With `standbySize > 0`, the first open also schedules a standby replenish, so subsequent opens are zero-wait. With `standbySize = 0`, the first `close()` backfills to `initialSize`.

When both `standbySize > 0` and `warmup: 'lazy'` are set, the lazy backfill branch in `releaseToPool` is skipped — standby replenish handles pool maintenance, and running both would double-create.

### Suspend / Resume

`suspendPool(type)` destroys idle windows and sets a `suspended` flag. In-use windows are left alone. While suspended:

- `open()` creates windows with default lifecycle (not pooled)
- `close()` destroys windows immediately (no pool return)
- Native close (user clicks X) proceeds normally
- Warmup and lazy backfill are skipped

`resumePool(type)` clears the flag, resets `lastOpenAt` (to prevent immediate GC), and triggers eager warmup if configured.

Persistence is the caller's responsibility. On restart, the owning service should call `suspendPool()` in its `onInit()` if the pool should remain suspended — this is guaranteed to run before `onAllReady()` (where eager warmup fires).

### `WindowManager_Reused` IPC

When a **re-used** window (pool recycle or singleton reopen) is handed back to a caller and the caller supplied `initData`, the renderer receives `IpcChannel.WindowManager_Reused` with that init data as the event payload:

```typescript
window.electron?.ipcRenderer.on(IpcChannel.WindowManager_Reused, (_event, payload) => {
  // payload is exactly the object passed as `open({ initData })`
})
```

Rules:

- Fired only when the window is being **re-used** AND the caller provided `initData`. Fresh windows never receive this event (the renderer is not yet ready to listen — use cold-start `getInitData` instead).
- No "empty" Reused events. No `initData` → no event.
- The same payload is simultaneously written into the init-data store, so `getInitData(windowId)` reflects the new value synchronously once `open()` returns.

**Recommended usage** in the renderer: don't handle these two paths by hand — use the `useWindowInitData` hook (below), which encapsulates both cold-start invoke and re-use payload delivery into a single React hook.

### Renderer: `useWindowInitData` hook

`src/renderer/src/core/hooks/useWindowInitData.ts` provides the canonical way for any managed window to consume its init data across both creation paths:

```typescript
import { useWindowInitData } from '@renderer/core/hooks/useWindowInitData'

const MyWindowApp: FC = () => {
  const data = useWindowInitData<MyInitData>()
  if (!data) return null
  return <ControlledContent data={data} />
}
```

- On mount: pulls via `WindowManager_GetInitData` invoke (cold-start path).
- On re-use: receives the `WindowManager_Reused` payload (PUSH path, zero round-trip).
- Per-session state resets should live inside the child component in `useEffect([data.someStableId], …)`, so the DOM stays continuous across recycles — never use `key={resetKey}` to forcibly remount; that reintroduces the flash this contract was designed to eliminate.

Pooled windows that are **visually sensitive** to showing stale content or empty chrome (e.g. transparent hiddenInset frames on macOS where empty content reveals the native traffic-light buttons) can wrap their own `.show()` call in a short "reveal" sequence that briefly `setOpacity(0) + showInactive()` lets Chromium resume compositor paint, then `setOpacity(1)` after a settle window. See `SelectionService.processAction` for a reference implementation. This concern is domain-specific and not part of the generic `WindowManager` contract.

### Comparison with dearo's original WindowManager

This WindowManager was derived from the reference implementation in `~/dearo/dearo`. The init-data path here differs in three ways, all for the same reason: we ship smaller transparent-frame windows on macOS where an empty-DOM frame between `.show()` and first paint is immediately visible as a traffic-light flash.

| Aspect | dearo | this fork |
| --- | --- | --- |
| `open()` accepts `initData` | no — two-step `open` + `setInitData` | yes — `open(type, { initData, options })`, atomic |
| Recycle notification | `WINDOW_POOL_RESET`, signal-only `() => void` | `WindowManager_Reused`, payload = the initData |
| Event coverage | pool recycle only | pool recycle + singleton reopen |
| Renderer delivery | manual `on(reset) + invoke(getInitData)` per window | `useWindowInitData` hook, zero IPC round-trip |

## Domain Service Integration

The `onWindowCreated` event is the primary hook for domain services to inject window-specific behavior. It fires synchronously in step 4 of the creation sequence (see Event Timing Contract below), before content loads.

### The Pattern

```typescript
@Injectable('SettingsService')
@ServicePhase(Phase.WhenReady)
export class SettingsService extends BaseService {
  private settingsWindowId: string | undefined

  protected override onInit(): void {
    const wm = application.get('WindowManager')

    wm.onWindowCreated((managed) => {
      if (managed.type !== WindowType.Settings) return

      // 1. Store the windowId
      this.settingsWindowId = managed.id

      // 2. Attach listeners BEFORE content loads
      managed.window.once('ready-to-show', () => {
        this.sendInitialConfig(managed.window)
      })

      managed.window.on('closed', () => {
        this.settingsWindowId = undefined
      })
    })

    wm.onWindowDestroyed((managed) => {
      if (managed.type !== WindowType.Settings) return
      this.settingsWindowId = undefined
    })
  }
}
```

### Domain-Key-to-WindowId Mapping

For window types that are keyed by domain data (e.g., a topic-specific window), the domain service maintains its own mapping:

```typescript
// Domain service tracks which topic is shown in which window
private topicWindows = new Map<string, string>()  // topicId -> windowId

wm.onWindowCreated((managed) => {
  if (managed.type !== WindowType.TopicView) return

  const topicId = wm.getInitData(managed.id) as string
  this.topicWindows.set(topicId, managed.id)
})

// Open a topic — reuse existing or create new
openTopic(topicId: string): void {
  const existingId = this.topicWindows.get(topicId)
  if (existingId) {
    wm.show(existingId)
    wm.focus(existingId)
    return
  }
  const windowId = wm.open(WindowType.TopicView)
  wm.setInitData(windowId, topicId)
}
```

## Event Timing Contract

The `createWindow()` method follows a strict 5-step execution order:

```
1. new BrowserWindow(config)        ── native window exists
2. setupWindowListeners()           ── close/closed/show/hide handlers attached
3. windows.set() / windowsByType    ── window is queryable
4. _onWindowCreated.fire()          ── domain services inject behavior (sync)
5. loadWindowContent()              ── HTML loads, ready-to-show may fire
```

### Why This Order Matters

- **Step 2 before 4**: Internal lifecycle handlers (pool interception, Dock tracking) are in place before any domain code runs.
- **Step 3 before 4**: Domain services can call `getWindow()`, `getWindowInfo()`, etc. inside the `onWindowCreated` callback.
- **Step 4 before 5**: Domain services can attach `ready-to-show`, `did-finish-load`, and other content-dependent listeners with the guarantee that content has not started loading yet.

### Guarantees

- `onWindowCreated` fires exactly once per window, synchronously.
- Content loading (step 5) is skipped when `metadata.htmlPath` is empty — the domain service is responsible for loading content.
- For pooled windows, `onWindowCreated` fires only for fresh windows. Recycled windows skip this path entirely (they are already created and tracked).

## API Reference

### Open / Create / Close

| Method | Signature | Description |
|--------|-----------|-------------|
| `open` | `(type: WindowType, options?: Partial<WindowOptions>) => string` | Lifecycle-aware open: singleton reuse, pool recycle, or create new. Returns window ID. |
| `create` | `(type: WindowType, options?: Partial<WindowOptions>) => string` | Force create a new window. Throws if singleton already exists. Returns window ID. |
| `close` | `(windowId: string) => boolean` | Close or return to pool. Pooled windows are hidden, not destroyed. |
| `destroy` | `(windowId: string) => boolean` | Force destroy, always bypasses pool return. |

### Window Operations

| Method | Signature | Description |
|--------|-----------|-------------|
| `show` | `(windowId: string) => boolean` | Show a window. Updates Dock visibility on macOS. |
| `hide` | `(windowId: string) => boolean` | Hide a window. Updates Dock visibility on macOS. |
| `minimize` | `(windowId: string) => boolean` | Minimize a window. |
| `maximize` | `(windowId: string) => boolean` | Toggle maximize/unmaximize. |
| `restore` | `(windowId: string) => boolean` | Restore a minimized window. |
| `focus` | `(windowId: string) => boolean` | Focus a window. |

### Queries

| Method | Signature | Description |
|--------|-----------|-------------|
| `getWindow` | `(windowId: string) => BrowserWindow \| undefined` | Get BrowserWindow instance by ID. |
| `getWindowInfo` | `(windowId: string) => WindowInfo \| undefined` | Get serializable window metadata. |
| `getAllWindows` | `() => ManagedWindow[]` | Get all managed windows. |
| `getWindowsByType` | `(type: WindowType) => WindowInfo[]` | Get all windows of a specific type. |
| `getWindowId` | `(window: BrowserWindow) => string \| undefined` | Resolve window ID from BrowserWindow. |
| `getWindowIdByWebContents` | `(wc: WebContents) => string \| undefined` | Resolve window ID from WebContents (e.g., IPC `event.sender`). |
| `count` | `(getter)` | Number of managed windows. |

### Broadcast

| Method | Signature | Description |
|--------|-----------|-------------|
| `broadcast` | `(channel: string, ...args: unknown[]) => void` | Send IPC to all managed windows. Skips destroyed windows. |
| `broadcastToType` | `(type: WindowType, channel: string, ...args: unknown[]) => void` | Send IPC to windows of a specific type. |

### Init Data

| Method | Signature | Description |
|--------|-----------|-------------|
| `open<T>` | `(type: WindowType, args?: { initData?: T, options?: Partial<WindowOptions> }) => string` | When `args.initData` is supplied, written atomically to the store before the method returns; also pushed to the renderer as the `WindowManager_Reused` payload on reuse paths. |
| `create<T>` | `(type: WindowType, args?: { initData?: T, options?: Partial<WindowOptions> }) => string` | Same atomicity as `open`, but never fires `Reused` (all create paths are fresh creation). |
| `setInitData` | `(windowId: string, data: unknown) => void` | Low-level primitive. Prefer the `open/create` args form in new code. |
| `getInitData` | `(windowId: string) => unknown \| null` | Retrieve initialization data. Cleared on pool release. |

**Timing contract:**

- **Cold start** (fresh creation): `createWindow` writes `initData` to the store synchronously before returning, so any `getInitData` invoke from the renderer (after React mounts) sees the fresh value. The renderer should use the `useWindowInitData` hook described above — it handles the invoke on mount automatically.
- **Reuse** (pool recycle / singleton reopen): `open()` simultaneously writes to the store AND fires `WindowManager_Reused` with the same payload. The `useWindowInitData` hook updates its state directly from the event payload — no round-trip.
- **No initData** on a reuse call: the event is NOT fired. No "empty Reused" events — the hook therefore never needs a fallback invoke.

`webContents.send` is fire-and-forget and does not buffer messages sent before the renderer registers listeners. This is exactly why fresh windows can't use PUSH — they still must PULL via `getInitData` on mount.

### Pool Management

| Method | Signature | Description |
|--------|-----------|-------------|
| `suspendPool` | `(type: WindowType) => number` | Suspend pool: destroy idle windows, disable pool tracking. Returns count destroyed. |
| `resumePool` | `(type: WindowType) => void` | Resume pool: restore lifecycle behavior, trigger eager warmup if configured. |

### Title Bar

| Method | Signature | Description |
|--------|-----------|-------------|
| `setTitleBarOverlay` | `(options: TitleBarOverlayOptions) => void` | Update title bar overlay on all windows with overlay configured. |

### Events

The four-event lifecycle forms a complete loop for pooled windows:

```
Created ──▶ [Released ──▶ Recycled ──▶ Released ──▶ ...] ──▶ Destroyed
```

For non-pooled windows, only `Created` and `Destroyed` fire.

| Event | Type | Description |
|-------|------|-------------|
| `onWindowCreated` | `Event<ManagedWindow>` | Fires when a new window is created (before content loads). Fresh-path only for pooled windows. |
| `onWindowDestroyed` | `Event<ManagedWindow>` | Fires when a window is truly destroyed (not on pool release). |

Pool lifecycle (hide → idle, idle → recycle) has no dedicated events — side effects on `hide`/`close`/`show` should be expressed as declarative [Platform Quirks](#platform-quirks), and per-session data on recycle is delivered via the `WindowManager_Reused` IPC payload (see [Init Data](#init-data)).

**Usage notes for pooled windows:**

- **Do NOT set `paintWhenInitiallyHidden: false`** on pooled windows — it suppresses the native `ready-to-show` event, breaking the pool's fresh-window auto-show path (`showBehavior === 'auto'` listens for `ready-to-show`). It is NOT an acceptable workaround for "show only when content ready" — use `show: false` + consumer-driven show for that, or rely on the reuse-path `Reused` payload to ensure the renderer has data before `.show()` is called.
- **macOS focus / hover / always-on-top workarounds** are declarative — see [Platform Quirks](#platform-quirks) below.

## Platform Quirks

Some OS-specific behaviors are tedious to hand-roll at every call site (e.g. the macOS focus dance around `hide()`). WindowManager ships these as **declarative opt-in flags** under `WindowTypeMetadata.quirks`. When set, the manager transparently monkey-patches the corresponding `BrowserWindow` instance methods so business code continues calling `window.hide()` / `window.show()` as usual.

### Available Quirks

| Quirk | Patches | Behavior |
|---|---|---|
| `macRestoreFocusOnHide: boolean` | `hide()`, `close()` | Before invoking the native method, iterate every visible focusable `BrowserWindow` and `setFocusable(false)`; restore them 50ms later. Prevents other windows from being brought to the front when this one disappears. |
| `macClearHoverOnHide: boolean` | `hide()` | After invoking the native `hide()`, send `webContents.sendInputEvent({ type: 'mouseMove', x: -1, y: -1 })` to clear any residual hover state. |
| `macReapplyAlwaysOnTop: 'screen-saver' \| 'floating' \| true` | `show()`, `showInactive()` | After invoking the native method, call `setAlwaysOnTop(true, level)` (defaulting to `'floating'` when `true`). Compensates for macOS level resets between hide/show. |

All quirks are macOS-only: on other platforms the methods are left untouched, and `window.hide === originalHide` (identity preserved).

### Example

```typescript
[WindowType.SelectionToolbar]: {
  type: WindowType.SelectionToolbar,
  lifecycle: 'singleton',
  show: false,
  quirks: {
    macRestoreFocusOnHide: true,
    macClearHoverOnHide: true,
    macReapplyAlwaysOnTop: 'screen-saver',
  },
  defaultConfig: { /* ... */ }
}
```

With that in place, `this.toolbarWindow.hide()` from the domain service will:
1. Snapshot every visible focusable window and call `setFocusable(false)` on them.
2. Invoke the native `hide()`.
3. Send the synthetic `mouseMove(-1, -1)` to clear hover.
4. Schedule `setFocusable(true)` restoration for the snapshot after 50ms.

The domain service carries none of this code.

### Implementation Notes

- `w.hide.bind(w)` captures the native method with `this` correctly bound, so Electron's C++ bindings continue to see the real `BrowserWindow`.
- EventEmitter behavior (`.on('hide', ...)`, `.once('close', ...)`) is untouched — the quirks patch only the method slots, not the emitter wiring.
- Quirks run *after* `onWindowCreated` fires, so domain-service listeners attach before quirk wrappers are in place. Wrappers then compose on top of any pre-existing listeners.
- Quirks are applied per-window at creation time; there is no runtime toggle.

## Platform Overrides

Static `BrowserWindowConstructorOptions` that differ per OS go in `defaultConfig.platformOverrides`. Only the branch matching the current runtime is deep-merged into the final config; unmatched branches are discarded, and the `platformOverrides` field itself is stripped before reaching `new BrowserWindow(...)`.

```typescript
defaultConfig: {
  width: 350, height: 43,
  frame: false, transparent: true,
  platformOverrides: {
    mac: { type: 'panel', hiddenInMissionControl: true, acceptFirstMouse: true },
    win: { type: 'toolbar', focusable: false },
    linux: { type: 'toolbar' } // focusable is set at runtime by the domain service
  },
  webPreferences: { /* ... */ }
}
```

Precedence (later wins) when merging inside `mergeWindowConfig`:

1. `baseConfig` (registry `defaultConfig`)
2. `baseConfig.platformOverrides[currentPlatform]`
3. Caller-provided `overrides` (via `wm.open(type, overrides)`)
4. Caller-provided `overrides.platformOverrides[currentPlatform]`

`webPreferences` is deep-merged in the same order.

### When to Use `platformOverrides` vs `quirks`

- **`platformOverrides`** — *static* options you'd otherwise write as `...(isMac ? {...} : {...})` inside `defaultConfig`. No runtime behavior.
- **`quirks`** — *runtime* method-call hooks (hide/show pre/post). No static options.

The two are composable: a window can declare both. Selection's toolbar does — `platformOverrides` configures `type: 'panel'` on macOS, while `quirks` wires up the three macOS hide/show hooks.

## Migration Guide

How to migrate an existing window from direct `BrowserWindow` creation to WindowManager.

### Step 1: Add the WindowType

In `types.ts`, add a new enum value:

```typescript
export enum WindowType {
  // ...
  MyWindow = 'myWindow',
}
```

### Step 2: Register in windowRegistry.ts

Define the window's metadata and default configuration:

```typescript
WINDOW_TYPE_REGISTRY[WindowType.MyWindow] = {
  type: WindowType.MyWindow,
  lifecycle: 'singleton',       // or 'default' or 'pooled'
  htmlPath: 'my-window.html',
  preload: 'standard',          // 'standard' | 'simplest' | 'none'
  show: 'auto',                 // 'auto' | true | false
  showInDock: true,             // macOS Dock visibility (default: true)
  defaultConfig: {
    ...DEFAULT_WINDOW_CONFIG,
    width: 800,
    height: 600,
  },
}
```

### Step 3: Move domain logic to onWindowCreated

Replace direct `new BrowserWindow()` + setup code with an `onWindowCreated` subscription in your domain service:

**Before:**
```typescript
class MyService {
  private window: BrowserWindow | null = null

  createWindow() {
    this.window = new BrowserWindow({ width: 800, height: 600, ... })
    this.window.loadFile('my-window.html')
    this.window.on('closed', () => { this.window = null })
  }
}
```

**After:**
```typescript
@Injectable('MyService')
@ServicePhase(Phase.WhenReady)
class MyService extends BaseService {
  private windowId: string | undefined

  protected override onInit(): void {
    const wm = application.get('WindowManager')

    wm.onWindowCreated((managed) => {
      if (managed.type !== WindowType.MyWindow) return
      this.windowId = managed.id
      // attach listeners here
    })

    wm.onWindowDestroyed((managed) => {
      if (managed.type !== WindowType.MyWindow) return
      this.windowId = undefined
    })
  }

  openWindow(): void {
    const wm = application.get('WindowManager')
    this.windowId = wm.open(WindowType.MyWindow)
  }
}
```

### Step 4: Replace direct BrowserWindow references

| Old Pattern | New Pattern |
|-------------|-------------|
| `this.window = new BrowserWindow(...)` | `wm.open(WindowType.MyWindow)` |
| `this.window.show()` | `wm.show(windowId)` |
| `this.window.hide()` | `wm.hide(windowId)` |
| `this.window.close()` | `wm.close(windowId)` |
| `this.window.destroy()` | `wm.destroy(windowId)` |
| `this.window.webContents.send(...)` | `wm.getWindow(windowId)?.webContents.send(...)` or `wm.broadcastToType(...)` |
| `BrowserWindow.fromWebContents(e.sender)` | `wm.getWindowIdByWebContents(e.sender)` |

### Step 5: Handle show behavior

Remove manual `show` / `ready-to-show` logic if using `show: 'auto'` (the default). WindowManager handles:

- Creating the window hidden
- Showing on `ready-to-show` (fresh path) or immediately (recycled path)

If your window needs custom show timing, set `show: false` in the registry and manage visibility yourself.

### Checklist

- [ ] Added `WindowType` enum value in `types.ts`
- [ ] Registered metadata in `WINDOW_TYPE_REGISTRY` in `windowRegistry.ts`
- [ ] Chose the correct lifecycle mode (`default` / `singleton` / `pooled`)
- [ ] Set `preload` variant (`standard` / `simplest` / `none`)
- [ ] Set `show` behavior (`'auto'` / `true` / `false`)
- [ ] Set `showInDock` if this window should not affect macOS Dock visibility
- [ ] Moved domain logic from constructor to `onWindowCreated` hook
- [ ] Replaced direct `BrowserWindow` references with WindowManager API calls
- [ ] Removed manual `ready-to-show` handling (if using `show: 'auto'`)
- [ ] If the window consumes init data: replaced hand-rolled `getInitData` + reset IPC wiring with the `useWindowInitData` hook
- [ ] If pooled: chose appropriate `PoolConfig` axes (`standbySize` for active pre-warm, `recycleMinSize`/`recycleMaxSize` for recycling). Leave `recycleMaxSize` unset for one-shot "close destroys" semantics; set `standbySize` when zero-wait matters under concurrent opens.
- [ ] Verified `onWindowDestroyed` cleanup in the domain service
