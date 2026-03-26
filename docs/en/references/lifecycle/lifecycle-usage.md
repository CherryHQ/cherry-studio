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
