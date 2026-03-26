# Lifecycle Overview

IoC container + service lifecycle management with phased bootstrap and parallel initialization.

> For the **user-facing API** (registration, bootstrap, service access, runtime control), see [Application Overview](./application-overview.md). Application delegates to lifecycle internally — you should rarely need to use `ServiceContainer` or `LifecycleManager` directly.

## Bootstrap Phases

Services are initialized in three phases:

| Phase         | Description                               | Timing                   | Await |
| ------------- | ----------------------------------------- | ------------------------ | ----- |
| `BeforeReady` | Services not requiring Electron API       | Before `app.whenReady()` | Yes   |
| `Background`  | Independent services, fire-and-forget     | Immediately              | No    |
| `WhenReady`   | Services requiring Electron API (default) | After `app.whenReady()`  | Yes   |

### Bootstrap Timeline

```
|--Background (fire-and-forget)------------|
|--BeforeReady--------|                    |
|--app.whenReady()--------|                |
                          |--WhenReady--|  |
                                        isBootstrapped = true
                                        |--await Background--|
                                                             |--allReady--|
                                                                          ALL_SERVICES_READY
```

After all three phases complete (including Background), `LifecycleManager.allReady()` calls `onAllReady()` on every initialized service in parallel, then emits `ALL_SERVICES_READY`.

### Phase Selection Guide

#### How Phases are Bootstrapped

```
1 Background starts (fire-and-forget) ──────────────────────────────────┐
2 BeforeReady starts ──────────┐                                        │
2 app.whenReady() ─────────────┤                                        │
                               ├─ both complete                         │
                               ▼                                        │
3 WhenReady starts ────────────┐                                        │
                               ├─ complete → isBootstrapped = true      │
                               ▼                                        │
4 await Background ◄────────────────────────────────────────────────────┘
5 onAllReady() called on ALL services
   → ALL_SERVICES_READY emitted
```

Key points:
- **BeforeReady** runs in parallel with Electron's own initialization (`app.whenReady()`), providing "free time" — work here doesn't add to startup latency as long as it finishes before Electron is ready.
- **WhenReady** runs only after both BeforeReady and Electron are ready — the only phase where Electron APIs are safe to use.
- **Background** runs completely independently. It does not block any other phase, and no other phase can depend on it.

#### Choosing the Right Phase

```
                    ┌──────────────────────┐
                    │ Does it use Electron │
                    │   APIs directly?     │
                    └──────┬─────────┬─────┘
                       yes │         │ no
                           ▼         ▼
                    ┌───────────┐  ┌───────────────────────────┐
                    │ WhenReady │  │ Is it on the critical     │
                    └───────────┘  │ startup path? (other      │
                                   │ services depend on it)    │
                                   └─────┬──────────┬──────────┘
                                     yes │          │ no
                                         ▼          ▼
                                 ┌─────────────┐ ┌────────────┐
                                 │ BeforeReady │ │ Background │
                                 └─────────────┘ └────────────┘
```

**BeforeReady** — Maximize parallelism with Electron init

- Runs in parallel with `app.whenReady()`, so initialization here is essentially "free" if it completes before Electron is ready.
- Best for: database connections, config loading, data migrations, schema validation — anything that WhenReady services will depend on.
- Cannot use any Electron API (the app is not ready yet).
- Can only depend on other BeforeReady services.

**WhenReady** — The safe default

- Runs after both BeforeReady and `app.whenReady()` have completed.
- Full access to Electron APIs (`BrowserWindow`, `Tray`, `screen`, `nativeTheme`, `dialog`, `globalShortcut`, etc.).
- Can depend on other WhenReady services. No need to `@DependsOn` BeforeReady services — they are guaranteed to be ready before the WhenReady phase starts.
- Best for: window management, tray, system shortcuts, theme management, IPC handlers that need Electron APIs.
- This is the default phase — if you omit `@ServicePhase`, the service is placed here.

**Background** — Fire-and-forget

- Starts immediately but runs completely independently, never blocking other phases.
- Other phases' services **cannot** depend on Background services (and vice versa).
- Background errors are caught and logged but never abort bootstrap.
- Best for: telemetry reporting, analytics init, non-critical data pre-fetching, background cleanup tasks.
- Use `onAllReady()` if a Background service needs to interact with services from other phases after bootstrap.

### Dependency Rules

| Phase       | Can Depend On          | Cannot Depend On       |
| ----------- | ---------------------- | ---------------------- |
| BeforeReady | BeforeReady            | Background, WhenReady  |
| Background  | Background             | BeforeReady, WhenReady |
| WhenReady   | BeforeReady, WhenReady | Background             |

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

| Hook           | When Called                                              | Can Override |
| -------------- | -------------------------------------------------------- | ------------ |
| `onInit()`     | During initialization (and re-initialization on restart) | Yes          |
| `onReady()`    | Immediately after `onInit()` completes                   | Yes          |
| `onAllReady()` | Once after ALL services across ALL phases are ready      | Yes          |
| `onStop()`     | When the service is being stopped                        | Yes          |
| `onDestroy()`  | Final cleanup, service cannot be reused                  | Yes          |
| `onPause()`    | When the service is being paused (requires `Pausable`)   | Yes          |
| `onResume()`   | When the service is being resumed (requires `Pausable`)  | Yes          |

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

## Service States

| State          | Description                             |
| -------------- | --------------------------------------- |
| `Created`      | Instance created, not initialized       |
| `Initializing` | Currently running `onInit()`            |
| `Ready`        | Fully initialized and operational       |
| `Pausing`      | Currently running `onPause()`           |
| `Paused`       | Temporarily suspended                   |
| `Resuming`     | Currently running `onResume()`          |
| `Stopping`     | Currently running `onStop()`            |
| `Stopped`      | Stopped, can be restarted via `start()` |
| `Destroyed`    | Released, cannot be reused              |

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

| Event                  | Payload                  | Description                           |
| ---------------------- | ------------------------ | ------------------------------------- |
| `SERVICE_INITIALIZING` | `{ name, state }`        | Service is starting initialization    |
| `SERVICE_READY`        | `{ name, state }`        | Service completed initialization      |
| `SERVICE_PAUSING`      | `{ name, state }`        | Service is being paused               |
| `SERVICE_PAUSED`       | `{ name, state }`        | Service is paused                     |
| `SERVICE_RESUMING`     | `{ name, state }`        | Service is being resumed              |
| `SERVICE_RESUMED`      | `{ name, state }`        | Service is resumed                    |
| `SERVICE_STOPPING`     | `{ name, state }`        | Service is being stopped              |
| `SERVICE_STOPPED`      | `{ name, state }`        | Service is stopped                    |
| `SERVICE_DESTROYED`    | `{ name, state }`        | Service is destroyed                  |
| `SERVICE_ERROR`        | `{ name, state, error }` | Service encountered an error          |
| `ALL_SERVICES_READY`   | (none)                   | All services completed initialization |

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
