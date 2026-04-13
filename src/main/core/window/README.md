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
| `onWindowCreated` / `onWindowDestroyed` events | `Emitter<ManagedWindow>` — domain services inject behavior via hooks |
| `broadcast()` / `broadcastToType()` | IPC fan-out to all or type-filtered windows |
| `setInitData()` / `getInitData()` | One-shot renderer init payload (consumed once) |
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

### `pooled` — Elastic Pool with Recycle/Release

Windows are reused rather than destroyed. `close()` hides the window and returns it to the idle queue. `open()` recycles an idle window (sending `WINDOW_POOL_RESET` IPC) or creates fresh if the pool is empty.

**Use for**: frequently opened/closed windows where creation cost is high (e.g., screenshot overlay, selection actions).

```typescript
WINDOW_TYPE_REGISTRY[WindowType.SelectionAction] = {
  type: WindowType.SelectionAction,
  lifecycle: 'pooled',
  htmlPath: 'selection-action.html',
  poolConfig: {
    minIdle: 0,
    initialSize: 1,
    maxSize: 3,
    warmup: 'lazy',
    decayInterval: 300,
    idleTimeout: 600,
  },
  defaultConfig: { ...DEFAULT_WINDOW_CONFIG, width: 400, height: 300 },
}
```

## Pool Mechanics

### Elastic Pool Model

Each pooled window type has its own `PoolState` tracking two collections:

- **`managed: Set<string>`** — All window IDs belonging to this pool (in-use + idle). Compared against `maxSize` and `initialSize`.
- **`idle: string[]`** — FIFO queue of windows available for reuse. Compared against `minIdle`.

The invariant is `idle` is a subset of `managed`. A window enters `managed` on creation, enters `idle` on `close()`, leaves `idle` on `open()` recycle, and leaves both on destruction.

### Pool Configuration

Classic elastic pool constraint: `minIdle(p) <= initialSize(n) <= maxSize(m)`.

| Field | Dimension | Description |
|-------|-----------|-------------|
| `minIdle` | idle count | Floor for idle windows. Decay stops here. |
| `initialSize` | managed count | Target total at warmup. |
| `maxSize` | managed count | Soft cap on total windows (in-use + idle). |
| `warmup` | -- | `'eager'` = pre-create at `onAllReady()`, `'lazy'` = backfill after first `close()`. |
| `decayInterval` | seconds | Interval between evicting one idle window above `minIdle`. 0 = no decay. |
| `idleTimeout` | seconds | Seconds since last `open()` before flushing ALL idle windows (ignoring `minIdle`). 0 = never. |

### maxSize Strategy (Soft Limit)

`maxSize` is a **soft cap**. `open()` and `create()` log a warning but allow creation beyond the limit when all windows are in-use. When a window is returned via `close()` and `managed.size > maxSize`, it is destroyed immediately instead of being pooled, recovering capacity without waiting for decay.

### GC Timer

A single shared `setInterval` (120s) runs two checks per pool type, in priority order:

1. **Idle timeout** (checked first): If `now - lastOpenAt > idleTimeout`, destroy ALL idle windows. This ignores `minIdle` — prolonged inactivity means no reason to keep any buffer.
2. **Decay** (only when idle timeout did not fire): If `idle.length > minIdle` and enough time has passed since both the last `open()` and the last decay, destroy one idle window.

The timer is demand-driven: started on first `releaseToPool()`, stopped when no pool has idle windows.

| Setting | Effect |
|---------|--------|
| `decayInterval: 0` | No gradual decay |
| `idleTimeout: 0` | No full-flush on inactivity |
| Both 0 | Idle windows are never automatically reclaimed |

### Warmup Strategies

**Eager** (`warmup: 'eager'`): Pre-creates `initialSize` hidden windows during `onAllReady()`, after all domain services have subscribed to `onWindowCreated`. This guarantees domain hooks are in place before pool windows exist.

**Lazy** (`warmup: 'lazy'`): No pre-creation. After the first `close()` returns a window to the pool, if `managed.size < initialSize`, the deficit is backfilled with hidden idle windows.

### Suspend / Resume

`suspendPool(type)` destroys idle windows and sets a `suspended` flag. In-use windows are left alone. While suspended:

- `open()` creates windows with default lifecycle (not pooled)
- `close()` destroys windows immediately (no pool return)
- Native close (user clicks X) proceeds normally
- Warmup and lazy backfill are skipped

`resumePool(type)` clears the flag, resets `lastOpenAt` (to prevent immediate GC), and triggers eager warmup if configured.

Persistence is the caller's responsibility. On restart, the owning service should call `suspendPool()` in its `onInit()` if the pool should remain suspended — this is guaranteed to run before `onAllReady()` (where eager warmup fires).

### WINDOW_POOL_RESET IPC

When a pooled window is recycled, the renderer receives `IpcChannel.WindowManager_PoolReset`. The renderer **must** reset all component state and re-fetch initialization data:

```typescript
useEffect(() => {
  return window.ipc.on(IpcChannels.WINDOW_POOL_RESET, () => {
    setState(initialState)
    window.ipc.invoke(IpcChannels.WINDOW_GET_INIT_DATA).then(setData)
  })
}, [])
```

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
| `setInitData` | `(windowId: string, data: unknown) => void` | Store one-shot initialization data for a window. |
| `getInitData` | `(windowId: string) => unknown \| null` | Retrieve initialization data. Cleared on pool release. |

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

| Event | Type | Description |
|-------|------|-------------|
| `onWindowCreated` | `Event<ManagedWindow>` | Fires when a new window is created (before content loads). |
| `onWindowDestroyed` | `Event<ManagedWindow>` | Fires when a window is truly destroyed (not on pool release). |

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
- [ ] If pooled: added `WINDOW_POOL_RESET` handler in the renderer
- [ ] If pooled: configured `PoolConfig` with appropriate min/max/warmup/decay values
- [ ] Verified `onWindowDestroyed` cleanup in the domain service
