# IpcApi Overview

## Paradigm Split — Why IpcApi Is Independent of DataApi

IPC / RPC / REST are layered, not rival:

| Layer | Concept | This project |
|---|---|---|
| Transport | **IPC** (Electron `ipcMain`/`ipcRenderer`) — moves bytes across processes | DataApi + IpcApi **share** it |
| Paradigm | **REST** (resource-oriented) vs **RPC** (capability-oriented) | DataApi = REST; IpcApi = RPC |

| Dimension | DataApi | IpcApi |
|---|---|---|
| Paradigm | REST / resource | RPC / capability |
| Addressing | `path` + HTTP method | `namespace.action` dot snake |
| Side effects | forbidden (pure data) | the point (window/system/shell/external/file) |
| Future | may become a remote server | always local, bound to main |
| Retry | idempotent reads may retry | commands default to no retry |
| Errors | HTTP status | RPC error `code` (string) |

DataApi deliberately rejects RPC semantics and side effects to keep "swap in a real remote server" possible. System/command IPC therefore needs a **separate channel with explicit RPC semantics** — IpcApi.

**Independent implementation, not a shared kernel.** IpcApi borrows DataApi's *ideas* (single-point schema, compile-time exhaustiveness, one channel, Disposable cleanup) but shares no code: DataApi's `ApiServer` (path matching + HTTP-status inference + middleware) and `DataApiError` (HTTP mapping) are REST-shaped and unneeded. IpcApi is a flat `route → { input, output }` map with pure key routing — `IpcRouter.dispatch` (~12 lines), `IpcHandlersFor` (~5-line mapped type), `IpcError` (~40 lines). Same idea, different implementation.

## Why Narrow the Surface — Fewer Channels, Full Types

IpcApi deliberately **narrows** what renderer→main IPC can be: only routes declared in `ipcRequestSchemas` exist, instead of any channel a service adds ad-hoc. The narrowing is the feature, not a restriction.

| | Before (legacy IPC) | After (IpcApi) |
|---|---|---|
| Channel source | any service hand-adds `ipcMain.handle`/`ipcOn` + hand-written preload | only what's declared in `ipcRequestSchemas` |
| Types | loose, hand-aligned across three files | one schema drives route + input + output, end to end |
| Enumerability | scattered across services, no single list | `handlers/index.ts` — one auditable capability list |

In practice this is a net convenience, not a constraint:

- **Full type-checking** — routes autocomplete; a wrong route, input, or output is a compile error; schema drift fails the build.
- **One cheat sheet** — `IpcRoute` / `handlers/index.ts` is the discoverable list of everything the renderer can call (see [Direction Cheat Sheet](#direction-cheat-sheet)).
- **Auditable** — one place to confirm the exposure surface was neither widened nor dropped (see the migration guide's exposure audit).

The trade is deliberate: give up the freedom to add arbitrary channels, gain full types, single-point discoverability, and auditability. Narrowing is the norm; the rare channel that may stay out is a single-digit, controlled exception (see [escape hatch](./ipc-migration-guide.md)).

## Layering

```
 Renderer                         Preload              Main
 ─────────────────────────────────────────────────────────────────────
 ipcApi.request('window.x', in)   window.api.ipcApi    IpcApiService
   │ route∈IpcRoute, in/out typed   │ single channel      │ IpcRouter.dispatch
   └──────────────────────────────►│── IpcApi_Request ──►│ validateSender + parse + dispatch
                                    │◄─ {ok,data}|{ok:false,error} ┤ structured result (never reject)
 useIpcOn('window.resized', cb)    │◄─ IpcApi_Event ─────┤ IpcApiService.broadcast/send
```

- **schema layer** (`src/shared/ipc/schemas/`): per-domain files, each split into a Request block (zod values, single source of truth) and an Event block (pure types).
- **transport**: two channels — `IpcApi_Request` (R→M) and `IpcApi_Event` (M→R).
- **main**: `IpcApiService` = `IpcRouter` (request dispatch) + `broadcast`/`send` (events) + per-domain handlers. Send and receive are unified in one service.
- **preload**: one generic forwarder (collapses the hand-written object).
- **renderer**: key-style typed facade `ipcApi.request` (like `useQuery`) + `ipcApi.on` / `useIpcOn`.

## Two Orthogonal Axes

IpcApi carries two flows (R→M requests, M→R events) handled along two independent axes:

| Axis | Request | Event |
|---|---|---|
| **Organization** (dirs/objects/files) | unified — same `IpcApiService` receives requests and sends events; one `schemas/<domain>.ts` holds both blocks | same |
| **Runtime validation** (trust boundary) | renderer→main crosses into the privileged side → **untrusted → zod `parse`** | main→renderer built by the TCB → **trusted → pure types, no parse** |

This projects the trust asymmetry into schema shape: **requests are zod values** (with validators), **events are pure types** (no validator). The shape difference *is* the trust boundary, but both still aggregate by domain in one subsystem.

## Trust Boundary — Why Events Are Not Validated

A renderer-received event payload is constructed by main (the TCB) itself; validating it buys no security. So events are pure types (compile-time correctness only), no runtime `parse`. Requests must `parse` because renderer→main crosses into the privileged side and is untrusted. The asymmetry is decided by the trust boundary, not by direction magic.

**Caveat — types ≠ semantic validity.** "No `parse`" settles *security*, not *correctness*. A type-correct payload can still be business-invalid: a number out of range, a string that isn't a real enum member, two fields that break an invariant. The same gap applies to a request's `output`, which the router never `parse`s either (only `input` is). Outbound validity is the **emitter's** responsibility at the construction site — build payloads from statically-typed values, and validate-at-ingestion when data originates from an untrusted upstream (e.g. a MiniApp reply laundered through main) — not the transport layer's. This is deliberate, so read "no `parse`" as "no validity risk *owned by transport*", not "no validity risk".

## Direction Cheat Sheet

The two directions are two independent registries — look them up by direction:

| Direction | Lookup | Holds |
|---|---|---|
| **R→M** (renderer calls main) | `IpcRoute` (`keyof IpcRequestSchemas`) + `handlers/index.ts` | every request route |
| **M→R** (main pushes renderer) | `IpcEventName` (`keyof IpcEventSchemas`) | every event name |
| **Outside IpcApi** | migration guide's [Not In Scope](./ipc-migration-guide.md) table + Preference / Cache / DataApi subsystems | escape-hatch carve-outs (`Tab_MoveWindow`), `Preference_Changed`, `Cache_Sync`, DataApi subscribe |

Point at the unions — never hand-copy a route list into docs, it drifts. Both unions are `never` until a domain is migrated, and grow per migration.

## No One-Way R→M Primitive

IpcApi provides **no** one-way renderer→main primitive (no `ipcMain.on` equivalent). Every R→M call is `invoke`/`handle` (request/response), because R→M must validate the sender and return a structured error — both need the reply leg.

A void route still rides `invoke`: `output: z.void()` drops the return *value*, not the round-trip. To issue an R→M command without reading the result, call `ipcApi.request(...)` and don't await it — the reply is still produced and discarded.

The rare channel that genuinely needs true fire-and-forget (high-frequency, per-frame R→M) gets no primitive — it leaves IpcApi via the [escape hatch](./ipc-migration-guide.md). Today exactly one channel qualifies.

## Caller Identity — `IpcContext`

`dispatch` passes a handler a second argument beyond `input`: a controlled `IpcContext` exposing **only** the caller window id, never the raw `WebContents`/`event`.

```ts
export type WindowId = string // WindowManager UUID; same id across senderId / send(windowId) / getWindow
export interface IpcContext {
  senderId: WindowId | null
}
```

Caller identity **must** be derived by main from the real `event.sender` (`WindowManager.getWindowIdByWebContents`). It is never put in `input` — a renderer could forge a window id and operate another window (privilege escalation). Continuous push-back to the caller (streams) does **not** go through `ctx`; a service holds a listener registry and directs `send` by topic.

**`senderId: null` semantics.** `null` means the caller passed the source-trust gate (`validateSender`) but is **not a managed WindowManager window**. `validateSender` (frame-URL allowlist) and `senderId` (WindowManager registry) are two independent trust sources that are not cross-checked — so a side-effecting handler must **decide how to treat `senderId: null`** (refuse, or fall back to a non-window-scoped path) rather than assume a window is present. Today no trusted-but-unmanaged window reaches a sensitive route, but that is held by per-window configuration, not by a check here; new side-effecting routes should gate on `senderId` explicitly.

> DataApi handlers have no caller-window concept (it must be remotable). IpcApi has `IpcContext` precisely because it is local and bound to main window capabilities — another reason the two cannot merge.

## Error Model

Lightweight `IpcError` (`code: string` + `message` + optional `data`), serialized across IPC. **Not** `DataApiError` (HTTP semantics belong to the remotable data layer). The main side returns a **structured result** — `{ ok: true, data }` or `{ ok: false, error: ipcError.toJSON() }` — and **never throws to `ipcMain.handle`**, because Electron's `invoke` reject keeps only `message` and drops `code`/`data`. The renderer facade unwraps: on `ok: false` it rebuilds an `IpcError` and throws.

The router maps invalid input to `VALIDATION_FAILED` and unknown routes to `ROUTE_NOT_FOUND`; an untrusted sender yields `FORBIDDEN_SENDER`; anything else normalizes to `INTERNAL`.

### Error Codes — `IpcErrorCode`

`IpcErrorCode` (`src/shared/ipc/errors/index.ts`) is the **single source of truth for the framework's own codes** — `ROUTE_NOT_FOUND`, `VALIDATION_FAILED`, `FORBIDDEN_SENDER`, `INTERNAL`. Throw sites reference the const (`IpcErrorCode.VALIDATION_FAILED`), never a bare string literal, so a typo is a compile error rather than a silently miscategorized code.

The `IpcErrorCode` **type** is deliberately open — `(the four literals) | (string & {})`:

- the literals give IDE completion and let `code` narrow when you branch on a known framework code;
- the `(string & {})` tail keeps the set open on purpose: codes are rebuilt verbatim by `IpcError.fromJSON` across the boundary, `IpcError.from` normalizes any unknown throw to `INTERNAL`, and **a migrated domain may mint its own codes**. A closed union would be a lie at the deserialization boundary.

**Producing errors from a handler.** A handler signals a failure the renderer must branch on by `throw`ing an `IpcError` — `IpcApiService` catches it, serializes via `toJSON`, and returns `{ ok: false, error }` (it never reaches `ipcMain.handle`). The four framework codes are **produced by the framework**, not thrown by a handler by hand; a handler that wants to signal a business failure throws a **domain code** instead. Any non-`IpcError` throw (an uncaught bug) is normalized to `INTERNAL` by `IpcError.from`, so it never leaks an arbitrary string as a `code`.

| Situation | What to throw |
|---|---|
| Bad input / unknown route / untrusted sender / unexpected | nothing by hand — the router/service produce `VALIDATION_FAILED` / `ROUTE_NOT_FOUND` / `FORBIDDEN_SENDER` / `INTERNAL` |
| A business failure the renderer must branch on (`FILE_NOT_FOUND`, `MCP_NOT_CONNECTED`, …) | a **domain code** — a `SCREAMING_SNAKE_CASE` string the domain owns; machine-readable detail rides in `data`, human text in `message` |
| Any other unexpected throw | leave it — `IpcError.from` maps it to `INTERNAL` |

**Domain codes — where they live.** A domain that throws its own codes puts them in `@shared/ipc/errors/<domain>.ts` as a `SCREAMING_SNAKE_CASE` `as const` map mirroring `IpcErrorCode`. Both the handler (throw) and the renderer (branch) import that map and reference the constant — never a bare literal — so a typo is a compile error on the side that actually branches. The codes must be stable (the renderer matches on `code` by equality). Two rules pin the placement:

- **Not in `schemas/<domain>.ts`.** The map is a runtime *value* the renderer must read to branch (`e.code === fileErrorCodes.FILE_NOT_FOUND`), but the renderer may only `import type` from `@shared/ipc/schemas` (an ESLint rule keeps zod out of the renderer bundle) — a type-only import yields no runtime value to compare against. So the map lives beside the framework codes under `errors/`, which is value-importable and zod-free. This mirrors why `IpcError`/`IpcErrorCode` live in `errors/`, not `schemas/`.
- **No barrel aggregation.** Unlike `ipcRequestSchemas` / `ipcHandlers` — which the framework consumes as a whole set and checks for exhaustiveness — *nothing* consumes "all error codes at once": `code` is the open `(string & {})`, never dispatched against. Import each domain's map directly from `@shared/ipc/errors/<domain>`; do **not** re-export domain codes through `errors/index.ts`. `errors/index.ts` holds only the framework core (`IpcError`, `IpcErrorCode`, `SerializedIpcError`, `IpcResult`); aggregating domain codes there would re-couple every domain into one shared file and tempt a closed union that fights the open-tail design.

Carry machine-readable detail in `data` (typed, structured-clone-safe), human text in `message` — never string-parse `message`. See [usage](./ipc-usage.md#4-surface-a-typed-error-optional) for a handler-throws + renderer-branches example.

## Lifecycle & Timing

`IpcApiService` is `@ServicePhase(Phase.BeforeReady)` — the command-side peer of `DataApiService`. `onInit` only registers the channel; `application.get(...)` inside the handler/`makeContext` is lazy, so handlers are ready before the first window opens (`Application.ts` runs `Promise.all([startPhase(BeforeReady), app.whenReady()])` before WhenReady, and the first window opens in `MainWindowService.onReady`). No `@DependsOn` or priority needed.

> The runtime `application.get('WindowManager')` inside handlers/`broadcast`/`send` is a new pattern (a BeforeReady service lazily resolving a WhenReady service). It is safe **only inside handler/method bodies** (runtime), never in `constructor`/`onInit`.

## Security — Two Gates

Two orthogonal, both-required gates at the single request entry:

1. **Source trust** (`validateSender`): one channel funnels every capability, so verify the caller first. All web frames (iframes, `<webview>` guests) can send IPC, and this app runs with `webviewTag: true` + `webSecurity: false` + MiniApps loading arbitrary remote URLs. Per Electron's security checklist, the sender is verified: embedded `<webview>` content is rejected by WebContents type; only the **top-level frame** is trusted (a sub-frame such as an embedded `<iframe>` is rejected even if its URL looks app-owned, since `webSecurity:false` lets sub-frames share the renderer); and the frame URL must be the app's own — in production a `file:` path **inside the app bundle root** (`application.getPath('app.root')`), so any other local file (a downloaded/exported HTML opened in an `ipcRenderer`-reachable window) is rejected; in development, exactly the dev-server origin. Remote origins are rejected.
2. **Input validation** (zod `parse`): always on for every request route — input is parsed before the handler runs.

`input` being valid ≠ `sender` being trusted; both gates are necessary. Events (built by the TCB) are pure types, not validated.
