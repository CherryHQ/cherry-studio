# Lifecycle Module

IoC container + service lifecycle management with phased bootstrap and parallel initialization.

## Quick Start

```typescript
// 1. Define a service with decorators
import { BaseService, Injectable, ServicePhase, DependsOn, Phase } from '@main/core/lifecycle'

@Injectable()
@ServicePhase(Phase.WhenReady)
class DatabaseService extends BaseService {
  protected async onInit() {
    await this.connectToDatabase()
  }

  protected async onDestroy() {
    await this.disconnect()
  }
}

@Injectable()
@DependsOn(['DatabaseService'])
class PreferenceService extends BaseService {
  protected async onInit() {
    // DatabaseService is guaranteed to be ready
    await this.loadPreferences()
  }
}

// 2. Register and bootstrap
const container = ServiceContainer.getInstance()
container.register(DatabaseService)
container.register(PreferenceService)

const manager = LifecycleManager.getInstance()
await manager.startPhase(Phase.BeforeReady)
await app.whenReady()
await manager.startPhase(Phase.WhenReady)
await manager.allReady()

// 3. Access service instance
const db = container.get<DatabaseService>('DatabaseService')
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
Layer 1: [DatabaseService, ConfigService]  <- parallel (no inter-dependency)
Layer 2: [PreferenceService]               <- sequential (depends on layer 1)
Layer 3: [WindowService]                   <- sequential (depends on layer 2)
```

## Decorators

| Decorator | Description | Default |
|-----------|-------------|---------|
| `@Injectable()` | Mark class as injectable singleton service | Required |
| `@ServicePhase(Phase.X)` | Set bootstrap phase | `Phase.WhenReady` |
| `@DependsOn([...])` | Declare dependencies by service name | `[]` |
| `@Priority(n)` | Initialization priority within layer (lower = earlier) | `100` |
| `@ErrorHandling(strategy)` | Error handling strategy | `'graceful'` |
| `@ExcludePlatforms([...])` | Skip service on specified platforms | None excluded |

**Note:** All services are singletons. Attempting to instantiate a service class directly (via `new`) after it has been created will throw an error. Use `container.get('ServiceName')` to access service instances.

## Error Handling Strategies

| Strategy | Behavior |
|----------|----------|
| `graceful` (default) | Log the error and continue bootstrap. |
| `fail-fast` | Throw `ServiceInitError`, abort startup. |
| `custom` | Delegate to `lifecycle:service:error` event listeners. |

```typescript
@Injectable()
@ErrorHandling('fail-fast')
class DatabaseService extends BaseService {
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
@Injectable()
@ExcludePlatforms(['linux'])
class SelectionService extends BaseService { ... }

// Exclude specific platform-architecture combination
@Injectable()
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
@Injectable()
class AnalyticsService extends BaseService {
  protected onAllReady() {
    // Safe to access any service — the entire system is ready
    const userService = container.get('UserService')
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

@Injectable()
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
const manager = LifecycleManager.getInstance()

await manager.stop('HeavyComputeService')    // calls onStop()
await manager.start('HeavyComputeService')   // calls onInit() again
await manager.restart('HeavyComputeService') // stop + start
```

### Cascade Operations

When pausing/stopping a service, all services that depend on it are automatically paused/stopped first. When resuming/starting, dependent services are restored in reverse order.

```typescript
// If PreferenceService depends on DatabaseService:
await manager.stop('DatabaseService')
// → PreferenceService is stopped first, then DatabaseService

await manager.start('DatabaseService')
// → DatabaseService is started first, then PreferenceService
```

**Important**: For pause/resume, ALL services in the cascade chain must implement `Pausable`. If any dependent service doesn't, the operation is aborted with an error log.

## Lifecycle Events

Listen to lifecycle events via the `LifecycleManager` (extends `EventEmitter`):

```typescript
import { LifecycleEvents } from '@main/core/lifecycle'

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
