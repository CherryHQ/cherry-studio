# Lifecycle Decision Guide

**Lifecycle manages resources, not logic.** Being named "Service" does not mean it belongs here. The question is: does it **own resources or side effects that outlive a single method call and need cleanup on shutdown**?

## Use Lifecycle if (either condition)

**1. Owns long-lived resources** — created at init, survive across calls, need explicit cleanup:

| Category              | Examples                                                 |
| --------------------- | -------------------------------------------------------- |
| DB connections        | SQLite / LibSQL, Drizzle ORM                             |
| Network services      | HTTP server, mDNS browser, WebSocket server              |
| Native / OS resources | `SelectionHook` (system thread), `Tray`, `BrowserWindow` |
| File system           | `chokidar` watcher, Winston DailyRotateFile transport    |
| Timers                | `setInterval` (GC, polling)                              |
| Child processes       | Long-running gateway / worker (not one-shot scripts)     |
| Stateful stores       | In-memory caches needing flush on shutdown               |

**2. Registers persistent side effects** — modifies global state at init, persists for lifetime, needs undo:

| Category             | Examples                                                           |
| -------------------- | ------------------------------------------------------------------ |
| Event listeners      | `nativeTheme.on()`, `powerMonitor.on()`, `autoUpdater.on()`        |
| Global shortcuts     | `globalShortcut.register()`                                        |
| Subscriptions        | `preferenceService.subscribeChange()`, `configManager.subscribe()` |
| Session interceptors | `session.webRequest.onHeadersReceived()`                           |
| IPC handlers         | `ipcMain.handle()` registration (see below)                        |
| Global API mutations | Monkey-patching global APIs                                        |

#### When should IPC handlers live inside a service?

A lifecycle service should self-contain its IPC handlers when **any** of the following is true:

| Condition | Why |
|-----------|-----|
| Handler accesses service instance state (`this.xxx`) | Handler is coupled to the service's lifecycle — if the service stops, the handler must stop too |
| Service needs `stop()` / `start()` / `restart()` support | Orphaned handlers would reference stale state after restart |
| Handler semantically belongs to the service's domain | Co-location improves maintainability and discoverability |

If the handler is purely stateless (e.g., returns `app.getVersion()`), it does not require lifecycle management.

BaseService provides built-in IPC tracking for self-contained handlers — see [IPC Handler Management](./lifecycle-usage.md#ipc-handler-management).

## Do NOT Use Lifecycle if

- **Stateless orchestration** — calls other services, combines results, owns nothing.
- **DataApi business-logic services** — repositories / data-access wrappers that query `DbService` (e.g. `MessageRepository`, `TopicService`). The DB connection is managed by `DbService`; these just encapsulate queries. Use a direct-import singleton.
- **Request-scoped resources** — resources created and released within a single method call (e.g. S3 connections in `BackupManager.backup()`).
- **No init, no cleanup** — would inherit `BaseService` but never override `onInit()` / `onStop()`.
- **Pure utility** — functions or SDK wrappers with no runtime state.

## Decision Flowchart

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

## Quick Reference

|                         | Lifecycle                                    | Direct-import singleton                        |
| ----------------------- | -------------------------------------------- | ---------------------------------------------- |
| Examples                | `DbService`, `CacheService`, `WindowService` | `ExportService`, `BackupManager`                |
| Long-lived resources    | Yes                                          | No (or request-scoped)                         |
| Persistent side effects | Yes                                          | No                                             |
| `onInit` / `onStop`     | Meaningful                                   | Would be empty                                 |
| Pattern                 | `@Injectable` + `application.get()`          | `export const x = new X()`                     |

## Examples

**Belongs in lifecycle** — owns timer, needs cleanup:

```typescript
@Injectable('CacheService')
export class CacheService extends BaseService {
  private gcTimer: NodeJS.Timeout | null = null

  protected onInit() {
    this.gcTimer = setInterval(() => this.gc(), 600_000)
  }

  protected onStop() {
    clearInterval(this.gcTimer!)
    this.cache.clear()
  }
}
```

**Does NOT belong** — all work inside methods, nothing to clean up:

```typescript
export class ExportService {
  private md = new MarkdownIt()

  async exportToDocx(messages: Message[]) {
    const doc = new Document({ sections: this.buildSections(messages) })
    const buffer = await Packer.toBuffer(doc)
    await dialog.showSaveDialog(/* ... */)
  }
}
export const exportService = new ExportService()
```

## Choosing Between @Conditional, Pausable, and Activatable

Once a service belongs in lifecycle, it may need optional behaviors:

| Scenario | Use | Reason |
|----------|-----|--------|
| Service only runs on specific platform/arch | `@Conditional` | Excluded at boot, zero overhead |
| Service needs temporary suspend/resume (e.g., window inactive) | `Pausable` | Keeps instance and resources, just pauses execution |
| Service always needs IPC, but heavy resources load on demand | `Activatable` | IPC always available, resources allocated only when needed |
| Service has a runtime toggle (preference, feature flag) controlling on/off | `Activatable` | Unified activate/deactivate pattern, even for lightweight resources |
| Service runs unconditionally with all resources | None | Default behavior |

### Decision Flow

```
Does the service need to be entirely excluded on some platforms?
  ├─ Yes, condition is known at boot and immutable
  │     → @Conditional (platform, arch, env var, etc.)
  └─ No
       Does the service have heavy resources OR a runtime toggle controlling on/off?
         ├─ Yes → Activatable
         │     IPC registered in onInit() (always available)
         │     Resources in onActivate()/onDeactivate()
         │     Service decides trigger (preference, event, IPC, etc.)
         └─ No
              Does the service need temporary pause/resume?
                ├─ Yes → Pausable
                └─ No → No extra interface needed
```

### Activatable vs Pausable

| | Activatable | Pausable |
|---|------------|---------|
| Purpose | On-demand resource loading/release | Temporary execution suspension |
| State dimension | Orthogonal to LifecycleState | Changes LifecycleState |
| IPC handlers | Always available (registered in onInit) | Retained while paused (removed on stop) |
| Resources | Not allocated when inactive | Retained while paused |
| Trigger | Service decides (self or external via `application.activate`) | LifecycleManager with cascade |
| Cascade | No cascade | Cascades to dependents |
| Cycles | Supports repeated activate/deactivate | Supports repeated pause/resume |

### When Activatable is NOT appropriate

- **Lightweight resources with no runtime toggle** (Map, simple state that is always needed) — not worth the split, load in `onInit()`
- **No IPC needed when inactive** — consider `@Conditional` to exclude entirely
- **Resources need coordinated release across services** — consider `Pausable` (supports cascade)

## Common Mistakes

1. **Empty hooks** — `extends BaseService` but no `onInit()` / `onStop()` override. If both would be empty, don't use lifecycle.
2. **Request-scoped ≠ long-lived** — `BackupManager` creates S3 connections inside `backup()` and releases on return. That's request-scoped. No lifecycle needed.
3. **"Depends on PreferenceService"** — not a lifecycle concern. Any code can call `application.get('PreferenceService')`. Only register if the service itself owns resources.
4. **Using `@Conditional` for runtime conditions** — `@Conditional` is evaluated once at boot. For conditions that change at runtime (user preferences, events), use `Activatable` instead.
5. **Redundant cross-phase `@DependsOn`** — WhenReady services do not need `@DependsOn('PreferenceService')` or `@DependsOn('DbService')`. Phase ordering is enforced by the container; BeforeReady is always ready before WhenReady starts. Only declare `@DependsOn` for same-phase services.

   ```typescript
   // ❌ Redundant — PreferenceService is BeforeReady, guaranteed ready
   @Injectable('WindowService')
   @ServicePhase(Phase.WhenReady)
   @DependsOn('PreferenceService')   // <-- remove this
   export class WindowService extends BaseService { ... }

   // ✅ Correct — only declare same-phase deps
   @Injectable('AgentBootstrapService')
   @ServicePhase(Phase.WhenReady)
   @DependsOn('ApiServerService')    // ApiServerService is also WhenReady
   export class AgentBootstrapService extends BaseService { ... }
   ```
