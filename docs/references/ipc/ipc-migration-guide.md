# IpcApi Migration Guide

Stage 0 (the framework) ships alongside legacy IPC. Migration is later work — multiple independent PRs, one domain at a time, until everything is collected and the old machinery is retired.

## Per-Domain Migration (request side)

For each domain, in **one atomic PR** (the four actions must land together, or the build breaks mid-way):

1. Add the domain's `*RequestSchemas` + `*EventSchemas` to `src/shared/ipc/schemas/`.
2. Move the handler logic into `src/main/ipc/handlers/<domain>.ts` (pure function if stateless; otherwise delegate to the existing service via `application.get`). The service keeps its business logic and resource lifecycle; it just stops registering IPC.
3. Delete the old hand-written `preload/index.ts` method(s) for that domain.
4. Switch renderer call sites to `ipcApi.request(...)` / `useIpcOn(...)`, then delete the old `IpcChannel` enum entries.

Each PR is independently revertible.

**Test the handler, not the schema.** `handlers/__tests__/<domain>.test.ts` covers the real behavior (senderId routing, null fallback, delegation). Per-domain schemas are thin contracts locked by compile-time checks plus the one framework type test (`src/shared/ipc/__tests__/schema.types.test.ts`) — do not copy a `schemas/__tests__` template. See [ipc-usage.md](./ipc-usage.md#testing).

## Schema Authoring: Mirroring an Existing Type

When a request input reuses a TS type defined elsewhere (a preference type, a shared model), bind the validating zod schema to that type at the definition with `z.ZodType<X>`, so a drift is a compile error **there** — not in a far-away test:

```ts
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
// repo convention — see uiParts.ts, legacyFileMetadata.ts
const selectionActionItemSchema: z.ZodType<SelectionActionItem> = z.object({ id: z.string() /* …all fields… */ })
```

Two enforcement layers, only the second costs anything:

| Layer | Guarantees |
|---|---|
| Handler contract (`handler → svc.method(x: X)`) | schema covers every **required** field of `X` — free, the handler already passes it |
| `z.ZodType<X>` annotation | **exact** equality (optionals present, no extras) |

Anti-pattern to avoid: a JSDoc `{@link X}` plus a separate `expectTypeOf` test — the import reads as unused and the check drifts away from the definition.

**Lighter alternative.** If the value is opaque pass-through (main forwards it as `initData` and never reads its fields) and the renderer already type-locks the shape, `z.custom<X>()` drops the field mirror at the cost of no runtime field validation. Pick per ROI.

## Return Values: `void` When Meaningless

A legacy handler often `return`s an internal status the caller never reads — e.g. WindowManager's `close`/`minimize` return a "was the window found" boolean, but the preload already typed it `Promise<void>` and every call site ignores it. Declare the route `output: z.void()` in that case. Give a non-void output **only** when a caller actually consumes the value (a query like `window.is_maximized → boolean`, `window.get_init_data → unknown`). The handler may still compute the internal value; the thin adapter just discards it. This keeps the typed surface honest about what callers can rely on.

## Two Service Shapes

| Service kind | Migration form |
|---|---|
| Stateless (app info, fonts) | pure function in `handlers/`, no lifecycle service |
| Stateful (MCP / Knowledge / Window) | handler in `handlers/` delegating to `application.get('XxxService')`; logic + lifecycle stay in the service |

## `BaseService.ipcHandle` / `ipcOn` Removal

These sugar methods are just `ipcMain.handle/on` + `registerDisposable(removeHandler/removeListener)` — no unique capability. After all services are migrated, remove them in a dedicated terminal PR. IPC registration then collapses to two kinds: (1) business → the single IpcApi channel; (2) infrastructure data subsystems (DataApi/Preference/Cache) → their own native `ipcMain.handle` + `registerDisposable`, like DataApi's `IpcAdapter`.

## `IpcChannel` Collapse

As domains migrate, their channel enum entries are deleted. At the end, `src/shared/IpcChannel.ts` is reduced to the IpcApi pair + the infrastructure `DataApi_*`/`Preference_*`/`Cache_*` channels, and moved to `src/shared/ipc/channels.ts`.

## Exposure-Surface Audit

After migration, every main capability the renderer can reach is enumerated in `src/main/ipc/handlers/` — one auditable list. Compare against the deleted scattered `this.ipcHandle` sites to confirm nothing was widened or dropped.

## M→R `send` Work-List

~47 push call sites across ~30 channels, classified by destination:

| Class | Destination | Notes |
|---|---|---|
| **A** typed event (~35, the bulk) | IpcApi `broadcast`/`send` + `useIpcOn` | window lifecycle/state, theme, selection, MCP/adapter notifications, update progress, etc. |
| **B** topic stream (5) | service-held listener + directed `send` | `Ai_StreamChunk`/`_Done`/`_Error`, `File_TreeMutation`; keep 16ms/2048 batching + multi-window attach |
| **C** infrastructure (2) | **not collected** | `Preference_Changed`, `Cache_Sync` — stay in their subsystems |
| **D** special addressing (5) | `ctx.senderId`-based directed `send` | `CherryIN_OAuthResult` ×4 (reply to the initiator window), migration progress |

~40 sites (A+B) move onto the IpcApi event link; only the 2 class-C sites stay out.

### Class examples (before → after)

```ts
// A — typed event (WindowManager_MaximizedChanged): IpcChannel enum + win.webContents.send + preload onXxx + manual removeListener
export type WindowEventSchemas = { 'window.maximized_changed': { maximized: boolean } }
application.get('IpcApiService').send(windowId, 'window.maximized_changed', { maximized: isMax })
useIpcOn('window.maximized_changed', ({ maximized }) => setMax(maximized))

// B — topic stream (Ai_StreamChunk): the service's listener/batching/multi-window attach are unchanged; only "how to send" + ctx.senderId replaces event.sender
export type AiEventSchemas = { 'ai.stream_chunk': { topicId: string; chunk: AiChunk } }
'ai.stream_open': (req, { senderId }) => aiStream.attach(senderId, req.topicId)
// service: for (const id of windowsOf(topicId)) application.get('IpcApiService').send(id, 'ai.stream_chunk', { topicId, chunk })
useIpcOn('ai.stream_chunk', ({ topicId, chunk }) => { if (topicId === current) append(chunk) })

// C — not collected (Preference_Changed / Cache_Sync): keep using the subsystem hooks
const [theme] = usePreference('app.theme')
const [pos] = useSharedCache('scroll.position.x')

// D — special addressing (CherryIN_OAuthResult): reply only to the initiator window
export type CherryinEventSchemas = { 'cherryin.oauth_result': { ok: boolean; apiKeys?: ApiKey[]; error?: string } }
'cherryin.oauth_start': (req, { senderId }) => oauth.begin(req, senderId) // remember initiator WindowId
application.get('IpcApiService').send(savedSenderId, 'cherryin.oauth_result', { ok: true, apiKeys }) // no-op if the window is gone
useIpcOn('cherryin.oauth_result', (r) => (r.ok ? saveKeys(r.apiKeys) : showError(r.error)))
```

### Known inconsistency to fix during collection

`IpcChannel.Notification_OnClick = 'notification:on-click'` (IpcChannel.ts) is unused; the actual push hardcodes `'notification-click'` (MainWindowService.ts / NotificationService.ts) and the renderer listens for the hardcoded string. Unify into a typed event when collecting the notification domain.

## Not In Scope For IpcApi

| Item | Stays in |
|---|---|
| `shell.openExternal`, `webUtils.getPathForFile` (preload calls Electron directly, not IPC) | `window.electron` |
| `preference.onChanged`, `dataApi.subscribe` | their own subsystems |
| `Cache_Sync` "exclude self" (uses numeric `BrowserWindow.id`) | Cache subsystem |
