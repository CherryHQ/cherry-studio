---
description: Per-domain migration of legacy ipcMain and preload channels into IpcApi schemas, handlers, and renderer call sites
sources:
  - src/shared/ipc/schemas
  - src/main/ipc/handlers
---

# IpcApi Migration Guide

The framework and most domains have shipped alongside the remaining legacy IPC. Use this guide for one of the groups still present in `src/shared/IpcChannel.ts` or for a bare-string legacy channel; migrate one coherent domain at a time until the old machinery can be retired.

## Per-Domain Migration (request side)

For each domain, in **one atomic PR** (the four actions must land together, or the build breaks mid-way):

1. Add the domain's `*RequestSchemas` + `*EventSchemas` to `src/shared/ipc/schemas/`.
2. Move the handler logic into `src/main/ipc/handlers/<domain>.ts` (inline pure function if small and stateless; delegate to a lifecycle service via `application.get`; delegate to a non-lifecycle module via a direct import of its curated entry). The service keeps its business logic and resource lifecycle; it just stops registering IPC.
3. Delete the old hand-written `preload/preload.ts` method(s) for that domain.
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

## Three Capability Shapes

| Capability shape | Migration form |
|---|---|
| Small stateless logic (app info, fonts) | pure function in `handlers/`, no service |
| Lifecycle service (MCP / Knowledge / Window — registered in `serviceRegistry.ts`) | handler in `handlers/` delegating to `application.get('XxxService')`; logic + lifecycle stay in the service |
| Non-lifecycle module (file topic, `printService`, `regionService`) | handler imports the module's curated entry (topic barrel or direct-import singleton) and delegates; never fabricate a lifecycle service to obtain a DI handle |

## `BaseService.ipcHandle` / `ipcOn` Removal

These sugar methods are just `ipcMain.handle/on` + `registerDisposable(removeHandler/removeListener)` — no unique capability. After all services are migrated, remove them in a dedicated terminal PR. IPC registration then collapses to two kinds: (1) business → the single IpcApi channel; (2) infrastructure data subsystems (DataApi/Preference/Cache) → their own native `ipcMain.handle` + `registerDisposable`, like DataApi's `IpcAdapter`.

## `IpcChannel` Collapse

As domains migrate, their channel enum entries are deleted. At the end, `src/shared/IpcChannel.ts` is reduced to the IpcApi pair + the infrastructure `DataApi_*`/`Preference_*`/`Cache_*` channels, and moved to `src/shared/ipc/channels.ts`.

## Exposure-Surface Audit

After migration, every main capability the renderer can reach is enumerated in `src/main/ipc/handlers/` — one auditable list. Compare against the deleted scattered `this.ipcHandle` sites to confirm nothing was widened or dropped.

## M→R migration patterns

Classify each push call site by destination before moving it:

| Class | Destination | Notes |
|---|---|---|
| **A** typed event | IpcApi `broadcast`/`broadcastToType`/`send` + `useIpcOn` | window lifecycle/state, theme, selection, adapter notifications, update progress |
| **B** topic stream | service-held listener + directed `send` | AI streams and `file.tree.mutation`; preserve batching and per-topic attachment |
| **C** infrastructure | **not collected** | `Preference_Changed`, `Cache_Sync`, and `DataApi_DataChanged` stay in their subsystems |
| **D** special addressing | remember `ctx.senderId`, then use directed `send` | OAuth or another async flow that must reply to its initiating window |

### Class examples (before → after)

```ts
// A — typed event: one event contract + directed send + typed subscription
export type WindowEventSchemas = { 'window.maximized_changed': boolean }
application.get('IpcApiService').send(windowId, 'window.maximized_changed', isMax)
useIpcOn('window.maximized_changed', setMax)

// B — topic stream (Ai_StreamChunk): the service's listener/batching/multi-window attach are unchanged; only "how to send" + ctx.senderId replaces event.sender
export type AiEventSchemas = { 'ai.stream.chunk': { topicId: string; chunk: AiChunk } }
'ai.stream.open': (req, { senderId }) => aiStream.attach(senderId, req.topicId)
// service: for (const id of windowsOf(topicId)) application.get('IpcApiService').send(id, 'ai.stream.chunk', { topicId, chunk })
useIpcOn('ai.stream.chunk', ({ topicId, chunk }) => { if (topicId === current) append(chunk) })

// C — not collected (Preference_Changed / Cache_Sync): keep using the subsystem hooks
const [theme] = usePreference('app.theme')
const [pos] = useSharedCache('scroll.position.x')

// D — special addressing (deep-link OAuth result): reply only to the initiator window
export type OAuthEventSchemas = { 'oauth.deep_link_result': { ok: boolean; apiKeys?: ApiKey[]; error?: string } }
'oauth.start_deep_link_flow': (req, { senderId }) => oauth.begin(req, senderId) // remember initiator WindowId
application.get('IpcApiService').send(savedSenderId, 'oauth.deep_link_result', { ok: true, apiKeys }) // no-op if the window is gone
useIpcOn('oauth.deep_link_result', (r) => (r.ok ? saveKeys(r.apiKeys) : showError(r.error)))
```

## Escape Hatch — When a Channel May Stay Out

**Default: every R→M channel goes through IpcApi.** The escape hatch is a rare, last-resort exception — today exactly **one** channel in the whole codebase clears the bar (`Tab_MoveWindow`). It is not a "high-frequency optimization" to reach for; it is opting out of the typed, gated, audited surface, and must be earned.

Two-step test — direction, then frequency:

```
Does this R→M channel go through IpcApi?
├─ M→R?            → never escapes (already one-way send); hot → class B, still in IpcApi
└─ R→M?
   ├─ per-action   → IN IpcApi (request, even void)
   └─ per-frame    → escape candidate → must meet BOTH conditions below
```

**Why M→R never escapes.** Its IpcApi transport is already one-way `webContents.send` (`IpcApiService.send`, `WindowManager.broadcast`) — no reply leg, nothing to escape. A hot M→R stream stays in IpcApi via the class-B pattern (service-held registry + directed `send(windowId)` + batching).

**Why per-frame R→M may escape.** R→M is `invoke`/`handle` (round-trip), so a per-frame channel pays the reply leg every frame, and `await` couples the drag loop to main's tail latency. `Tab_MoveWindow` (rAF-throttled, ~60–120/s, fire-and-forget native window move) is the only per-frame R→M in the repo — the only qualifier.

**Two hard conditions for a carve-out** (or it is a hole, not an exception):

- **Still gated** — register with native `ipcMain.on` + `registerDisposable` + an explicit `validateSender` call (mirroring the explicit gates in DataApi's `IpcAdapter` and the Preference/Cache handlers). Do **not** use the `this.ipcOn` sugar (slated for removal, see above).
- **Still documented** — list it in [Not In Scope](#not-in-scope-for-ipcapi) below. A documented carve-out (like `Cache_Sync`) keeps the one-list exposure audit honest; an undocumented omission breaks it.

**Scope discipline** — an exception is per channel, not per feature:

| Channel | Disposition |
|---|---|
| `Tab_MoveWindow` | **Out** — escape hatch (gated + documented) |
| `Python_ExecutionResponse` / `Python_ExecutionCancel` | Separate — renderer-as-server reverse RPC (request-id correlated, carries error, plus the M→R leg that cancels an in-flight request); IpcApi's main-as-server `request` model doesn't fit, so the whole trio migrates together, on its own |
| `Cache_Sync` | Stays in the Cache subsystem |

## Not In Scope For IpcApi

| Item | Stays in |
|---|---|
| `Tab_MoveWindow` (per-frame R→M drag; native `ipcMain.on` + own `validateSender`) | `SubWindowService` (escape hatch) |
| `shell.openExternal`, `webUtils.getPathForFile` (preload calls Electron directly, not IPC) | `window.electron` |
| `preference.onChanged`, `dataApi.onDataChanged` | their own subsystems |
| `Cache_Sync` / `Cache_SyncBatch` / `Cache_GetAllShared` | Cache subsystem |
| `Python_ExecutionRequest` / `Python_ExecutionResponse` | Python renderer-as-server reverse RPC |
