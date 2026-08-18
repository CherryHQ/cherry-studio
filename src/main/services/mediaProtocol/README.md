# mediaProtocol

Serves in-memory binary media to renderer processes over the custom `cherry-media://` scheme, so a renderer can read large bytes the main process already holds without an IPC copy or a temp file on disk.

The first consumer is the screenshot overlay: each display's full-screen capture is tens of MB, and the overlay both paints it and re-reads regions of it. Structured-cloning that through IPC, or round-tripping it via disk, costs more than the whole capture.

## URL shape

```
cherry-media://<kind>/<id>
              └ host  └ path
```

One scheme carries every kind, with the kind as the host segment. `protocol.registerSchemesAsPrivileged` may only be called once per process and only before the app is ready, so a per-kind scheme would make every new media type a preboot change; a new kind is instead one entry in `MediaKind`.

An unknown kind is a 400, not a fallthrough to another kind's store — ids are per-kind, so serving `cherry-media://video/<image-id>` would hand out the wrong bytes.

## Module map

| File | Role |
|---|---|
| `types.ts` | `CHERRY_MEDIA_SCHEME`, `MediaKind` + `MEDIA_KINDS`, the internal `MediaEntry` shape |
| `registerSchemes.ts` | `registerMediaSchemes()` — the pre-ready privilege declaration |
| `MediaProtocolService.ts` | the store and the `protocol.handle` responder |
| `index.ts` | barrel — the only import surface for code outside this directory |

## Two-phase registration

Electron splits this in two, and the halves have opposite timing constraints:

| Step | API | When | Caller |
|---|---|---|---|
| Declare privileges | `protocol.registerSchemesAsPrivileged` | before the app is ready — throws afterwards | `main.ts` preboot sequence |
| Install the responder | `protocol.handle` | app-ready only | `MediaProtocolService.onInit` (`Phase.WhenReady`) |

`registerMediaSchemes()` therefore lives in the **top-level synchronous section** of `main.ts`, not inside `startApp()` — `runV2MigrationGate()` awaits `app.whenReady()`, so anything after it is already too late.

Per `core/preboot/README.md` membership criterion 2, this module is *not* in `core/preboot/`: screenshots are a removable capability, so it lives in its nature-home and is invoked from `main.ts` at the right point in the sequence.

## Privileges

| Privilege | Why |
|---|---|
| `standard` | URLs parse with host + path, which is what gives the handler a kind segment to dispatch on |
| `secure` | treated as a secure origin, so the overlay is not blocked from loading it |
| `supportFetchAPI` + `corsEnabled` | consumers `fetch` the bytes into a Blob and render through an object URL; a cross-origin `<img>` drawn into a canvas taints it and export throws `SecurityError`. A `corsEnabled` scheme served through `protocol.handle` needs no `Access-Control-Allow-Origin` header, so the handler sends none |

No `stream` — that is for range-requested audio/video. Add it with the first kind that needs it, not in anticipation.

## Lifetime contract: every `store()` is paired with a `remove()`

Nothing reclaims entries on its own. There is deliberately **no TTL and no sweeper**.

A time-based sweep must first guess how long a session lasts, and a capture session's real duration is unbounded — the user can annotate slowly, or leave a save dialog open indefinitely. Guess low and the image disappears from under a live overlay. Exempting that case means tagging entries as owned vs. unowned, at which point the TTL branch has no real caller: every current consumer is owned.

Leak protection is two deterministic checks instead of a timer:

- the unit test asserting `has()` is `false` for every id once a session ends
- the memory regression check: repeated sessions return to baseline

When a genuinely fire-and-forget consumer appears (store it and never look again), design reclamation for that consumer then.

`onInit` registers `protocol.unhandle` and a store clear as disposables, so process shutdown cannot leave captures resident even if a caller skipped its `remove()`.

## Not the same thing as `services/protocol/ProtocolService`

Two modules with "protocol" in the name, no overlap:

| | `services/protocol/ProtocolService` | this module |
|---|---|---|
| Direction | external → app (the OS hands us a URL) | in-process (a renderer asks us for bytes) |
| Scheme | `cherrystudio://` deep links | `cherry-media://` |
| Electron API | `app.setAsDefaultProtocolClient` + `open-url` / `second-instance` | `protocol.registerSchemesAsPrivileged` + `protocol.handle` |
| Registration timing | after the app is ready is fine | privileges must be declared *before* the app is ready |
| State | pending URLs awaiting a ready renderer | binary entries awaiting a renderer request |

They share only the word. Merging them would put a preboot-timed Chromium scheme registration inside a service whose phase cannot express it.

## API

| Method | Contract |
|---|---|
| `store(kind, data, mimeType)` | stores the buffer, returns its id. Caller owns the lifetime |
| `remove(kind, id)` | drops the entry; returns whether it existed |
| `has(kind, id)` | whether the entry is still stored |
| `getUrl(kind, id)` | the URL a renderer loads |

```typescript
import { MediaKind } from '@main/services/mediaProtocol'

const media = application.get('MediaProtocolService')
const id = media.store(MediaKind.Image, pngBuffer, 'image/png')
const url = media.getUrl(MediaKind.Image, id) // cherry-media://image/<uuid>
// ... when the session that owns it ends:
media.remove(MediaKind.Image, id)
```
