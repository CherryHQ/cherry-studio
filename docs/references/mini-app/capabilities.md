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
| `RateLimited` | Too many writes, notifications, AI calls or requests in the window; too many in flight. Wait, then retry |
| `Unavailable` | The host cannot serve the call right now: the app is being updated, rolled back, reinstalled, cleared or uninstalled, or a remote request timed out or failed |
| `InvalidArgument` | Argument validation failed, an unknown method, or `ai.chat` reused a `callId` that is still in flight |
| `Cancelled` | An `ai.chat` stream was aborted and the abort surfaced as an error |
| `Internal` | Anything else. The message is always `Internal error` |

```js
try {
  await cherry.storage.set('save', data)
} catch (e) {
  if (e.name === 'QuotaExceeded') showStorageFullDialog()
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
| `getCapabilities({ model? }?)` | sibling of `ai.*` | `{ reasoning: boolean, contextWindow: number \| null }` for that slot |

`params`:

```ts
{
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]  // 1–64 messages, text only
  reasoning?: 'on' | 'off'  // whether a reasoning model may think first; 'off' when omitted
  model?: 'default' | 'quick'  // which of the user's two model slots answers; 'default' when omitted
}
```

Which model answers is the user's choice, never yours: every app has a **default** and a **quick** slot (the same two Cherry keeps globally), each falling back to the global model of that name, and neither is ever revealed. Use `quick` for short, latency-sensitive calls. `getCapabilities({ model })` describes the slot you are about to use — whether it reasons and how large its context is — so you can degrade instead of crash when the user swaps it. There is no image input and no tool calling; `vision` and `tools` are deliberately not reported.

`callId` is your own label for the call. It must be unique among your in-flight calls (reusing one rejects with `InvalidArgument`) and is what `cancel` takes. After `cancel`, no further chunks arrive and the `chat` Promise settles — normally resolving `{ ok: true }`, or rejecting with `Cancelled` when the abort surfaces as an error. Handle both; whatever `onChunk` already delivered stays delivered.

| Limit | Value |
|---|---|
| Messages per call | 64 |
| Total prompt size | 256 KB (262,144 **UTF-8 bytes**) across all `content` — an abuse stop; the model's context window is the real ceiling |
| Output | Not capped by Cherry — the model's own limit applies |
| In flight per app | 2 |
| Calls per minute per app | 60 |
| `callId` | ≤ 64 characters |

There is no spending budget. Every completed call is attributed to your app in the user's usage ledger; the concurrency and burst limits are the only throttle.

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
| `get(key)` | `storage.get` | `{ value: string \| null }` — `null` when absent |
| `set(key, value)` | `storage.set` | `{ ok: true }` |
| `delete(key)` | `storage.delete` | `{ ok: true }` — idempotent |
| `keys()` | `storage.keys` | `{ keys: string[] }`, sorted |
| `usage()` | sibling of `storage.*` | `{ bytes, count, bytesLimit, countLimit }` |

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

## `cherry.network`

| Method | Gate | Returns |
|---|---|---|
| `fetch({ url, method?, headers?, body? })` | `network.fetch` | `{ status, headers, body }` — `body` base64, `headers` lowercase-keyed |

The request is made by the host, not by the page, so it is not subject to CORS. A **non-2xx status is a result**, not a rejection.

| Rule | Value |
|---|---|
| URL | `https://` only, default port only, no IP literals, hostname must be in the manifest's `network` list; ≤ 2048 characters |
| `method` | `GET` (default), `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` |
| `headers` | ≤ 32; name ≤ 128, value ≤ 4096 characters. `host`, `connection`, `content-length`, `transfer-encoding`, `upgrade`, `origin`, `referer`, `cookie` are **rejected** (`InvalidArgument`), not stripped. `authorization` is allowed |
| Request body | base64, ≤ 1 MB decoded |
| Response body | ≤ 5 MB, else `QuotaExceeded` |
| Redirects | Refused — the call rejects `Unavailable` |
| Timeout | 30 s for the whole exchange, then `Unavailable` |
| Credentials | Never sent. The host's cookies and sessions are not yours |
| Rate | 60 per minute per app, 4 in flight |

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
