# Application

Application is the top-level orchestrator that ties together the lifecycle system and the Electron app. It is the single entry point for bootstrapping, shutting down, and controlling services at runtime.

## Relationship to Lifecycle

```
Application          — "what to do" (register services, bootstrap, shutdown, runtime control)
  └── lifecycle/     — "how to do it" (IoC container, dependency resolution, state machine)
```

Application does not duplicate lifecycle logic. It delegates to `ServiceContainer` and `LifecycleManager` internally, while providing a clean, app-level API.

For lifecycle internals (phases, hooks, states, decorators, events) and a step-by-step guide to migrating old services, see [Lifecycle README](../lifecycle/README.md).

## Quick Start

```typescript
import { application } from '@main/core/application'
import { serviceList } from '@main/core/application'

// 1. Register all services
application.registerAll(serviceList)

// 2. Bootstrap (handles all three phases + Electron lifecycle)
await application.bootstrap()

// 3. Access a service
const dbService = application.get('DbService')
```

## Bootstrap Flow

`application.bootstrap()` orchestrates the full startup sequence:

```
setupSignalHandlers()                    ← SIGINT/SIGTERM → graceful shutdown
    │
    ├── startPhase(Background)           ← fire-and-forget (non-blocking)
    │
    ├── startPhase(BeforeReady)  ─┐
    │                             ├──── run in parallel
    └── app.whenReady()          ─┘
            │
            ├── setupElectronHandlers()  ← activate, window-all-closed, before-quit
            │
            ├── startPhase(WhenReady)    ← services requiring Electron API
            │
            ├── await Background         ← ensure background services finished
            │
            └── allReady()               ← notify all services the system is fully ready
```

If a `fail-fast` service throws during bootstrap, a dialog is shown offering Exit or Restart.

## Shutdown Flow

`application.shutdown()` is called automatically on:
- `before-quit` (Electron event)
- `SIGINT` / `SIGTERM` (with 5-second force-exit timeout)
- `window-all-closed` (non-macOS)

```
shutdown()
    ├── stopAll()      ← onStop() in reverse initialization order
    └── destroyAll()   ← onDestroy() in reverse initialization order
```

## Service Registry

Services are registered in `serviceRegistry.ts`. Adding a service is one line:

```typescript
// serviceRegistry.ts
import { NewService } from '@main/services/NewService'

export const services = {
  // ... existing services
  NewService,    // ← add one line, types are auto-derived
} as const
```

This gives you type-safe access via `application.get('NewService')`.

## Service Access Rules

Services managed by the lifecycle system must **not** export singleton instances. The service CLASS is exported for type references only (e.g., `ServiceRegistry`, `@DependsOn`). All runtime access goes through `application.get()`.

### Assign to a local variable before use

Do **not** chain `application.get('...')` with method calls directly. Assign the service to a local variable first, then use it:

```typescript
// ✗ BAD: chained calls
application.get('PreferenceService').get('app.zoom_factor')
application.get('PreferenceService').set('app.zoom_factor', 1)

// ✓ GOOD: assign first, then use
const preferenceService = application.get('PreferenceService')
preferenceService.get('app.zoom_factor')
preferenceService.set('app.zoom_factor', 1)
```

This improves readability, avoids repeated container lookups, and makes the code easier to refactor.

## Runtime Service Control

Control individual services at runtime without restarting the app:

```typescript
// Stop a service (cascades to dependents)
await application.stopService('HeavyComputeService')

// Start a stopped service (re-runs onInit, cascades to dependents)
await application.startService('HeavyComputeService')

// Restart = stop + start
await application.restartService('HeavyComputeService')

// Pause/Resume (service must implement Pausable interface)
await application.pauseService('RealTimeService')
await application.resumeService('RealTimeService')
```

All operations cascade through the dependency graph automatically.

## The `application` Proxy

The exported `application` constant is a lazy proxy — safe to import at module top level before `bootstrap()` is called. The actual `Application` instance is created on first property access.

```typescript
// Safe to import anywhere, even at module scope
import { application } from '@main/core/application'
```

## File Structure

```
application/
├── Application.ts      # Application singleton + lazy proxy
├── serviceRegistry.ts  # Central service registry (add services here)
└── index.ts            # Barrel export
```
