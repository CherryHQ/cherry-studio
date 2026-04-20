# Window Migration Guide

How to migrate an existing window from direct `BrowserWindow` creation to WindowManager.

## Step 1: Add the WindowType

In `types.ts`, add a new enum value:

```typescript
export enum WindowType {
  // ...
  MyWindow = 'myWindow',
}
```

## Step 2: Register in windowRegistry.ts

Define the window's metadata and default configuration:

```typescript
WINDOW_TYPE_REGISTRY[WindowType.MyWindow] = {
  type: WindowType.MyWindow,
  lifecycle: 'singleton',       // or 'default' or 'pooled'
  htmlPath: 'my-window.html',
  // preload omitted → defaults to 'index.js'. Write basename (with extension)
  // to select a different file in src/preload/. Empty string → no preload.
  // preload: 'simplest.js',
  showMode: 'auto',             // 'auto' | 'immediate' | 'manual'
  windowOptions: {
    ...DEFAULT_WINDOW_CONFIG,
    width: 800,
    height: 600,
  },
  behavior: {
    // Declarative WM-level behaviors (all optional). See the README "Configuration Layers" section.
    // hideOnBlur: true,                    // auto-hide on blur (runtime override: wm.behavior.setHideOnBlur)
    // alwaysOnTop: { level: 'floating' },  // level/relativeLevel for setAlwaysOnTop (runtime override: wm.behavior.setAlwaysOnTop)
    // visibleOnAllWorkspaces: { enabled: true, visibleOnFullScreen: true },
    // macShowInDock: false,                // do not contribute to Dock visibility (macOS helper windows only; default true)
    //                                      // runtime override: wm.behavior.setMacShowInDockByType(type, value) for tray-mode transitions
  },
  // quirks: { ... },                       // OS hacks — see Platform Configuration
}
```

See [Lifecycle Modes](./window-manager-overview.md#three-lifecycle-modes) for choosing between `default` / `singleton` / `pooled`.

## Step 3: Move domain logic to onWindowCreated

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

    wm.onWindowCreatedByType(WindowType.MyWindow, ({ window, id }) => {
      this.windowId = id
      // attach listeners here — use `window` directly, or switch to the `mw` shorthand
      // if the callback body has inner closures (see Usage Guide → Callback styles).
    })

    wm.onWindowDestroyedByType(WindowType.MyWindow, () => {
      this.windowId = undefined
    })
  }

  openWindow(): void {
    const wm = application.get('WindowManager')
    this.windowId = wm.open(WindowType.MyWindow)
  }
}
```

See [Injecting behavior: `onWindowCreated` is the canonical hook](./window-manager-usage.md#injecting-behavior-onwindowcreated-is-the-canonical-hook) for the full rationale behind this pattern.

## Step 4: Replace direct BrowserWindow references

| Old Pattern | New Pattern |
|-------------|-------------|
| `this.window = new BrowserWindow(...)` | `wm.open(WindowType.MyWindow)` |
| `this.window.show()` | `wm.show(windowId)` |
| `this.window.hide()` | `wm.hide(windowId)` |
| `this.window.close()` | `wm.close(windowId)` |
| `this.window.webContents.send(...)` | `wm.getWindow(windowId)?.webContents.send(...)` or `wm.broadcastToType(...)` |
| `BrowserWindow.fromWebContents(e.sender)` | `wm.getWindowIdByWebContents(e.sender)` |

Note: there is intentionally no entry for `this.window.destroy()`. `wm.close()` already handles destruction for non-pooled windows and pool-return for pooled windows. `wm.destroy()` is an internal primitive — see [Window API layers](./window-manager-usage.md#window-api-layers-consumer-vs-internal).

## Step 5: Handle show behavior

Remove manual `show` / `ready-to-show` logic if using `showMode: 'auto'` (the default). WindowManager handles:

- Creating the window hidden
- Showing on `ready-to-show` (fresh path) or immediately (recycled path)

If your window needs custom show timing, set `showMode: 'manual'` in the registry and manage visibility yourself.

## Checklist

- [ ] Added `WindowType` enum value in `types.ts`
- [ ] Registered metadata in `WINDOW_TYPE_REGISTRY` in `windowRegistry.ts`
- [ ] Chose the correct lifecycle mode (`default` / `singleton` / `pooled`)
- [ ] Set `preload` filename if not using the default (`'index.js'`)
- [ ] Set `showMode` behavior (`'auto'` / `'immediate'` / `'manual'`)
- [ ] Set `behavior.macShowInDock: false` ONLY for helper windows (floating panels, selection overlays); primary app windows leave it at the default `true`. Use `wm.behavior.setMacShowInDockByType(type, value)` for runtime tray-mode transitions, not a different registry default.
- [ ] Declared `behavior.hideOnBlur` / `behavior.alwaysOnTop` / `behavior.visibleOnAllWorkspaces` as needed
- [ ] Moved domain logic from constructor to `onWindowCreated` hook
- [ ] Replaced direct `BrowserWindow` references with WindowManager API calls
- [ ] Removed manual `ready-to-show` handling (if using `showMode: 'auto'`)
- [ ] If the window consumes init data: replaced hand-rolled `getInitData` + reset IPC wiring with the `useWindowInitData` hook
- [ ] If pooled: chose appropriate `PoolConfig` axes (`standbySize` for active pre-warm, `recycleMinSize`/`recycleMaxSize` for recycling). Leave `recycleMaxSize` unset for one-shot "close destroys" semantics; set `standbySize` when zero-wait matters under concurrent opens.
- [ ] Verified `onWindowDestroyed` cleanup in the domain service
