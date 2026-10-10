---
description: The window.cherry API method by method — signatures, return shapes, the seven error names, quotas and rate limits
sources:
  - src/main/features/miniApp/runtime/bridge.ts
  - src/main/features/miniApp/capabilities
  - src/main/features/miniApp/capabilities/quota.ts
  - src/preload/miniAppBridge.ts
  - src/shared/ipc/schemas/miniAppBridge.ts
---

# Capabilities

Everything the host offers is on `window.cherry`. Types are in [`cherry.d.ts`](./cherry.d.ts).

## Conventions

| Convention | Detail |
|---|---|
| Every method returns a Promise | Including argument errors: `cherry.storage.set(k, v).catch(...)` sees them. `cherry.on` is the one synchronous call |
| Binary is base64 | `file.save` / `file.load` data and `network.fetch` request and response bodies. There are no `Blob`, `ArrayBuffer` or stream parameters |
| Errors are `{ name, message }` | A plain object, not an `Error` instance: `instanceof Error` is false and there is no `stack`. `name` is one of seven fixed strings; branch on it, never on `message`. No host paths |
| Limits are enforced twice | Cheap length caps run in the page before the call crosses to the host; the host re-validates everything. Both reject with `InvalidArgument` |
| Nothing is confirmed at runtime | A granted method runs without a prompt. A missing grant rejects immediately with `PermissionDenied` |

### Errors

| `name` | When |
|---|---|
| `PermissionDenied` | The method is not granted, or `network.fetch` was given a URL outside the declared hosts |
| `QuotaExceeded` | A byte or item budget would be exceeded (storage file, file sandbox, request or response body) |
| `RateLimited` | Too many writes, notifications, AI calls or requests in the window; too many in flight. Wait, then retry — **except** when the message says a background budget is exhausted, which waiting never refills: that one comes back when the user opens your app again |
| `Unavailable` | The host cannot serve the call right now: the app is being updated, rolled back, reinstalled, cleared or uninstalled, a remote request timed out or failed — an `ai.chat` stream the model host could not complete included — `ai.*` found no model configured for the requested slot and no global default, or your save file exists but could not be read |
| `InvalidArgument` | Argument validation failed, an unknown method, or `ai.chat` reused a `callId` that is still in flight |
| `Cancelled` | An `ai.chat` stream was aborted and the abort surfaced as an error |
| `Internal` | Anything else. The message is always `Internal error` |

```js
try {
  await cherry.storage.set('save', data)
} catch (e) {
  if (e.name === 'QuotaExceeded') showStorageFullDialog()
  // Back off rather than loop: a background budget does not refill on a timer.
  else if (e.name === 'RateLimited') retryLater()
  else throw e
}
```

## `cherry.app`

Environment reads. No permission needed.

| Method | Returns |
|---|---|
| `getInfo()` | `{ appId, version, hostVersion, locale }` — your manifest `version`, the Cherry Studio version, and the UI locale (`zh-CN`, `en-US`, …) |
| `getPermissions()` | `{ [leaf]: boolean }` for every leaf your manifest declares (required and optional). Undeclared methods are absent, not `false` |

There is no `theme` field: use `matchMedia('(prefers-color-scheme: dark)')`, which also reports changes. See [Theming](./theming.md).

## `cherry.ai`

| Method | Gate | Returns |
|---|---|---|
| `chat(params, { onChunk, callId? })` | `ai.chat` | `{ ok: true }` when the stream ends. Text arrives through `onChunk(text)` as plain string deltas |
| `cancel(callId)` | none | `{ ok: true }`. Unknown or finished ids are ignored |
| `getCapabilities({ model? }?)` | sibling of `ai.*` | `{ available: true, reasoning: boolean, contextWindow: number \| null }` for that slot, or `{ available: false }` when it has no usable model |

`params`:

```ts
{
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]  // 1–64 messages, text only
  reasoning?: 'on' | 'off'  // whether a reasoning model may think first; 'off' when omitted
  model?: 'default' | 'quick'  // which of the user's two model slots answers; 'default' when omitted
}
```

Which model answers is the user's choice, never yours: every app has a **default** and a **quick** slot (the same two Cherry keeps globally), each falling back to the global model of that name, and neither is ever revealed. Use `quick` for short, latency-sensitive calls. `getCapabilities({ model })` describes the slot you are about to use — whether it reasons and how large its context is — so you can degrade instead of crash when the user swaps it. A slot the user has left empty, or whose model they deleted, comes back as `{ available: false }` instead of rejecting: check it before calling `chat`, which does reject in that state. There is no image input and no tool calling; `vision` and `tools` are deliberately not reported.

`callId` is your own label for the call. It must be unique among your in-flight calls (reusing one rejects with `InvalidArgument`) and is what `cancel` takes. After `cancel`, no further chunks arrive and the `chat` Promise settles — normally resolving `{ ok: true }`, or rejecting with `Cancelled` when the abort surfaces as an error. Handle both; whatever `onChunk` already delivered stays delivered.

| Limit | Value |
|---|---|
| Messages per call | 64 |
| Total prompt size | 256 KB (262,144 **UTF-8 bytes**) across all `content` — an abuse stop; the model's context window is the real ceiling |
| Output | Not capped by Cherry — the model's own limit applies |
| In flight per app | 2 |
| Calls per minute per app | 60 |
| Calls while hidden | 5 per hidden stretch — see [lifecycle](./lifecycle.md#while-you-are-hidden) |
| `callId` | ≤ 64 characters |

There is no spending budget in tokens or money. Every completed call is attributed to your app in the user's usage ledger; the concurrency and burst limits throttle you while the user is watching, and the background allowance bounds what you can spend while they are not.

```js
let out = ''
await cherry.ai.chat(
  { messages: [{ role: 'user', content: 'Name a color.' }] },
  { onChunk: (t) => (out += t), callId: 'hint-1' }
)
```

## `cherry.storage`

A single JSON save file per app: string keys, string values, persistent, never evicted. The whole file is rewritten on every write, and a write is committed when its Promise resolves.

| Method | Gate | Returns |
|---|---|---|
| `get(key)` | `storage.get` | `{ value: string \| null }` — `null` when absent. A save file that exists but cannot be read rejects `Unavailable` rather than reading as empty, so a retry cannot overwrite it |
| `set(key, value)` | `storage.set` | `{ ok: true }` |
| `delete(key)` | `storage.delete` | `{ ok: true }` — idempotent |
| `keys()` | `storage.keys` | `{ keys: string[] }`, sorted |
| `usage()` | sibling of `storage.*` | `{ bytes, count, bytesLimit, countLimit }`. Unlike `get`, it never rejects: a save file it cannot read is reported at its size on disk with `count: 0`, so a damaged file reads as bytes-without-items rather than as nothing |

| Limit | Value |
|---|---|
| Whole save file | 1 MB (serialized JSON, UTF-8 bytes) |
| Keys | 1,000 |
| Key length | 256 UTF-8 bytes |
| Writes (`set` + `delete`) | 20 per second per app |
| Write volume | 12 MB burst, refilling at 8 MB/s |

There are no multi-key transactions. State that must change together belongs in one key as one JSON string.

## `cherry.file`

A flat namespace of named blobs, separate from `storage`, for larger payloads. Names are logical — there are no directories and no paths.

| Method | Gate | Returns |
|---|---|---|
| `save(name, base64)` | `file.save` | `{ ok: true }`. Overwrites an existing name atomically |
| `load(name)` | `file.load` | `{ data: string \| null }` — base64, `null` when absent |
| `list()` | `file.list` | `{ names: string[] }`, sorted |
| `delete(name)` | `file.delete` | `{ ok: true }` — idempotent |
| `usage()` | sibling of `file.*` | `{ bytes, count, bytesLimit, countLimit }` — decoded bytes |
| `export(name, { suggestedName? }?)` | `file.export` | `{ saved: boolean }` — `false` when the user cancels the save dialog. Nothing is copied if the world moved while that dialog stood open: rejects `InvalidArgument` when the file was deleted meanwhile, `Unavailable` when the app's data was cleared or it was uninstalled |

| Limit | Value |
|---|---|
| Name | 1–128 characters, no `/` or `\`, not `.` or `..` |
| Single file | 10 MB decoded |
| Per app total | 20 MB, 200 files |
| Writes (`save` + `delete`) | 20 per second per app |
| Write volume | 12 MB burst, refilling at 8 MB/s |
| Concurrent loads (all apps) | Bounded; a burst rejects with `RateLimited` — retry shortly |

`data` must be valid base64; a malformed string rejects with `InvalidArgument` rather than being silently repaired.

```js
const bytes = new Uint8Array(await blob.arrayBuffer())
await cherry.file.save('level1.bin', btoa(String.fromCharCode(...bytes)))
```

### Exporting

`export` is the only way a sandbox file reaches the user's disk: the host opens its own save dialog, parented to the window showing your app and titled with your app's name, and copies the file to whatever path the user picks. That path is never returned to you.

| Rule | Value |
|---|---|
| Visibility | Only while the app's pane is visible — a hidden pooled app rejects `PermissionDenied` before any dialog opens. This is the pane's state, not the window's: see [Lifecycle](./lifecycle.md#events) |
| Dialogs | One at a time; a second call while one is open rejects `RateLimited` |
| Rate | 10 per minute per app |
| `suggestedName` | Optional default file name in the dialog, same rules as a logical name; defaults to `name` |
| Unknown `name` | `InvalidArgument` |

Browser downloads (`<a download>`, `URL.createObjectURL` + click) and the File System Access pickers are blocked in the sandbox — see [Sandbox](./sandbox.md).

## `cherry.notification`

| Method | Gate | Returns |
|---|---|---|
| `show({ title, body? })` | `notification.show` | `{ ok: true }` |

| Rule | Value |
|---|---|
| `title` | required, shown truncated to 64 characters |
| `body` | optional, truncated to 256 characters |
| Rate | 5 per minute per app |
| Attribution | The notification is prefixed with your app id and name; you cannot impersonate the host |
| User switch | If the user disabled mini app notifications, the call resolves `ok` and shows nothing |

Notifications are one-way: there is no click event back to the app.

## `cherry.clipboard`

| Method | Gate | Returns |
|---|---|---|
| `read()` | `clipboard.read` | `{ text: string }` — `''` when the clipboard holds no text |
| `write({ text })` | `clipboard.write` | `{ ok: true }` |

Plain text only. Both calls require the app to be **visible and to have keyboard focus**: while the user is typing or clicking elsewhere in Cherry, or while your app sits hidden in the pool, they reject `PermissionDenied`. Focus is the one signal the user gives without a dialog; without it a background app could read what they copied elsewhere or replace what they are about to paste. Call from a click handler and you have it.

| Limit | Value |
|---|---|
| `text` | ≤ 1,048,576 characters; longer rejects `InvalidArgument` |
| Read | Clipped to 1,048,576 characters, never rejected for length |
| Rate | 10 reads and 30 writes per minute per app — a read is one user action, never a poll |

`navigator.clipboard` stays denied. Pasting into your own inputs with the keyboard is a browser behaviour and needs nothing.

## `cherry.network`

| Method | Gate | Returns |
|---|---|---|
| `fetch({ url, method?, headers?, body? })` | `network.fetch` | `{ status, headers, body }` — `body` base64, `headers` lowercase-keyed |

The request is made by the host, not by the page, so it is not subject to CORS. A **non-2xx status is a result**, not a rejection.

| Rule | Value |
|---|---|
| URL | `https://` only, default port only, no IP literals, hostname must be in the manifest's `network` list; ≤ 2048 characters |
| Private addresses | A declared host that resolves to any non-global address — loopback, link-local, RFC 1918, shared address space (`100.64.0.0/10`), multicast, reserved, ULA, or a NAT64 / 6to4 / Teredo prefix, in plain or IPv4-mapped form — is refused (`PermissionDenied`). The check resolves the name once before the connection and Chromium resolves it again for the connection, so an answer that flips in between (DNS rebinding) is not caught — the residual risk of granting `network.fetch`; every call is in the app's activity log either way |
| `method` | `GET` (default), `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` |
| `headers` | ≤ 32; name ≤ 128, value ≤ 4096 characters. `host`, `connection`, `content-length`, `transfer-encoding`, `upgrade`, `origin`, `referer`, `cookie` are **rejected** (`InvalidArgument`), not stripped. `authorization` is allowed |
| Request body | base64, ≤ 1 MB decoded |
| Response body | ≤ 5 MB, else `QuotaExceeded` |
| Redirects | Refused — the call rejects `Unavailable` |
| Timeout | 30 s for the whole exchange, then `Unavailable` |
| Credentials | Never sent. The host's cookies and sessions are not yours |
| Rate | 60 per minute per app, 4 in flight. While hidden, 10 requests per hidden stretch — see [lifecycle](./lifecycle.md#while-you-are-hidden) |

```js
const { status, body } = await cherry.network.fetch({
  url: 'https://api.example.com/scores',
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: btoa(JSON.stringify({ score: 42 }))
})
const json = JSON.parse(atob(body))
```

## `cherry.on`

```ts
const off = cherry.on('app.visibilityChange', ({ visible }) => { ... })
off()
```

| Event | Payload | Fires when |
|---|---|---|
| `app.visibilityChange` | `{ visible: boolean }` | The user switches to or away from the app. Page Visibility does not fire inside the host's keep-alive pool — use this |
| `app.localeChange` | `{ locale: string }` | The user changes the UI language. `navigator.language` does not update — use this |

Both are fire-and-forget: the host does not wait for your handler, and a handler that throws or rejects affects nothing. There is no destroy event, no permission-change event and no theme event — see [Lifecycle](./lifecycle.md).

## Guest-side length caps

These run inside the page before anything is sent, so an oversized payload never leaves your process. They are the same numbers as the host's, expressed in characters:

| Input | Cap |
|---|---|
| `storage` key | 256 |
| `storage` value | 1,048,576 |
| `file` name | 128 |
| `file` data | base64 of 10 MB |
| `ai.chat` messages | 64; each `content` 262,144 |
| `callId` | 64 |
| `network.fetch` url / header count / header name / header value / body | 2048 / 32 / 128 / 4096 / base64 of 1 MB |
| `notification` title / body | 64 / 256 — **truncated**, not rejected |
| `clipboard.write` text | 1,048,576 |
| `file.export` suggestedName | 128 |
