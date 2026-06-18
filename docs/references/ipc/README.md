# IpcApi Reference

Entry point for **IpcApi** — Cherry Studio's unified, type-safe channel for RPC-over-IPC: command/capability calls from the renderer into the main process, plus typed main→renderer events.

IpcApi is the **fifth parallel subsystem** alongside BootConfig / Cache / Preference / DataApi. It does **not** absorb any of them — it collects the "business capability IPC" those four cannot cover (window/system/shell/notification/external-service/file commands).

> **Status:** the Stage-0 framework (schema mechanism, `IpcRouter`, `IpcApiService`, preload forwarder, renderer facade, `useIpcOn`) has shipped and coexists with legacy IPC. No business channel is migrated yet; domains are migrated incrementally, one PR per domain (see the migration guide).

## Quick Navigation

- [IpcApi Overview](./ipc-overview.md) — paradigm split (RPC vs REST), surface narrowing + direction cheat sheet, no one-way R→M, layering, the two orthogonal axes, trust boundary, `IpcContext`, error model, security
- [IpcApi Usage](./ipc-usage.md) — add a request (schema + handler), add an event (type + `broadcast`/`send` + `useIpcOn`), three-process end-to-end examples
- [IpcApi Schema Guide](./ipc-schema-guide.md) — route/event naming, `*RequestSchemas`/`*EventSchemas`, `IpcRoute`/`IpcEventName`, ESLint key validation
- [IpcApi Migration Guide](./ipc-migration-guide.md) — collecting scattered `ipcMain.handle`/`this.ipcHandle`/hand-written preload per domain, the `send` work-list, escape hatch (when a channel stays out), exposure-surface audit

## Boundary — When To Use Which Subsystem

| Need | System | API |
|---|---|---|
| Read/write SQLite business data | DataApi | `useQuery` / `useMutation` |
| User setting (syncs across windows) | Preference | `usePreference` |
| Disposable / shared transient state | Cache | `useCache` / `useSharedCache` / `usePersistCache` |
| Pre-lifecycle boot config | BootConfig | `usePreference('BootConfig.*')` |
| **Any other command-style call into main** (window/system/shell/notification/external/file) | **IpcApi** | `ipcApi.request` / `useIpcOn` |

Decision rule: SQLite data → DataApi; user setting → Preference; losable/shared state → Cache; pre-lifecycle config → BootConfig; **everything else, every imperative capability call into main → IpcApi**. Same `BeforeReady` phase does not mean same responsibility — the boundary is responsibility (data/state/config vs command), not phase.

## Naming Quick Reference

| Concept | Identifier |
|---|---|
| Product name | `IpcApi` |
| Channels | `IpcApi_Request` (`ipc-api:request`) / `IpcApi_Event` (`ipc-api:event`) |
| Main coordinator | `IpcApiService` (`request` dispatch + `broadcast`/`send`) |
| Preload bridge | `window.api.ipcApi` (`{ request, on }`) |
| Renderer facade | `ipcApi` (`ipcApi.request('window.set_minimum_size', x)`) + `useIpcOn` |
| Route / event names | dot **snake_case** (`file.read_doc`, `window.resized`); payload fields stay camelCase |
| Request schemas | `*RequestSchemas` → `ipcRequestSchemas` / `IpcRoute` |
| Event contracts (pure types) | `*EventSchemas` → `IpcEventSchemas` / `IpcEventName` |
| Router / handlers / error | `IpcRouter` / `ipcHandlers` / `IpcError` |
| Directories | `src/{shared,main,renderer}/ipc/`, `src/preload/ipc.ts` |

## Source Map

| File | Role |
|---|---|
| `src/shared/ipc/define.ts` | `defineRoute` + `RouteDef` |
| `src/shared/ipc/schemas/index.ts` | `ipcRequestSchemas` / `IpcRoute` / `IpcEventSchemas` / `IpcEventName` |
| `src/shared/ipc/types.ts` | `InputFor` / `OutputFor` / `EventPayload` / `IpcHandlersFor` / `IpcContext` / `WindowId` |
| `src/shared/ipc/errors.ts` | `IpcError` + `SerializedIpcError` |
| `src/main/ipc/IpcRouter.ts` | request router (key lookup + zod parse + dispatch) |
| `src/main/ipc/IpcApiService.ts` | `BeforeReady` coordinator: handler registration + `broadcast`/`send` |
| `src/main/ipc/validateSender.ts` | source-trust gate (`validateSender` / `isTrustedSenderUrl`) |
| `src/main/ipc/handlers/index.ts` | global `ipcHandlers` (exhaustive, the audited exposure surface) |
| `src/preload/ipc.ts` | generic forwarder → `window.api.ipcApi` |
| `src/renderer/ipc/index.ts` | typed facade `ipcApi` |
| `src/renderer/ipc/useIpcOn.ts` | event subscription hook |
