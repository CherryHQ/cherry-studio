# Lifecycle Module

IoC container + service lifecycle management with phased bootstrap and parallel initialization.

> **Note**: This document covers the lifecycle internals. For the **user-facing API** (registration, bootstrap, service access, runtime control), see [Application README](../application/README.md). Application delegates to lifecycle internally — you should rarely need to use `ServiceContainer` or `LifecycleManager` directly.

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
//    See: src/main/core/application/README.md
import { application } from '@main/core/application'
await application.bootstrap()

// 3. Access service instance
const dbService = application.get('DbService')
```

## Bootstrap Phases

Services are initialized in three phases:

| Phase | Description | Timing | Await |
|-------|-------------|--------|-------|
| `BeforeReady` | Services not requiring Electron API | Before `app.whenReady()` | Yes |
| `Background` | Independent services, fire-and-forget | Immediately | No |
| `WhenReady` | Services requiring Electron API (default) | After `app.whenReady()` | Yes |

**Bootstrap Timeline:**
```
|--Background (fire-and-forget)------------|
|--BeforeReady--------|                    |
|--app.whenReady()--------|               |
                          |--WhenReady--|  |
                                        isBootstrapped = true
                                        |--await Background--|
                                                             |--allReady--|
                                                                          ALL_SERVICES_READY
```

After all three phases complete (including Background), `LifecycleManager.allReady()` calls `onAllReady()` on every initialized service in parallel, then emits `ALL_SERVICES_READY`.

### Dependency Rules

| Phase | Can Depend On | Cannot Depend On |
|-------|---------------|------------------|
| BeforeReady | BeforeReady | Background, WhenReady |
| Background | Background | BeforeReady, WhenReady |
| WhenReady | BeforeReady, WhenReady | Background |

**Invalid dependencies are auto-corrected** with a warning log:
```
[WARN] Service 'X' declared as Background but depends on BeforeReady service 'Y', adjusted to BeforeReady
```

## Parallel Initialization

Services within the same phase that have no inter-dependencies are initialized in parallel:

```
Phase: WhenReady
Layer 1: [DbService, ConfigService]  <- parallel (no inter-dependency)
Layer 2: [PreferenceService]               <- sequential (depends on layer 1)
Layer 3: [WindowService]                   <- sequential (depends on layer 2)
```

## Decorators

| Decorator | Description | Default |
|-----------|-------------|---------|
| `@Injectable('Name')` | Mark class as injectable singleton service. Name is **required** because bundlers mangle class names. Must match the key in `serviceRegistry.ts`. | Required |
| `@ServicePhase(Phase.X)` | Set bootstrap phase | `Phase.WhenReady` |
| `@DependsOn([...])` | Declare dependencies by service name | `[]` |
| `@Priority(n)` | Initialization priority within layer (lower = earlier) | `100` |
| `@ErrorHandling(strategy)` | Error handling strategy | `'graceful'` |
| `@ExcludePlatforms([...])` | Skip service on specified platforms | None excluded |

**Note:** All services are singletons. Attempting to instantiate a service class directly (via `new`) after it has been created will throw an error. Use `application.get('ServiceName')` to access service instances (see [Application README](../application/README.md)).

## Error Handling Strategies

| Strategy | Behavior |
|----------|----------|
| `graceful` (default) | Log the error and continue bootstrap. |
| `fail-fast` | Throw `ServiceInitError`, abort startup. |
| `custom` | Delegate to `lifecycle:service:error` event listeners. |

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

## Lifecycle Hooks

```
Created → Initializing → Ready ⇄ Paused
              ↓            ↓        ↓
           onInit()    onReady() onPause()/onResume()
              ↑           ↓
              │        Stopping → Stopped → Destroyed
              │           ↓           ↓          ↓
              │        onStop()  [restart]   onDestroy()
              └───────────────────────┘

After all phases complete:
  Ready ──── onAllReady() (called once, no state change)
```

### Hook Descriptions

| Hook | When Called | Can Override |
|------|------------|--------------|
| `onInit()` | During initialization (and re-initialization on restart) | Yes |
| `onReady()` | Immediately after `onInit()` completes | Yes |
| `onAllReady()` | Once after ALL services across ALL phases are ready | Yes |
| `onStop()` | When the service is being stopped | Yes |
| `onDestroy()` | Final cleanup, service cannot be reused | Yes |
| `onPause()` | When the service is being paused (requires `Pausable`) | Yes |
| `onResume()` | When the service is being resumed (requires `Pausable`) | Yes |

### onAllReady (System-wide Readiness)

Called once after **all** services across all bootstrap phases have completed initialization. Unlike `onReady()` (which fires when the individual service is ready), `onAllReady()` fires when the entire system is ready — safe to access any service regardless of `@DependsOn` declarations.

```typescript
@Injectable('AnalyticsService')
class AnalyticsService extends BaseService {
  protected onAllReady() {
    // Safe to access any service — the entire system is ready
    const userService = application.get('UserService')
  }
}
```

**Key behaviors:**
- All `onAllReady` hooks run in parallel
- No state transition — the service stays in `Ready` state
- Called at most once per service instance — `restart()` does **not** re-trigger it
- Errors are logged and emitted as `SERVICE_ERROR` but never propagate

### Pause/Resume (Optional)

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

### Stop/Start/Restart

All services support stop/start operations (no special interface needed):

```typescript
import { application } from '@main/core/application'

await application.stopService('HeavyComputeService')    // calls onStop()
await application.startService('HeavyComputeService')   // calls onInit() again
await application.restartService('HeavyComputeService') // stop + start
```

### Cascade Operations

When pausing/stopping a service, all services that depend on it are automatically paused/stopped first. When resuming/starting, dependent services are restored in reverse order.

```typescript
// If PreferenceService depends on DbService:
await application.stopService('DbService')
// → PreferenceService is stopped first, then DbService

await application.startService('DbService')
// → DbService is started first, then PreferenceService
```

**Important**: For pause/resume, ALL services in the cascade chain must implement `Pausable`. If any dependent service doesn't, the operation is aborted with an error log.

## Lifecycle Events (Internal API)

> For most use cases, prefer the `onAllReady()` hook or `application.get()` over raw event listening. These events are primarily for infrastructure code (e.g., diagnostics, logging).

Listen to lifecycle events via the `LifecycleManager` (extends `EventEmitter`):

```typescript
import { LifecycleEvents, LifecycleManager } from '@main/core/lifecycle'

const manager = LifecycleManager.getInstance()

manager.on(LifecycleEvents.SERVICE_READY, (payload) => {
  console.log(`${payload.name} is ready`)
})

manager.on(LifecycleEvents.ALL_SERVICES_READY, () => {
  console.log('All services ready')
})
```

| Event | Payload | Description |
|-------|---------|-------------|
| `SERVICE_INITIALIZING` | `{ name, state }` | Service is starting initialization |
| `SERVICE_READY` | `{ name, state }` | Service completed initialization |
| `SERVICE_PAUSING` | `{ name, state }` | Service is being paused |
| `SERVICE_PAUSED` | `{ name, state }` | Service is paused |
| `SERVICE_RESUMING` | `{ name, state }` | Service is being resumed |
| `SERVICE_RESUMED` | `{ name, state }` | Service is resumed |
| `SERVICE_STOPPING` | `{ name, state }` | Service is being stopped |
| `SERVICE_STOPPED` | `{ name, state }` | Service is stopped |
| `SERVICE_DESTROYED` | `{ name, state }` | Service is destroyed |
| `SERVICE_ERROR` | `{ name, state, error }` | Service encountered an error |
| `ALL_SERVICES_READY` | (none) | All services completed initialization |

## Service States

| State | Description |
|-------|-------------|
| `Created` | Instance created, not initialized |
| `Initializing` | Currently running `onInit()` |
| `Ready` | Fully initialized and operational |
| `Pausing` | Currently running `onPause()` |
| `Paused` | Temporarily suspended |
| `Resuming` | Currently running `onResume()` |
| `Stopping` | Currently running `onStop()` |
| `Stopped` | Stopped, can be restarted via `start()` |
| `Destroyed` | Released, cannot be reused |

## Migrating from Old Service Patterns

This section guides you through converting existing services to the lifecycle system. Existing services typically use one of these patterns — all should be migrated to lifecycle-managed services.

### Old Patterns You'll Encounter

#### Pattern A: Manual Singleton

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

#### Pattern B: Raw `new` Export

```typescript
// OLD — instantiated on import, init called manually
class ThemeService {
  init() { /* ... */ }
}

export const themeService = new ThemeService()
```

#### Pattern C: Free Functions

```typescript
// OLD — module-scoped state + exported function
let accelerator: string | null = null

export function registerShortcuts(mainWindow: BrowserWindow) { /* ... */ }
```

### Step-by-Step Migration

#### Step 1: Extend BaseService and add decorators

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

**Choosing the right phase:**

| Phase | When to use |
|-------|-------------|
| `BeforeReady` | No Electron API needed (DB, config, parsing) |
| `WhenReady` | Needs Electron API: `BrowserWindow`, `Tray`, `screen`, `nativeTheme`, etc. (default) |
| `Background` | Independent, non-blocking work (telemetry, analytics) |

**Choosing error strategy:**

| Strategy | When to use |
|----------|-------------|
| `graceful` | App can function without this service (default) |
| `fail-fast` | App cannot function (database, core config) |

#### Step 2: Remove singleton boilerplate

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

#### Step 3: Register in serviceRegistry.ts

```typescript
// src/main/core/application/serviceRegistry.ts
import { WindowService } from '@main/services/WindowService'

export const services = {
  // ...existing
  WindowService,      // ← one line
} as const
```

#### Step 4: Replace all import sites

Find every file that imports the old singleton and update:

```typescript
// OLD
import { windowService } from '@main/services/WindowService'
windowService.createMainWindow()

// NEW
import { application } from '@main/core/application'
const windowService = application.get('WindowService')
windowService.createMainWindow()
```

#### Step 5: Replace dependencies with `@DependsOn`

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

#### Step 6: Remove manual init/destroy calls from index.ts

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

#### Step 7: Migrate free functions to a service class

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

### Before/After Summary

| Aspect | Before | After |
|--------|--------|-------|
| Singleton | `private static instance` + `getInstance()` | `@Injectable('Name')` — container manages it |
| Init | Manual `init()` called from `index.ts` | `onInit()` — called automatically |
| Cleanup | Manual `destroy()` in `will-quit` handler | `onStop()` / `onDestroy()` — automatic |
| Dependencies | `import { otherService } from '...'` | `@DependsOn([...])` + `application.get()` |
| Access | `import { myService } from '...'` | `application.get('MyService')` |
| Ordering | Manual call order in `index.ts` | `@ServicePhase` + `@DependsOn` + `@Priority` |
| Error handling | try/catch in `index.ts` | `@ErrorHandling('fail-fast' \| 'graceful')` |

### Common Pitfalls

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

## File Structure

```
lifecycle/
├── types.ts              # Phase, LifecycleState, ServiceMetadata, Pausable, errors
├── decorators.ts         # @Injectable, @ServicePhase, @DependsOn, @Priority, etc.
├── BaseService.ts        # Abstract base class with lifecycle hooks
├── ServiceContainer.ts   # IoC container with DI and platform exclusion
├── DependencyResolver.ts # Topological sort, layered parallel resolution
├── LifecycleManager.ts   # Phased bootstrap, shutdown, pause/resume/stop/start
├── index.ts              # Barrel export
└── __tests__/            # Unit tests for all components
```
