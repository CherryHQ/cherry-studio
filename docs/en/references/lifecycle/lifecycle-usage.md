# Lifecycle Usage Guide

Practical guide for using the lifecycle system. For architecture details, see [Lifecycle Overview](./lifecycle-overview.md). For deciding whether to use lifecycle at all, see [Decision Guide](./lifecycle-decision-guide.md).

## Quick Start

```typescript
// 1. Define a service with decorators
import { BaseService, Injectable, ServicePhase, DependsOn, Phase } from '@main/core/lifecycle'

@Injectable('DbService')
@ServicePhase(Phase.WhenReady)
class DbService extends BaseService {
  protected async onInit() {
    await this.connectToDatabase()
  }

  protected async onDestroy() {
    await this.disconnect()
  }
}

@Injectable('PreferenceService')
@DependsOn(['DbService'])
class PreferenceService extends BaseService {
  protected async onInit() {
    // DbService is guaranteed to be ready
    await this.loadPreferences()
  }
}

// 2. Register in serviceRegistry.ts and bootstrap via Application
//    See: docs/en/references/lifecycle/application-overview.md
import { application } from '@main/core/application'
await application.bootstrap()

// 3. Access service instance
const dbService = application.get('DbService')
```

## Decorators

| Decorator                  | Description                                                                                                                                       | Default           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `@Injectable('Name')`      | Mark class as injectable singleton service. Name is **required** because bundlers mangle class names. Must match the key in `serviceRegistry.ts`. | Required          |
| `@ServicePhase(Phase.X)`   | Set bootstrap phase                                                                                                                               | `Phase.WhenReady` |
| `@DependsOn([...])`        | Declare dependencies by service name                                                                                                              | `[]`              |
| `@Priority(n)`             | Initialization priority within layer (lower = earlier)                                                                                            | `100`             |
| `@ErrorHandling(strategy)` | Error handling strategy                                                                                                                           | `'graceful'`      |
| `@Conditional(...)`        | Activate service only when all conditions are met (see [Conditional Activation](#conditional-activation))                                         | Always active     |

**Note:** All services are singletons. Attempting to instantiate a service class directly (via `new`) after it has been created will throw an error. Use `application.get('ServiceName')` to access service instances (see [Application Overview](./application-overview.md)).

## Error Handling Strategies

| Strategy             | Behavior                                               |
| -------------------- | ------------------------------------------------------ |
| `graceful` (default) | Log the error and continue bootstrap.                  |
| `fail-fast`          | Throw `ServiceInitError`, abort startup.               |
| `custom`             | Delegate to `lifecycle:service:error` event listeners. |

```typescript
@Injectable('DbService')
@ErrorHandling('fail-fast')
class DbService extends BaseService {
  protected async onInit() {
    // If this fails, the entire bootstrap is aborted
    await this.connect()
  }
}
```

## Conditional Activation

Use `@Conditional` to declare activation conditions for a service. Services whose conditions are not met are silently skipped during registration.

```typescript
// Platform-specific: macOS only
@Injectable('AppMenuService')
@Conditional(onPlatform('darwin'))
class AppMenuService extends BaseService { ... }

// Multiple conditions (AND logic): Windows + Intel CPU
@Injectable('OvmsService')
@Conditional(onPlatform('win32'), onCpuVendor('intel'))
class OvmsService extends BaseService { ... }

// Environment variable driven
@Injectable('DebugService')
@Conditional(onEnvVar('DEBUG', 'true'))
class DebugService extends BaseService { ... }

// Custom function
@Injectable('GpuService')
@Conditional(when((ctx) => checkNvidiaGpu(), 'requires NVIDIA GPU'))
class GpuService extends BaseService { ... }

// Complex boolean: OR(AND(x1, x2), AND(y1, y2))
@Conditional(anyOf(allOf(onPlatform('win32'), onArch('x64')), allOf(onPlatform('linux'), onArch('arm64'))))
```

### Built-in Conditions

| Factory | Description | Example |
|---------|-------------|---------|
| `onPlatform(...platforms)` | Match platform | `onPlatform('darwin')` |
| `onArch(...archs)` | Match architecture | `onArch('x64', 'arm64')` |
| `onCpuVendor(vendor)` | Match CPU vendor (case-insensitive substring of CPU model) | `onCpuVendor('intel')` |
| `onEnvVar(name, value?)` | Match environment variable | `onEnvVar('DEBUG', 'true')` |
| `when(fn, desc)` | Custom predicate function | `when((ctx) => check(), 'desc')` |
| `not(cond)` | Negate a condition | `not(onPlatform('linux'))` |
| `anyOf(...conds)` | OR: any condition matches | `anyOf(onPlatform('darwin'), onPlatform('win32'))` |
| `allOf(...conds)` | AND: all conditions match | `allOf(onPlatform('win32'), onCpuVendor('intel'))` |

**Transitive exclusion**: If ServiceA is excluded and ServiceB depends on ServiceA, ServiceB is automatically excluded too.

### Accessing Conditional Services

Conditional services must be accessed via `getOptional()`, not `get()`. The two methods are mutually exclusive:

| Method | Unconditional service | Conditional service (active) | Conditional service (excluded) |
|--------|----------------------|------------------------------|-------------------------------|
| `get()` | ✅ Returns `T` | ❌ Throws | ❌ Throws |
| `getOptional()` | ❌ Throws | ✅ Returns `T` | ✅ Returns `undefined` |

```typescript
// Unconditional service — always use get()
const db = application.get('DbService')

// Conditional service — always use getOptional()
const ovms = application.getOptional('OvmsService')
ovms?.start()
```

Access conditional services in `onAllReady()` or later (e.g., IPC handlers) to ensure all services are initialized.

## IPC Handler Management

When a lifecycle service registers IPC handlers, it should use BaseService's built-in tracking instead of calling `ipcMain` directly. This ensures handlers are automatically cleaned up when the service stops, restarts, or is destroyed — eliminating the need for manual `unregisterIpcHandlers()` methods.

### API

| Method | Wraps | Auto-cleanup via | Returns |
|--------|-------|------------------|---------|
| `this.ipcHandle(channel, listener)` | `ipcMain.handle()` | `ipcMain.removeHandler()` | `Disposable` |
| `this.ipcOn(channel, listener)` | `ipcMain.on()` | `ipcMain.removeListener()` | `Disposable` |

> `ipcOnce()` is intentionally not provided — once-listeners fire once and auto-remove, so they do not need lifecycle tracking.

### Convention

Extract all IPC registrations into a **`private registerIpcHandlers()`** method and call it from `onInit()` (or `onReady()`). This keeps the lifecycle hook focused on orchestration and makes the IPC surface easy to locate and review.

```typescript
@Injectable('WindowService')
@ServicePhase(Phase.WhenReady)
export class WindowService extends BaseService {
  protected async onInit() {
    this.registerIpcHandlers()
  }

  private registerIpcHandlers() {
    this.ipcHandle(IpcChannel.Windows_Minimize, () => this.mainWindow!.minimize())
    this.ipcHandle(IpcChannel.Windows_Maximize, () => this.mainWindow!.maximize())
  }

  protected async onStop() {
    // Only service-specific cleanup here
    // IPC handlers are removed automatically after onStop() returns
  }
}
```

> **Naming**: Always use `registerIpcHandlers` (plural). Do not use `setupIpcHandlers`, `registerIpcHandler` (singular), or other variants.

### Cleanup Guarantees

1. **On stop**: All tracked handlers are removed **after** `onStop()` returns, so the service can still use IPC during its own shutdown if needed.
2. **On stop failure**: If `onStop()` throws, IPC cleanup still executes (via try/finally).
3. **On destroy**: Safety-net cleanup runs in `_doDestroy()` for edge cases where a service is destroyed without being stopped first (e.g., init failure).
4. **On restart**: Disposables array is reset after cleanup, so `onInit()` can re-register handlers cleanly.
5. **Backward compatible**: Safe to mix with manual `ipcMain.removeHandler()` in `onStop()` — double-remove is a no-op.
6. **Unified cleanup**: IPC handlers and other disposables (event subscriptions, cleanup functions) are tracked through a single `registerDisposable()` mechanism and cleaned up together.

### Phase Behavior

`this.ipcHandle()` and `this.ipcOn()` work in any phase (`BeforeReady`, `WhenReady`, `Background`). The helpers are thin wrappers around `ipcMain` — the phase system controls *when* `onInit()` runs (and thus when handlers get registered), not whether the registration API is available.

## Service Events (Emitter / Event)

### Problem

`@DependsOn` guarantees initialization order, but some services need to react to work completed by other services at **runtime** — after `onInit()`. For example, `ShortcutService` needs to bind shortcuts when `WindowService` creates the main window, which happens after all services have initialized. The window can also be recreated (macOS activate), so the notification must be repeatable.

### When to Use

- A service completes async work that other services need to react to
- The work may happen multiple times during the app lifecycle (repeatable)
- Multiple consumers may need to react (one-to-many broadcast)

**Do NOT use** for telling a specific service to do something — just call its method directly via `application.get()`.

### Producer Pattern

The producer owns a private `Emitter<T>` and exposes its public `Event<T>`. Follow the naming convention: private `_onXxx`, public `onXxx`.

```typescript
import { BaseService, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

@Injectable('WindowService')
@ServicePhase(Phase.WhenReady)
export class WindowService extends BaseService {
  // Private: only this service can fire
  private readonly _onMainWindowCreated = new Emitter<BrowserWindow>()
  // Public: consumers subscribe to this
  public readonly onMainWindowCreated: Event<BrowserWindow> = this._onMainWindowCreated.event

  public createMainWindow(): BrowserWindow {
    // ...create window...
    this._onMainWindowCreated.fire(this.mainWindow)
    return this.mainWindow
  }

  // Emitter is owned infrastructure — dispose only on destroy, not stop
  protected async onDestroy() {
    this._onMainWindowCreated.dispose()
  }
}
```

**Important**: Do NOT `registerDisposable()` owned Emitters. They live with the service instance and are only disposed in `onDestroy()` (not `onStop()`), so the service can be restarted without losing the Emitter.

### Consumer Pattern

Consumers subscribe via the public `Event<T>` and register the subscription for automatic cleanup.

```typescript
@Injectable('ShortcutService')
@DependsOn(['WindowService'])
export class ShortcutService extends BaseService {
  protected async onInit() {
    const windowService = application.get('WindowService')
    this.registerDisposable(
      windowService.onMainWindowCreated((window) => this.bindShortcuts(window))
    )
  }

  // No manual cleanup needed in onStop() — registerDisposable handles it
}
```

### Error Isolation

`Emitter.fire()` isolates listener errors — if one listener throws, all other listeners still receive the event. The snapshot of listeners is taken before iteration, so listeners can safely unsubscribe during a fire cycle.

## Signal (One-shot Completion)

### Problem

Some services complete a piece of work **exactly once** that other services need to wait for or react to. For example, a database migration that runs during initialization — once done, it's done forever. Unlike `Emitter` events which fire multiple times, this needs a one-shot notification where late subscribers still get the value.

### When to Use

- One-time initialization work that happens asynchronously (DB migration, store hydration)
- Other services need to `await` this completion before proceeding
- Late subscribers (services that start after the signal resolves) should still get the value

**Do NOT use** for repeatable events (window creation, config changes) — use `Emitter<T>` instead.

### Usage

```typescript
import { BaseService, Injectable, Signal } from '@main/core/lifecycle'

// Producer
@Injectable('DbService')
export class DbService extends BaseService {
  readonly migrationComplete = new Signal<void>()

  protected async onInit() {
    this.registerDisposable(this.migrationComplete)
    await this.runMigrations()
    this.migrationComplete.resolve()
  }
}

// Consumer — await style
@Injectable('UserService')
@DependsOn(['DbService'])
export class UserService extends BaseService {
  protected async onInit() {
    await application.get('DbService').migrationComplete
    // migration is guaranteed complete here
  }
}

// Consumer — callback style
@Injectable('AuditService')
@DependsOn(['DbService'])
export class AuditService extends BaseService {
  protected async onInit() {
    this.registerDisposable(
      application.get('DbService').migrationComplete.onResolved(() => {
        this.logMigrationEvent()
      })
    )
  }
}
```

### Key Behaviors

- Implements `PromiseLike<T>` — can be `await`ed directly
- `resolve()` can only be called once — double-resolve throws an error
- Late subscribers receive the resolved value immediately via `onResolved`
- If disposed before `resolve()`, any pending `await` will hang indefinitely (services are stopped in reverse dependency order, so consumers stop before producers)

## Pause/Resume (Optional)

Services can implement the `Pausable` interface to support pause/resume operations:

```typescript
import { BaseService, Injectable, type Pausable } from '@main/core/lifecycle'

@Injectable('RealTimeService')
class RealTimeService extends BaseService implements Pausable {
  private intervalId: NodeJS.Timeout | null = null

  protected onInit() {
    this.startPolling()
  }

  onPause() {
    clearInterval(this.intervalId!)
    this.intervalId = null
  }

  onResume() {
    this.startPolling()
  }

  private startPolling() {
    this.intervalId = setInterval(() => { /* ... */ }, 1000)
  }
}
```

## Stop/Start/Restart

All services support stop/start operations (no special interface needed):

```typescript
import { application } from '@main/core/application'

await application.stop('HeavyComputeService')    // calls onStop()
await application.start('HeavyComputeService')   // calls onInit() again
await application.restart('HeavyComputeService') // stop + start
```

## Activatable (Optional — On-Demand Resource Loading)

Services can implement the `Activatable` interface to defer loading heavy resources (native modules, windows, caches, file I/O) until a condition is met at runtime.

Unlike `@Conditional` (which excludes a service entirely at boot), activatable services are always registered and initialized — their IPC handlers remain available regardless of activation state. Only the heavy resources are loaded/released on demand.

Unlike `Pausable` (which temporarily suspends execution), `Activatable` controls whether resources are allocated at all. Activation state is orthogonal to `LifecycleState` — a Ready service can be activated or inactive.

### Interface

```typescript
import { application } from '@main/core/application'
import { BaseService, Injectable, type Activatable } from '@main/core/lifecycle'

@Injectable('SelectionService')
class SelectionService extends BaseService implements Activatable {
  protected onInit() {
    this.registerIpcHandlers()
    // Set up trigger: subscribe to preference changes
    // Note: PreferenceService is Phase.BeforeReady — guaranteed ready before WhenReady services
    const prefService = application.get('PreferenceService')
    this.registerDisposable(
      prefService.subscribeChange('feature.selection.enabled', async (enabled) => {
        if (enabled) await this.activate()
        else await this.deactivate()
      })
    )
  }

  protected async onReady() {
    // Initial activation check (state is Ready, so activate() works)
    if (application.get('PreferenceService').get('feature.selection.enabled')) {
      await this.activate()
    }
  }

  onActivate() {
    // Load native module, create windows, etc.
  }

  onDeactivate() {
    // Release native module, close windows, etc.
  }
}
```

### Hook Responsibilities (Five-Phase Model)

| Hook | Responsibility | Example |
|------|---------------|---------|
| `onInit()` | Infrastructure: IPC handlers, event subscriptions, trigger setup | `registerIpcHandlers()`, `registerDisposable(...)` |
| `onReady()` | Initial activation check (state = Ready, `activate()` works) | `if (enabled) await this.activate()` |
| `onActivate()` | Load heavy resources | Native modules, windows, caches |
| `onDeactivate()` | Release heavy resources | Close windows, clear caches |
| `onStop()` | Lifecycle cleanup (`_doStop()` auto-deactivates before this) | Clean up non-activation subscriptions |

### Two Activation Paths

Both paths share the same base state checks in `_doActivate()` (Ready state, idempotency, concurrency guard). The difference is what wraps them:

- **Self-activation** (within the service): `this.activate()` / `this.deactivate()` — calls `_doActivate()` directly, no lifecycle events or logging
- **External activation** (from other code): `application.activate('ServiceName')` / `application.deactivate('ServiceName')` — adds LifecycleManager validation, logging, and lifecycle event emission

### Method-Level Guard Pattern

For methods called externally (e.g., by other services or via IPC), use `isActivated` as a guard:

```typescript
createSpan(span: ReadableSpan) {
  if (!this.isActivated) return
  // ... heavy work only when activated
}
```

### `onActivate()` Failure Contract

If `onActivate()` throws after partially allocating resources, it **must** clean up those resources before throwing. Since `isActivated` remains `false` on failure, activation may be retried — partial state must not leak.

### Automatic Deactivation

- `_doStop()` auto-deactivates before calling `onStop()` (failure does not block stop)
- `_doDestroy()` auto-deactivates as a safety net (for destroy-without-stop scenarios)
