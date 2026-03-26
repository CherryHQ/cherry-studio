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
| Global API mutations | Monkey-patching `ipcMain.handle`                                   |

> `ipcMain.handle()` alone does **not** qualify — Electron auto-cleans IPC handlers on exit. Only qualifies if the handler holds stateful resources or the service needs `stop()` / `start()`.

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
| Examples                | `DbService`, `CacheService`, `WindowService` | `ExportService`, `BackupManager`, `OcrService` |
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

## Common Mistakes

1. **Empty hooks** — `extends BaseService` but no `onInit()` / `onStop()` override. If both would be empty, don't use lifecycle.
2. **Request-scoped ≠ long-lived** — `BackupManager` creates S3 connections inside `backup()` and releases on return. That's request-scoped. No lifecycle needed.
3. **"Depends on PreferenceService"** — not a lifecycle concern. Any code can call `application.get('PreferenceService')`. Only register if the service itself owns resources.
