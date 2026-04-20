# WindowManager Usage Guide

Practical guide for using WindowManager from consumer code. For architectural context, see [Overview](./window-manager-overview.md). For full method reference, see [API Reference](./window-manager-api-reference.md).

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
  // preload omitted → defaults to 'index.js'
  // showMode omitted → defaults to 'auto'
  windowOptions: {
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

### 4. Inject domain behavior via `onWindowCreatedByType`

```typescript
// In your domain service's onInit():
const wm = application.get('WindowManager')
wm.onWindowCreatedByType(WindowType.Settings, ({ window, id }) => {
  // Store the windowId for later use
  this.settingsWindowId = id

  // Attach event listeners BEFORE content loads
  window.on('closed', () => {
    this.settingsWindowId = undefined
  })
})
```

The example above uses **destructuring**. An equivalent using the `mw` shorthand (useful when the callback body is long or accesses many fields):

```typescript
wm.onWindowCreatedByType(WindowType.Settings, (mw) => {
  this.settingsWindowId = mw.id
  mw.window.on('closed', () => { this.settingsWindowId = undefined })
})
```

Both are valid — see [Callback styles](#callback-styles-destructuring-vs-mw-shorthand) for when to prefer which.

## Domain Service Integration

The `onWindowCreated` event is the canonical hook for domain services to inject window-specific behavior, and pairs with `wm.open()` / `wm.close()` as the universal consumer API. For single-type subscriptions (the typical case) prefer the `onWindowCreatedByType` / `onWindowDestroyedByType` convenience variants — they filter by type for you so the callback body focuses on behavior, not guards.

### The Pattern

```typescript
@Injectable('SettingsService')
@ServicePhase(Phase.WhenReady)
export class SettingsService extends BaseService {
  private settingsWindowId: string | undefined

  protected override onInit(): void {
    const wm = application.get('WindowManager')

    wm.onWindowCreatedByType(WindowType.Settings, ({ window, id }) => {
      // 1. Store the windowId
      this.settingsWindowId = id

      // 2. Attach listeners BEFORE content loads
      window.once('ready-to-show', () => {
        this.sendInitialConfig(window)
      })

      window.on('closed', () => {
        this.settingsWindowId = undefined
      })
    })

    wm.onWindowDestroyedByType(WindowType.Settings, () => {
      this.settingsWindowId = undefined
    })
  }
}
```

### Injecting behavior: `onWindowCreated` is the canonical hook

Domain services attach window-specific behavior inside an `onWindowCreated` subscription. This pairs with `wm.open()` as the universal consumer API: `open()` produces or reuses a window according to its registry `lifecycle`, and `onWindowCreated` fires exactly once per fresh `BrowserWindow` instance. You never need to branch on "new vs reused" at the call site.

For subscriptions that only care about a single window type (the typical consumer case), use the `onWindowCreatedByType(type, listener)` / `onWindowDestroyedByType(type, listener)` convenience variants — they apply the type filter for you, so the callback body never starts with `if (managed.type !== X) return`. The generic `onWindowCreated` / `onWindowDestroyed` remain available for the rare "observe all windows" use case.

**What `onWindowCreated` gives you for free:**

- **Fires exactly once per fresh BrowserWindow.** Singleton reopens and pool recycles do NOT re-fire — so listeners attached here never accumulate duplicates, and `open()` is always safe regardless of reuse path.
- **Covers every `open()` call site with one subscription.** Primary path, crash recovery, test fixtures, and any future-added entry point all flow through the same event. You cannot forget to wire up a new path.
- **Fires before `loadURL`.** Pre-load configuration such as `setFocusable` (Linux Wayland), `setContentProtection`, or `webContents` session setup can be applied in time to affect first paint.
- **Works for pooled windows too.** Per-instance listeners like `resized` or `closed` must be attached here — the recycle path does not re-fire the event, so attaching them at an `open()` call site would either miss the recycled instance or accumulate on re-open.

**Anti-pattern: direct-ID attachment at the `open()` call site.**

It's tempting to attach listeners inline after `wm.open()` returns, since the ID is right there:

```typescript
const id = wm.open(WindowType.Settings)
const window = wm.getWindow(id)!
window.on('blur', this.hideIfUnpinned)
window.once('closed', () => { this.windowId = null })
```

This looks cleaner than subscribing to an event, but it carries three hidden costs:

1. **Forces you off `open()`.** If the window is reused (singleton reopen or pool recycle), these listeners attach a second time on a window that already has them. To make the pattern safe you'd have to switch to `create()` — which is an internal primitive, not a consumer API (see "Window API layers" below).
2. **Multiple entry paths silently decouple.** Crash recovery, test fixtures, or any future `open()` call site each need to remember to run setup. An `onWindowCreated` subscription covers all of them in one place.
3. **Implicit coupling to registry config.** If listener safety depends on a specific `showMode` / `paintWhenInitiallyHidden` / etc. value (e.g. pre-show `setFocusable` timing that only works when `showMode: 'manual'`), a later registry change breaks correctness with no compile-time signal.

If you feel drawn to this pattern, subscribe to `onWindowCreatedByType(type, listener)` — one extra line, and all three costs disappear.

### Callback styles: destructuring vs `mw` shorthand

The `onWindowCreatedByType` / `onWindowDestroyedByType` listeners receive a `ManagedWindow` — the same record shape as the generic variants. Two idiomatic ways to access its fields:

**Destructuring (recommended default, short callback):**

```typescript
wm.onWindowCreatedByType(WindowType.Settings, ({ window, id }) => {
  this.settingsWindowId = id
  window.on('closed', () => { this.settingsWindowId = undefined })
})
```

Pull exactly the fields you need out of the parameter — `{ window }`, `{ window, id }`, `{ window, id, metadata }`. Self-documenting and avoids the `mw.window.on(...)` visual noise.

**`mw` shorthand (callback with inner closures or many accesses):**

```typescript
wm.onWindowCreatedByType(WindowType.SelectionAction, (mw) => {
  // Inner closure reads mw.window's methods repeatedly — keeping the whole
  // record under one short name reads better than re-destructuring.
  mw.window.on('resized', () => {
    if (mw.window.isDestroyed()) return
    this.saveBounds(mw.id, mw.window.getBounds())
  })
})
```

`mw` is the initials of `ManagedWindow` — short, specific, and doesn't collide with the `.window` field the way a parameter named `window` would.

**Pick whichever reads better in context.** Mixing them across files — or even within the same service — is fine; the parameter name is the only difference.

### Window API layers: consumer vs internal

WindowManager exposes four lifecycle methods, arranged in two layers:

| Layer | Method | Semantics | When to call |
|---|---|---|---|
| **Consumer** | `open(type, args?)` | Lifecycle-aware: fresh create, singleton reuse, or pool recycle per registry | Always, to obtain a window |
| **Consumer** | `close(windowId)` | Lifecycle-aware: destroy non-pooled, release-to-pool for pooled | Always, to release a window |
| Internal | `create(type, args?)` | Force fresh creation; throws if singleton already exists | Defensive assertion — consumer code should not need it |
| Internal | `destroy(windowId)` | Force destroy; bypasses pool recycling | Not needed in consumer code (see below) |

**Consumer code should only ever call `open()` and `close()`.** The registry's `lifecycle` declaration is the single source of truth for how those methods behave, so call sites do not need to branch on window type.

**Why `create()` is not a consumer API.** Every common motivation for reaching for `create()` has a cleaner `open()`-based resolution:

| Urge | Resolution |
|---|---|
| "I need my setup to run only on fresh windows" | Subscribe to `onWindowCreatedByType` — it fires only on fresh, never on reuse |
| "I need to be sure no duplicate singleton exists" | Registry `lifecycle: 'singleton'` already guarantees it; `open()` returns the existing instance |
| "My service's local `windowId` must match WindowManager's" | Subscribe to `onWindowDestroyedByType` to clear local state in sync with WM's `'closed'` tracking |

**Why `destroy()` is not a consumer API.** On non-pooled windows (default and singleton) `close()` falls through to the same `destroyWindow()` call — there is no behavioral difference. On pooled windows, `destroy()` bypasses the pool, which is almost never what a consumer actually wants; the correct API for "stop the whole pool" is `suspendPool(type)`, which destroys idle windows and prevents further recycling without touching in-use windows.

### Domain-Key-to-WindowId Mapping

For window types that are keyed by domain data (e.g., a topic-specific window), the domain service maintains its own mapping:

```typescript
// Domain service tracks which topic is shown in which window
private topicWindows = new Map<string, string>()  // topicId -> windowId

wm.onWindowCreatedByType(WindowType.TopicView, ({ id }) => {
  const topicId = wm.getInitData(id) as string
  this.topicWindows.set(topicId, id)
})

// Open a topic — reuse existing or create new
openTopic(topicId: string): void {
  const existingId = this.topicWindows.get(topicId)
  if (existingId) {
    wm.show(existingId)
    wm.focus(existingId)
    return
  }
  const windowId = wm.open(WindowType.TopicView, { initData: topicId })
}
```

## Renderer: `useWindowInitData` hook

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

For the full cold-start vs reuse timing contract, see [Init Data](./window-manager-api-reference.md#init-data) in the API Reference.
