# Lifecycle & Application Reference

This is the main entry point for Cherry Studio's service lifecycle and application orchestration documentation. The lifecycle system provides IoC container management, phased bootstrap, and service lifecycle control.

## Quick Navigation

### System Overview (Architecture)
- [Lifecycle Overview](./lifecycle-overview.md) - Phases, hooks, states, events, parallel initialization
- [Application Overview](./application-overview.md) - Bootstrap/shutdown orchestration, service registry, runtime control

### Usage Guide (Code Examples)
- [Lifecycle Usage](./lifecycle-usage.md) - Decorators, error handling, conditional activation, pause/resume

### Reference Guides (Standards)
- [Lifecycle Decision Guide](./lifecycle-decision-guide.md) - "Should I use lifecycle?" decision framework
- [Lifecycle Migration Guide](./lifecycle-migration-guide.md) - Converting old service patterns to lifecycle

### Testing
- [Test Mocks](../../../tests/__mocks__/README.md) - Unified mocks for lifecycle services

---

## Choosing the Right Pattern

### Quick Decision Table

|                         | Lifecycle                                    | Direct-import singleton                        |
| ----------------------- | -------------------------------------------- | ---------------------------------------------- |
| Examples                | `DbService`, `CacheService`, `MainWindowService` | `ExportService`, `BackupManager`, `OcrService` |
| Long-lived resources    | Yes                                          | No (or request-scoped)                         |
| Persistent side effects | Yes                                          | No                                             |
| `onInit` / `onStop`     | Meaningful                                   | Would be empty                                 |
| Pattern                 | `@Injectable` + `application.get()`          | `export const x = new X()`                     |

### Decision Flowchart

```
    ┌───────────────────────────────────┐
    │ Owns long-lived resources?        │
    │ (connections, timers, native      │
    │  modules, servers, processes)     │
    └─────┬────────────────┬────────────┘
      yes │                │ no
          ▼                ▼
   ┌───────────┐  ┌──────────────────────────┐
   │ Lifecycle │  │ Registers persistent     │
   └───────────┘  │ side effects?            │
                  │ (listeners, shortcuts,   │
                  │  subscriptions, etc.)    │
                  └─────┬───────────┬────────┘
                    yes │           │ no
                        ▼           ▼
                 ┌───────────┐ ┌────────────────┐
                 │ Lifecycle │ │ Direct-import  │
                 └───────────┘ │ singleton      │
                               └────────────────┘
```

For the full decision framework with examples, condition tables, and common mistakes, see [Lifecycle Decision Guide](./lifecycle-decision-guide.md).

---

## Cross-Phase Dependencies Are Automatic

WhenReady services do **not** need to `@DependsOn` BeforeReady services (`PreferenceService`, `DbService`, `CacheService`, `DataApiService`). The lifecycle container guarantees BeforeReady completes before any WhenReady service starts. Declaring these dependencies is redundant, creates misleading noise in the dependency graph, and may confuse future readers about same-phase coupling. **Only use `@DependsOn` for services within the same phase, or for WhenReady → WhenReady dependencies.**

See [Dependency Rules](./lifecycle-overview.md#dependency-rules) for the full matrix and [Common Mistakes](./lifecycle-decision-guide.md#common-mistakes) for a code-level example.

---

## Common Anti-patterns

| Wrong Choice                                                                       | Why It's Wrong                                                                                                    | Correct Choice                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Using lifecycle for `ExportService`                                                | No `onInit`/`onStop` needed — all work is method-scoped                                                           | **Direct-import singleton**                                             |
| Using lifecycle for `MessageRepository`                                            | Just wraps DB queries; the DB connection belongs to `DbService`                                                   | **Direct-import singleton**                                             |
| Using direct-import for `CacheService`                                             | Owns a GC timer that needs cleanup on shutdown                                                                    | **Lifecycle**                                                           |
| Manual `getInstance()` singleton                                                   | Lifecycle container manages singletons automatically                                                              | **`@Injectable` + `application.get()`**                                 |
| Calling `application.get()` at module scope                                        | Runs before bootstrap — service not yet registered                                                                | **Call inside `onInit()` or methods**                                   |
| Redundant `@DependsOn` on cross-phase deps (e.g. WhenReady → `PreferenceService`)  | BeforeReady phase is guaranteed to finish before WhenReady starts — declaration is noise and mis-signals coupling | **Omit `@DependsOn` for cross-phase deps; only declare same-phase deps** |

---

## Related Source Code

### Core Infrastructure
- `src/main/core/lifecycle/` — IoC container, service lifecycle management
- `src/main/core/application/` — Application singleton, service registry, bootstrap orchestration

### Service Implementations
- `src/main/services/` — Business services registered in the lifecycle system
- `src/main/data/` — Data layer services (Cache, Preference, DataApi)
