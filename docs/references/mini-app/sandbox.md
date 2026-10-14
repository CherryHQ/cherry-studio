---
description: What a mini app cannot do — blocked Web Storage, default-deny network, CORS on own files, navigation and popups — and what to use instead
sources:
  - src/main/features/miniApp/runtime/network.ts
  - src/main/features/miniApp/runtime/navigation.ts
  - src/main/features/miniApp/runtime/protocol.ts
  - src/main/features/miniApp/runtime/webviewHost.ts
---

# Sandbox

Read this before anything else. A mini app is a web page, but it does not run where a web page usually runs: it has an **opaque origin**, **no network**, and **no browser permissions**. Code that "works fine in Chrome" fails here in ways that look like bugs in your code.

## The environment

| Property | Value |
|---|---|
| URL | `cherry-miniapp://<appId>/<path>`; `/` serves `index.html`, otherwise the path is a file in your package |
| Origin | **Opaque** — CSP `sandbox allow-scripts` is applied to every response. `location.origin` is `"null"` |
| Node / Electron | Absent. `require`, `process`, `ipcRenderer` do not exist; the only host surface is `window.cherry` |
| Content Security Policy | `sandbox allow-scripts; default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'` |
| Network from the page | Every request that is not your own package is cancelled before it leaves the process, regardless of the manifest |
| Chromium permissions | Every permission request (`Notification`, geolocation, camera, microphone, clipboard, MIDI, USB, Bluetooth, screen capture) is denied |

## Blocked, and what to use instead

| You wrote | What happens | Use instead |
|---|---|---|
| `localStorage`, `sessionStorage` | Throws `SecurityError` — opaque origins have no storage | `cherry.storage` |
| `indexedDB.open(...)` | Rejects — same reason | `cherry.file` for blobs, `cherry.storage` for state |
| `document.cookie`, Cache API, `caches.open` | No-op / rejects | `cherry.storage` |
| `fetch('https://api.example.com')`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon` | Blocked by `connect-src 'none'` and by the host's request filter — even for hosts in `manifest.network` | `cherry.network.fetch` (https, declared hosts, request/response ≤ 1 MB / 5 MB) |
| `<script src="https://cdn...">`, `<link href="https://...">`, `<img src="https://...">` | Blocked | Bundle the asset into the package |
| `new Worker(...)`, `SharedWorker`, `navigator.serviceWorker.register` | Blocked | Run on the main thread, or inline the work |
| `<iframe>`, `<embed>`, `<object>` | Blocked (`frame-src 'none'`, `object-src 'none'`) | Render in the page |
| `<webview>` | Denied by the main process, and `webviewTag` is off for your page whatever the host window enables. Not a CSP matter — an Electron `<webview>` is not a browsing context `frame-src` governs, so it would carry neither this page's CSP nor its request filter | Nothing |
| `window.open`, `<a target="_blank">` | Denied — no popup is created | Nothing. There is no "open in browser" in this release |
| `<a download>`, `URL.createObjectURL(blob)` + click, navigating to a download | Cancelled — no save dialog appears | `cherry.file.export` |
| `showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker` | Reject — the File System Access permission is denied | `<input type="file">` to read, `cherry.file.export` to write |
| `location.href = 'https://...'`, `<form action>` | Navigation outside `cherry-miniapp://<appId>/` is cancelled | Navigate within your package only |
| WebRTC (`RTCPeerConnection`) | UDP is blocked and TURN/TCP is routed to a dead proxy — connections never establish | Nothing |
| `Notification.requestPermission()` | Always `denied` | `cherry.notification.show` |
| `navigator.clipboard.*` | Rejects — the clipboard permission is denied | `cherry.clipboard`, while the app has keyboard focus |
| `navigator.language`, `languagechange` | Frozen at load; never updates | `cherry.app.getInfo().locale` and `cherry.on('app.localeChange', ...)` |
| `document.visibilityState`, `visibilitychange` | Never changes while the app sits hidden in the keep-alive pool | `cherry.on('app.visibilityChange', ...)` |
| `beforeunload`, `pagehide`, `unload` | May never fire — the app can be destroyed without notice | Save on every change; see [Lifecycle](./lifecycle.md) |

## What works

| Feature | Notes |
|---|---|
| Inline scripts, `eval`, `new Function` | Allowed by `script-src` |
| WebAssembly | `.wasm` is served as `application/wasm`; `'unsafe-eval'` covers compilation |
| `fetch('./assets/level.json')` | Your own package is fetchable — see below |
| `data:` and `blob:` URLs | For images, media and fonts you generate at runtime (`URL.createObjectURL`) |
| Canvas, WebGL, WebGPU, Web Audio | Standard browser features with no network dependency |
| `history.pushState`, hash routing | Same-origin navigation within the package is allowed |
| `matchMedia('(prefers-color-scheme: dark)')` | Follows the user's Cherry theme, including changes |
| `<input type="file">`, dropping a file onto the page | You get the `File` — contents and name, never a path. Handle `dragover` / `drop` with `preventDefault()` as on any page |
| Pasting into your inputs | The keystroke works; reading the clipboard programmatically is `cherry.clipboard.read` |

## Fetching your own package files

Because the document's origin is opaque, even a request to your own package is cross-origin. The host serves every package response — including 404 and 403 — with `Access-Control-Allow-Origin: *` so that:

- `fetch('./data.json')` resolves;
- a missing file resolves to a `Response` with `status === 404` rather than throwing `TypeError: Failed to fetch`. Check `response.ok`.

Files are served with a content type derived from the extension (`.html`, `.js`, `.css`, `.json`, `.svg`, `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, `.woff2`, `.wasm`); anything else is `application/octet-stream`. Paths are resolved inside the package after following symlinks; anything that escapes is a 403. The host bounds concurrent package reads per app (8 active, 64 queued; the 73rd concurrent request fails), so do not issue hundreds of parallel `fetch` calls for large assets.

`/__cherry/*` is reserved for host assets — today only `/__cherry/theme.css` ([Theming](./theming.md)). A package containing a top-level `__cherry` directory is refused at install.

## Multiple instances

The same app can run in more than one window at once (the user can detach a tab). Each instance is a separate page with its own JavaScript state, but `cherry.storage` and `cherry.file` are shared per app — the last write wins. `callId`s for `cherry.ai` are scoped per instance.

## Keyboard

Every keystroke is yours. While your app has focus, Cherry's own shortcuts — print, save, the global keybindings — do not fire: the host's key relay preload is not loaded for local apps, because a sandboxed preload must be a single bundled file and the capability bridge already occupies that slot. Do not rely on the host answering any key on your behalf, and prefer not to bind the platform-standard combinations users expect Cherry to handle.

## Debugging

DevTools are available on the webview from the host's mini app UI. Blocked requests appear in the Network panel as `(blocked:csp)` or cancelled; the CSP is legible in the response headers of any package file.
