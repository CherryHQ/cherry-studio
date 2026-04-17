# Lifecycle Migration Guide

This guide walks you through converting existing **infrastructure services** to the lifecycle system. Services that manage resources, require ordered initialization, or need cleanup belong here. Stateless business-logic services (repositories, data-access layers) should remain as simple singletons — see [Decision Guide](./lifecycle-decision-guide.md).

## Old Patterns You'll Encounter

### Pattern A: Manual Singleton

```typescript
// OLD — manual singleton + exported instance
class WindowService {
  private static instance: WindowService | null = null

  public static getInstance(): WindowService {
    if (!WindowService.instance) {
      WindowService.instance = new WindowService()
    }
    return WindowService.instance
  }

  init() { /* ... */ }
  destroy() { /* ... */ }
}

export const windowService = WindowService.getInstance()
```

### Pattern B: Raw `new` Export

```typescript
// OLD — instantiated on import, init called manually
class ThemeService {
  init() { /* ... */ }
}

export const themeService = new ThemeService()
```

### Pattern C: Free Functions

```typescript
// OLD — module-scoped state + exported function
let accelerator: string | null = null

export function registerShortcuts(mainWindow: BrowserWindow) { /* ... */ }
```

## Step-by-Step Migration

### Step 1: Extend BaseService and add decorators

Replace the class definition. Remove `static instance`, `getInstance()`, and `init()`/`destroy()` — the lifecycle system handles all of these.

```typescript
// NEW
import { BaseService, Injectable, ServicePhase, DependsOn, Phase } from '@main/core/lifecycle'

@Injectable('WindowService')
@ServicePhase(Phase.WhenReady)          // needs Electron API → WhenReady
@DependsOn(['PreferenceService'])       // reads preferences on startup
export class WindowService extends BaseService {
  protected async onInit() {
    // ← what was in init() / constructor logic
  }

  protected async onStop() {
    // ← what was in destroy() / cleanup
  }
}
```

**Choosing the right phase:** See [Phase Selection Guide](./lifecycle-overview.md#phase-selection-guide).

**Choosing error strategy:**

| Strategy    | When to use                                     |
| ----------- | ----------------------------------------------- |
| `graceful`  | App can function without this service (default) |
| `fail-fast` | App cannot function (database, core config)     |

### Step 2: Remove singleton boilerplate

Delete all of these:

```typescript
// DELETE all of the following
private static instance: WindowService | null = null

public static getInstance(): WindowService { ... }

// DELETE the exported instance
export const windowService = WindowService.getInstance()
// or
export const windowService = new WindowService()
```

The lifecycle container creates and manages the singleton automatically.

### Step 3: Register in serviceRegistry.ts

```typescript
// src/main/core/application/serviceRegistry.ts
import { WindowService } from '@main/services/WindowService'

export const services = {
  // ...existing
  WindowService,      // ← one line
} as const
```

### Step 4: Replace all import sites

Find every file that imports the old singleton and update:

```typescript
// OLD
import { windowService } from '@main/services/WindowService'
windowService.createMainWindow()

// NEW
import { application } from '@application'
const windowService = application.get('WindowService')
windowService.createMainWindow()
```

> **Conditional services**: If the migrated service uses `@Conditional`, replace `application.get()` calls at import sites with `application.getOptional()`:
> ```typescript
> const menuService = application.getOptional('AppMenuService')
> menuService?.buildMenu()
> ```

### Step 5: Replace dependencies with `@DependsOn`

If the old service imported other service singletons at the top level, convert those to `@DependsOn` and access them via `application.get()` inside methods:

```typescript
// OLD — tight coupling via top-level import
import { windowService } from './WindowService'

class TrayService {
  init() {
    windowService.show()
  }
}

// NEW — loose coupling via lifecycle
@Injectable('TrayService')
@DependsOn(['WindowService'])
export class TrayService extends BaseService {
  protected async onInit() {
    const windowService = application.get('WindowService')
    windowService.show()
  }
}
```

### Step 6: Remove manual init/destroy calls from index.ts

After migration, delete the manual calls in `src/main/index.ts`:

```typescript
// DELETE from index.ts
themeService.init()
windowService.createMainWindow()
new TrayService()
nodeTraceService.init()
analyticsService.init()
```

The lifecycle system calls `onInit()` automatically in the correct order during `application.bootstrap()`.

### Step 7: Migrate free functions to a service class

For Pattern C (free functions with module state), wrap them in a service:

```typescript
// OLD
let accelerator: string | null = null
export function registerShortcuts(mainWindow: BrowserWindow) { ... }

// NEW
@Injectable('ShortcutService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowService', 'PreferenceService'])
export class ShortcutService extends BaseService {
  private accelerator: string | null = null

  protected async onInit() {
    this.registerShortcuts()
  }

  protected async onStop() {
    globalShortcut.unregisterAll()
  }

  private registerShortcuts() { /* ... */ }
}
```

### Step 8: Migrate IPC handlers to BaseService tracking

If your service registers `ipcMain.handle()` or `ipcMain.on()` calls, replace them with `this.ipcHandle()` / `this.ipcOn()` and remove the manual unregister method:

```typescript
// OLD — channel appears twice (register + unregister)
private registerIpcHandlers(): void {
  ipcMain.handle(IpcChannel.MyService_Action, (_, arg) => this.doAction(arg))
}
private unregisterIpcHandlers(): void {
  ipcMain.removeHandler(IpcChannel.MyService_Action)
}

// NEW — auto-tracked, cleanup is automatic
private registerIpcHandlers(): void {
  this.ipcHandle(IpcChannel.MyService_Action, (_, arg) => this.doAction(arg))
}
// DELETE unregisterIpcHandlers() entirely
```

Remove the `unregisterIpcHandlers()` method and its call from `onStop()`. BaseService cleans up all tracked handlers automatically after `onStop()` returns.

> **Tip**: `ipcHandle()` and `ipcOn()` now return a `Disposable`, allowing manual early unregistration if needed (e.g., `const d = this.ipcHandle(...); d.dispose()`). For most services, automatic cleanup on stop is sufficient.

**Migration caveat**: Services using `ipcMain.removeAllListeners(channel)` (e.g., CacheService) need careful review — `this.ipcOn()` tracks specific listeners and uses `removeListener()`, not `removeAllListeners()`. If other code also listens on the same channel, this is the correct behavior; if the intent was to remove all listeners, verify the migration won't leave orphans.

## Before/After Summary

| Aspect         | Before                                      | After                                        |
| -------------- | ------------------------------------------- | -------------------------------------------- |
| Singleton      | `private static instance` + `getInstance()` | `@Injectable('Name')` — container manages it |
| Init           | Manual `init()` called from `index.ts`      | `onInit()` — called automatically            |
| Cleanup        | Manual cleanup in `will-quit` / `before-quit` handler | `onStop()` / `onDestroy()` — automatic |
| Dependencies   | `import { otherService } from '...'`        | `@DependsOn([...])` + `application.get()`    |
| Access         | `import { myService } from '...'`           | `application.get('MyService')`               |
| Ordering       | Manual call order in `index.ts`             | `@ServicePhase` + `@DependsOn` + `@Priority` |
| Error handling | try/catch in `index.ts`                     | `@ErrorHandling('fail-fast' \| 'graceful')`  |
| IPC handlers   | Manual `ipcMain.handle()` + `removeHandler()` | `this.ipcHandle()` — auto-cleanup on stop |

### Step 9: Migrate ad-hoc event communication to Emitter/Event

If the old service used `app.emit()` / `app.on()` or custom EventEmitter patterns for inter-service communication, replace them with typed `Emitter<T>` / `Event<T>`:

```typescript
// OLD — ad-hoc event on Electron's app object
// Producer:
app.emit('main-window-created', this.mainWindow)
// Consumer:
;(app as NodeJS.EventEmitter).on('main-window-created', (event, window) => { ... })
// Manual cleanup in onStop():
;(app as NodeJS.EventEmitter).off('main-window-created', this.handler)

// NEW — typed Emitter/Event
// Producer:
private readonly _onMainWindowCreated = new Emitter<BrowserWindow>()
public readonly onMainWindowCreated: Event<BrowserWindow> = this._onMainWindowCreated.event
// Fire:
this._onMainWindowCreated.fire(this.mainWindow)

// Consumer:
this.registerDisposable(
  windowService.onMainWindowCreated((window) => { ... })
)
// No manual cleanup needed — registerDisposable handles it
```

See [Service Events](./lifecycle-usage.md#service-events-emitter--event) for full patterns.

## Common Pitfalls

1. **Constructor side effects** — Old services often do work in the constructor (event listeners, timers). Move all side effects to `onInit()`. The constructor should only assign default values.

2. **Top-level `application.get()` calls** — `application.get()` only works after the service is registered and bootstrapping has started. Never call it at module scope:

    ```typescript
    // ✗ BAD — runs at import time, before bootstrap
    const preferenceService = application.get('PreferenceService')

    @Injectable('MyService')
    export class MyService extends BaseService {
      // ✓ GOOD — runs during bootstrap, dependencies are ready
      protected async onInit() {
        const preferenceService = application.get('PreferenceService')
      }
    }
    ```

3. **Circular dependencies** — If ServiceA depends on ServiceB and vice versa, refactor so that the non-critical direction uses `onAllReady()` instead of `@DependsOn`:

    ```typescript
    @Injectable('ServiceA')
    @DependsOn(['ServiceB'])          // ← hard dependency
    export class ServiceA extends BaseService { ... }

    @Injectable('ServiceB')
    // No @DependsOn on ServiceA — would be circular
    export class ServiceB extends BaseService {
      protected onAllReady() {
        // Safe to access ServiceA here — all services are ready
        const a = application.get('ServiceA')
      }
    }
    ```

4. **Forgetting to remove old exports** — After migration, grep for the old export name (e.g., `windowService`) across the codebase. Any remaining imports will break at runtime.
