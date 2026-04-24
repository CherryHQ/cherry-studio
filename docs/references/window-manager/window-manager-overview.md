# WindowManager Overview

Architecture, lifecycle modes, and event timing contract for WindowManager.

WindowManager is an `@Injectable()` service (`Phase.WhenReady`, priority 5) registered in the lifecycle system. Window configurations live in `windowRegistry.ts`; WindowManager consumes them at runtime.

## Core Type Relationships

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

## Three Lifecycle Modes

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

### `default` — Create on Open, Destroy on Close

Multi-instance mode. Every `open()` call creates a fresh window. `close()` destroys it permanently.

**Use for**: windows that appear many times simultaneously (e.g., sub windows).

```typescript
// windowRegistry.ts
WINDOW_TYPE_REGISTRY[WindowType.SubWindow] = {
  type: WindowType.SubWindow,
  lifecycle: 'default',
  htmlPath: 'sub-window.html',
  windowOptions: { ...DEFAULT_WINDOW_CONFIG },
}

// Usage — each call creates a new window
const tab1 = wm.open(WindowType.SubWindow)
const tab2 = wm.open(WindowType.SubWindow)
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
  windowOptions: { ...DEFAULT_WINDOW_CONFIG, minWidth: 350, minHeight: 400 },
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
  htmlPath: 'selectionAction.html',
  poolConfig: {
    standbySize: 1,          // always keep 1 pre-warmed spare
    recycleMaxSize: 3,       // recycle up to 3 windows for burst handling
    decayInterval: 60,       // decay one excess idle per minute
    inactivityTimeout: 300,  // after 5min idle, trim back to standbySize
    warmup: 'eager'
  },
  windowOptions: { ...DEFAULT_WINDOW_CONFIG, width: 400, height: 300 },
}
```

See [Pool Mechanics](./window-manager-pool-mechanics.md) for the full pool configuration matrix, GC timer behavior, warmup strategies, and suspend/resume semantics.

## Key Features

| Feature | Description |
|---------|-------------|
| Lifecycle modes | `default`, `singleton`, `pooled` — covers all window patterns |
| Window lifecycle hooks (`onWindowCreated` / `onWindowDestroyed`, plus type-filtered `onWindowCreatedByType` / `onWindowDestroyedByType`) | Domain services inject behavior at creation and clean up on destruction via typed `Emitter<ManagedWindow>` events |
| `broadcast()` / `broadcastToType()` | IPC fan-out to all or type-filtered windows |
| `open({ initData })` / `create({ initData })` / `setInitData()` / `getInitData()` | Init payload passed atomically on open/create; automatically pushed to renderer via `WindowManager_Reused` on reuse paths |
| `suspendPool()` / `resumePool()` | Pause pool tracking without destroying in-use windows |
| macOS Dock visibility management | Existence-based: Dock is visible while any window with `behavior.macShowInDock !== false` is alive (not destroyed). Services express tray-mode intent via `wm.behavior.setMacShowInDockByType(type, value)` to temporarily opt a type out of Dock contribution. Matches native macOS semantics where Cmd+W does not remove the app from the Dock. |
| `setTitleBarOverlay()` | Batch update overlay on all applicable windows |

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
- For pooled windows, `onWindowCreated` fires only on fresh creation — recycled opens do NOT re-fire, because the BrowserWindow is already created and tracked. Per-instance listeners (e.g. `resized`, per-window `closed` cleanup) must therefore be attached inside `onWindowCreated`, not at the `open()` call site — otherwise a recycled window would either miss the listener on first reuse or accumulate duplicates across successive opens.
