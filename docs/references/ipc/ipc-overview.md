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

## Caller Identity — `IpcContext`

`dispatch` passes a handler a second argument beyond `input`: a controlled `IpcContext` exposing **only** the caller window id, never the raw `WebContents`/`event`.

```ts
export type WindowId = string // WindowManager UUID; same id across senderId / send(windowId) / getWindow
export interface IpcContext {
  senderId: WindowId | null
}
```

Caller identity **must** be derived by main from the real `event.sender` (`WindowManager.getWindowIdByWebContents`). It is never put in `input` — a renderer could forge a window id and operate another window (privilege escalation). Continuous push-back to the caller (streams) does **not** go through `ctx`; a service holds a listener registry and directs `send` by topic.

> DataApi handlers have no caller-window concept (it must be remotable). IpcApi has `IpcContext` precisely because it is local and bound to main window capabilities — another reason the two cannot merge.

## Error Model

Lightweight `IpcError` (`code: string` + `message` + optional `data`), serialized across IPC. **Not** `DataApiError` (HTTP semantics belong to the remotable data layer). The main side returns a **structured result** — `{ ok: true, data }` or `{ ok: false, error: ipcError.toJSON() }` — and **never throws to `ipcMain.handle`**, because Electron's `invoke` reject keeps only `message` and drops `code`/`data`. The renderer facade unwraps: on `ok: false` it rebuilds an `IpcError` and throws.

The router maps invalid input to `VALIDATION_FAILED` and unknown routes to `ROUTE_NOT_FOUND`; an untrusted sender yields `FORBIDDEN_SENDER`; anything else normalizes to `INTERNAL`.

## Lifecycle & Timing

`IpcApiService` is `@ServicePhase(Phase.BeforeReady)` — the command-side peer of `DataApiService`. `onInit` only registers the channel; `application.get(...)` inside the handler/`makeContext` is lazy, so handlers are ready before the first window opens (`Application.ts` runs `Promise.all([startPhase(BeforeReady), app.whenReady()])` before WhenReady, and the first window opens in `MainWindowService.onReady`). No `@DependsOn` or priority needed.

> The runtime `application.get('WindowManager')` inside handlers/`broadcast`/`send` is a new pattern (a BeforeReady service lazily resolving a WhenReady service). It is safe **only inside handler/method bodies** (runtime), never in `constructor`/`onInit`.

## Security — Two Gates

Two orthogonal, both-required gates at the single request entry:

1. **Source trust** (`validateSender`): one channel funnels every capability, so verify the caller first. All web frames (iframes, `<webview>` guests) can send IPC, and this app runs with `webviewTag: true` + `webSecurity: false` + MiniApps loading arbitrary remote URLs. Per Electron's security checklist, the sender is verified: embedded `<webview>` content is rejected by WebContents type; only the **top-level frame** is trusted (a sub-frame such as an embedded `<iframe>` is rejected even if its URL looks app-owned, since `webSecurity:false` lets sub-frames share the renderer); and the frame URL must be the app's own (`file:` in production, the dev-server origin in development). Remote origins are rejected.
2. **Input validation** (zod `parse`): always on for every request route — input is parsed before the handler runs.

`input` being valid ≠ `sender` being trusted; both gates are necessary. Events (built by the TCB) are pure types, not validated.
