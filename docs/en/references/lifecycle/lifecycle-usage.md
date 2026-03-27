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
| `@ExcludePlatforms([...])` | Skip service on specified platforms                                                                                                               | None excluded     |

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

## Platform-Specific Services

Use `@ExcludePlatforms` to declare platforms a service does not support. On excluded platforms, the service is silently skipped during registration.

```typescript
// Exclude entire platform
@Injectable('SelectionService')
@ExcludePlatforms(['linux'])
class SelectionService extends BaseService { ... }

// Exclude specific platform-architecture combination
@Injectable('SomeService')
@ExcludePlatforms(['linux-arm64'])
class SomeService extends BaseService { ... }
```

**Exclusion targets** support two granularities:
- Platform only: `'linux'`, `'win32'`, `'darwin'` — excludes all architectures
- Platform + architecture: `'linux-arm64'`, `'win32-ia32'` — excludes only that combination

**Transitive exclusion**: If ServiceA is excluded and ServiceB depends on ServiceA, ServiceB is automatically excluded too. Call `container.excludeDependentsOfExcluded()` after registration to propagate.

## IPC Handler Management

When a lifecycle service registers IPC handlers, it should use BaseService's built-in tracking instead of calling `ipcMain` directly. This ensures handlers are automatically cleaned up when the service stops, restarts, or is destroyed — eliminating the need for manual `unregisterIpcHandlers()` methods.

### API

| Method | Wraps | Auto-cleanup via |
|--------|-------|------------------|
| `this.ipcHandle(channel, listener)` | `ipcMain.handle()` | `ipcMain.removeHandler()` |
| `this.ipcOn(channel, listener)` | `ipcMain.on()` | `ipcMain.removeListener()` |

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
4. **On restart**: Tracking arrays are reset after cleanup, so `onInit()` can re-register handlers cleanly.
5. **Backward compatible**: Safe to mix with manual `ipcMain.removeHandler()` in `onStop()` — double-remove is a no-op.

### Phase Behavior

`this.ipcHandle()` and `this.ipcOn()` work in any phase (`BeforeReady`, `WhenReady`, `Background`). The helpers are thin wrappers around `ipcMain` — the phase system controls *when* `onInit()` runs (and thus when handlers get registered), not whether the registration API is available.

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
