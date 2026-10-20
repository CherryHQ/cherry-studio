---
description: The runtime measurements behind the sandbox — WebRTC escape, Web Storage ceiling, TransformStream terminal callbacks, host-cache reuse — recorded in enough detail to rebuild each probe when Electron moves
sources:
  - src/main/features/miniApp/runtime/network.ts
  - src/main/features/miniApp/runtime/protocol.ts
  - src/main/features/miniApp/runtime/webviewHost.ts
  - src/main/features/miniApp/capabilities/network.ts
---

# Runtime probes

Several sandbox layers rest on **negative** results that cannot be re-derived from code: a CSP directive that does nothing, a proxy mode that does not contain, a stream callback that never fires. Each was established by a throwaway Electron program run against this checkout's Electron. The programs are not kept — this page is the record, written so a probe can be rebuilt in an hour when Electron or Chromium moves a major version.

All figures below: **Electron 41.8.0 / Chrome 146.0.7680.216 / macOS 26.5**. Append a new run under each probe rather than editing these numbers, so a regression reads as a diff.

## When to re-run

| Trigger | Probes |
|---|---|
| Electron or Chromium major bump | WebRTC escape (always with `baseline`), Web Storage ceiling |
| Node major bump inside Electron | TransformStream callbacks |
| Any change to `MINI_APP_PRIVILEGES`, `buildMiniAppCsp()`, `DENY_ALL_PAC` or `installWebRtcPolicy` | WebRTC escape |
| Electron bump that touches `net.resolveHost` (`shell/browser/net/resolve_host_function.cc`) | Host-cache reuse |

## Shared scaffolding

Every probe is a plain CommonJS file run with `node_modules/.bin/electron probe.js`, no build step, and reproduces the production delivery path: a privileged `cherry-miniapp://` scheme, a `persist:miniapp:<appId>` partition, and the CSP attached to every `protocol.handle` response (`protocol.ts` does the same; `network.ts` adds it a second time through `webRequest.onHeadersReceived`).

```js
const { app, BrowserWindow, protocol, session } = require('electron')
protocol.registerSchemesAsPrivileged([{ scheme: 'cherry-miniapp', privileges: {
  standard: true, secure: true, supportFetchAPI: true, bypassCSP: false, allowServiceWorkers: false, corsEnabled: true } }])
// after app.whenReady():
const sess = session.fromPartition('persist:miniapp:com.example.probe')
sess.protocol.handle('cherry-miniapp', (req) => new Response(html, { headers: {
  'content-type': 'text/html', 'access-control-allow-origin': '*',
  'content-security-policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'" } }))
```

Gotchas that each cost real time — read before rebuilding:

| Gotcha | Symptom | Rule |
|---|---|---|
| `protocol.handle('cherry-miniapp:')` | Load fails `ERR_FAILED (-2)`, handler never called | The scheme goes **without** the trailing colon |
| `protocol.handle` twice on one session | Throws, surfacing as `ERR_FAILED` on the **next** window's load | Register once per partition and remember it |
| Result via `window.__result` + `executeJavaScript` | Hangs under `contextIsolation` — isolated worlds do not share `window` | Report through the DOM (`document.getElementById('r').textContent`) or `console-message` |
| `console.log(result)` then `app.exit()` | A completed run prints nothing — stdout to a pipe is async and the buffer is dropped | `fs.writeFileSync` the result, or print early and delay the exit |
| Fetching a plain `http://` target from the guest | Blocked as mixed content on a `secure: true` scheme | Regression targets must be `https://`; add `sess.setCertificateVerifyProc((_r, cb) => cb(0))` for **every** group, or the no-proxy control fails on the certificate and looks like a proxy result |
| Guest fetch of an allowlisted host fails | Opaque-origin document (CSP `sandbox`) makes every request cross-origin | The target must answer `access-control-allow-origin: *`, and CSP `connect-src` must name it — otherwise a blocked fetch proves nothing about the proxy |
| Per-`webContents` policies | `setWebRTCIPHandlingPolicy` before the guest exists does nothing | Apply inside `did-attach-webview`; session-level setup (`setProxy`, awaited) before the webview is created |

## Probe 1 — WebRTC escape (network containment)

**Question.** Can a guest that declares no network open any outbound connection? The first attempt measured ICE candidate count with no TURN server configured, which measures "nothing to gather", not "nothing can connect". The decisive observable is **whether a TCP socket we control is contacted at all**: an outbound connection carrying TURN framing to an undeclared host is already the escape — a relay allocation is not required.

**Setup.**

1. Main: `net.createServer()` on `0.0.0.0:3478` recording each connection's remote address, byte count and first 20 bytes (hex). An `https.createServer` on `8443` answering `ok` with `access-control-allow-origin: *` (self-signed cert generated on the fly; see the certificate gotcha).
2. Guest page (served with the CSP above plus `connect-src https://<LAN_IP>:8443`):

```js
const pc = new RTCPeerConnection({
  iceServers: [{ urls: `turn:${LAN_IP}:3478?transport=tcp`, username: 'probe', credential: 'probe' }],
  iceTransportPolicy: 'relay'   // host/srflx candidates would make "we got candidates" ambiguous
})
pc.createDataChannel('probe')
pc.onicecandidate = (e) => e.candidate && result.candidates.push(e.candidate.candidate)
await pc.setLocalDescription(await pc.createOffer())
// wait for iceGatheringState === 'complete' or 8 s
```

3. Host: hidden `BrowserWindow` with `webviewTag: true`; append a `<webview partition="persist:miniapp:…" src="cherry-miniapp://com.example.probe/index.html">`. In `did-attach-webview`: apply the group's WebRTC policy, wait for load, run the regression `fetch` where the group calls for it, start the guest script, wait 9 s, read the guest result and the listener's hits, print `PROBE_RESULT {…}`, exit. A 30 s timeout prints what it has and exits 1.
4. Pass `--lan=<this machine's LAN IP>`; loopback makes the proxy result meaningless.

**Groups.** The allowlist PAC used by the `pac-*` groups:

```js
function allowlistPac(hosts, portStrict, allowedPort = '443') {
  // PAC's `url` carries the port for non-default ports — the only place a 443 rule can be enforced,
  // because webRequest never sees a TURN connection.
  const portGuard = portStrict
    ? `var m = url.match(/^[a-z]+:\\/\\/[^\\/]*?:(\\d+)/); if (m && m[1] !== "${allowedPort}") return "PROXY 127.0.0.1:1";`
    : ''
  return `function FindProxyForURL(url, host) { ${portGuard}
    if (${JSON.stringify(hosts)}.indexOf(host) !== -1) return "DIRECT"; return "PROXY 127.0.0.1:1"; }`
}
```

| `--group` | WebRTC policy | `session.setProxy` | Allowlist | Regression fetch |
|---|---|---|---|---|
| `baseline` | none | none | — | — |
| `current` | `disable_non_proxied_udp` | `{ mode: 'direct' }` | — | — |
| `pac-blocked` | ↑ | host PAC | `api.allowed.example` (target **not** listed) | — |
| `pac-allowed-port` | ↑ | host PAC | `LAN_IP` | — |
| `pac-regression` | ↑ | host PAC | `LAN_IP` | `https://LAN_IP:8443/ok` |
| `pac-port-strict` | ↑ | port-aware PAC, 443 only | `LAN_IP` | — |
| `pac-port-strict-regression` | ↑ | port-aware PAC, 8443 allowed | `LAN_IP` | `https://LAN_IP:8443/ok` |
| `fetch-control` | ↑ | none | — | `https://LAN_IP:8443/ok` |

The regression variant allows 8443 rather than 443 only because binding 443 needs root; it proves the guard **discriminates by port**, not that it blocks everything.

**Results (2026-08-21).**

| group | TCP hits on 3478 | fetch |
|---|---|---|
| `baseline` | **2** (196 B each) | — |
| `current` | **1** (196 B) | — |
| `pac-blocked` | 0 | — |
| `pac-allowed-port` | **1** (196 B) | — |
| `pac-regression` | 1 | `ok` |
| `pac-port-strict` | **0** | — |
| `pac-port-strict-regression` | **0** | `ok` |

Payloads began `0003 0008 2112a442` — a STUN **Allocate** request (method `0x003`, magic cookie `0x2112A442`): real TURN attempts, not noise. `current`, `pac-allowed-port` and `pac-port-strict` were each run twice with identical results.

**Conclusions, and what shipped.**

| Finding | Consequence in code |
|---|---|
| `disable_non_proxied_udp` + `{ mode: 'direct' }` **leaks**: the policy forbids non-proxied UDP only; TCP on the public interface is explicitly allowed, and `setWebRTCIPHandlingPolicy` + `setWebRTCUDPPortRange` are Electron's whole WebRTC surface | `installWebRtcPolicy` is kept as **half** of the story, never alone (`network.ts`) |
| A host-only PAC turns "HTTPS on 443 to one declared host" into "any port on that host" — a bidirectional channel `webRequest` never sees | No allowlist PAC in production |
| A port-aware PAC closes it and allowlisted traffic still works | Not shipped either: guest traffic goes through `cherry.network.fetch` in the main process, so the session gets `DENY_ALL_PAC` — every URL to `127.0.0.1:1`, the strictly stronger form of the same conclusion. The allowlist groups stay in the probe as the **evidence that killed the allowlist design**, not as a blueprint |
| Neither CSP nor `webRequest` observes a TURN connection; CSP `webrtc 'block'` has no effect; `setPermissionRequestHandler` is never invoked for WebRTC | The proxy is the only layer that can refuse WebRTC, and the only one whose regression this probe detects |

**Controls.** `baseline` is the positive control — without it, "0 hits" everywhere reads as a fix rather than a broken listener. `pac-regression` / `pac-port-strict-regression` are the negative controls — a PAC that blocks everything satisfies every "0 hits" row while breaking the product. `fetch-control` checks the self-signed certificate path on its own. Rebuilding without all three produces numbers that mean nothing.

## Probe 2 — TransformStream terminal callbacks

**Question.** Which `TransformStream` callbacks run on each way a piped stream can end? This decides whether a finalizer attached to a stream (closing a file handle, releasing a read slot, charging a call) can rely on `flush`.

**Setup.** A `TransformStream` counting `transform` / `flush` / `cancel`, fed by a `ReadableStream` that enqueues its parts then either closes or errors, and driven through four terminations. Run once under Node (`node probe.mjs`) and once inside Electron (`app.whenReady().then(…)`, print `process.versions.node`) — the bundled Node may differ.

```js
const counts = { transform: 0, flush: 0, cancel: 0 }
const ts = new TransformStream({
  transform(c, ctrl) { counts.transform++; ctrl.enqueue(c) },
  flush() { counts.flush++ },
  cancel() { counts.cancel++ }
})
const src = (parts, err) => new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(p)); err ? c.error(new Error('boom')) : c.close() } })
// 1 normal:   await src(['a']).pipeThrough(ts).pipeTo(new WritableStream())
// 2 consumer: const r = src(['a','b']).pipeThrough(ts).getReader(); await r.read(); await r.cancel()
// 3 source:   await src(['a'], true).pipeThrough(ts).pipeTo(new WritableStream()).catch(() => {})
// 4 abort:    const ac = new AbortController(); const p = src(['a']).pipeThrough(ts).pipeTo(new WritableStream(), { signal: ac.signal }); ac.abort(); await p.catch(() => {})
// then wait ~50 ms before reading the counts
```

**Results (Node 24.14.0 and Electron 41.8.0 / bundled Node 24.16.0, identical).**

| termination | `transform` | `flush` | `cancel` |
|---|---|---|---|
| normal close after `finish` | 1 | **1** | 0 |
| consumer `reader.cancel()` | 1 | 0 | **1** |
| source `controller.error()` | 0 | 0 | **1** |
| `pipeTo` aborted via `AbortSignal` | 0 | 0 | **1** |

A fifth path — the producer throwing before it returns a stream — creates no `TransformStream` at all and correctly runs nothing.

**Conclusion, and what shipped.** `flush` alone is not enough: all three abnormal paths run only `cancel`. A finalizer must be attached to **both**, guarded by one flag so whichever arrives first wins. `protocol.ts` does exactly that for the package file stream (`flush: finalize, cancel: finalize`; the `cancel` member is missing from the bundled `lib.dom` `Transformer` type and needs a cast). The AI usage ledger deliberately does **not** use this: `billingHook` records a call only at `finish`, so a cancelled call leaves no row — chosen over a budget any app could read back to zero with `chat` + `cancel` (see `capabilities/ai.ts`).

## Probe 3 — Web Storage ceiling

**Question.** How much native Web Storage does a mini app partition get, and is it a per-partition budget or one pool an app can drain out from under the others? This decided whether `cherry.storage` could be dropped in favour of `localStorage` / IndexedDB.

**Setup.** A hidden `BrowserWindow` per partition (`sandbox: true, contextIsolation: true`) served over the scheme above, with or without the production CSP (`sandbox allow-scripts` forces an opaque origin). The guest writes 64 KB chunks into `localStorage` until it throws, **re-reads the last chunk** (a silently dropped write would otherwise read as "the limit is huge"), optionally writes N × 1 MB into IndexedDB, and reports `navigator.storage.estimate()` before and after plus `navigator.storage.persisted()`. Results travel over `console-message` (`RESULT {…}`), which arrived every run where `executeJavaScript` polling across partitions did not. Main also records `fs.statfsSync(userData)` free space.

| `--group` | Runs |
|---|---|
| `single` | plain CSP on `com.example.a`, sandboxed CSP on `com.example.b` |
| `fill` | one partition, 300 MB into IndexedDB — does `quota` drop by roughly what was written? |
| `shared-pool` | estimate on `c` → 400 MB into `hog` → estimate on `d` |

**Results (2026-08-23, `single`).**

| Measure | Value |
|---|---|
| `localStorage` throws `QuotaExceededError` at | **52,363,264 B ≈ 49.9 MiB** (799 × 64 KB); identical across two runs |
| Last chunk read back | 65,536 chars — the writes are real |
| `estimate().quota` on a fresh partition | 36,425,928,704 – 36,442,320,896 B ≈ **33.9 GiB** |
| Free disk at that moment | **33.9 GB** |
| `navigator.storage.persisted()` | **true** — granted automatically on a privileged scheme; nothing is evicted under pressure |
| `estimate().usage` after filling `localStorage` | still **0** — `localStorage` is not counted |

Two unrelated fresh partitions were each promised ~33.9 GiB while the disk held 33.9 GB in total: the same space is promised twice. The ceiling is derived from free disk, not from any per-app budget — a shared pool, oversold.

**The half that did not complete.** The fill-then-remeasure experiment (`fill`, `shared-pool`) never ran cleanly: the second window in one process failed with `ERR_FAILED` (the double-`protocol.handle` gotcha above) and a separate two-partition orchestration died with `SIGTRAP`. The shared-pool conclusion is inferred from the two promises, not measured directly. A rebuild that wants it must run the hog and the observer as **separate Electron processes** on the same `userData`, and must include a **positive control** — an implementation that drops every write also leaves the observer's quota unchanged.

**Consequence in code.** `cherry.storage` and `cherry.file` stay as the only persistence, with quotas the host chooses (`quota.ts`); the CSP `sandbox` directive is the one measured mechanism that denies Web Storage, and its flags propagate into nested contexts (`protocol.ts`).

## Probe 4 — Host-cache reuse for `net.resolveHost`

**Question.** Can the private-address check in `cherry.network.fetch` share its DNS answer with the connection Chromium makes, closing the resolve-then-connect window (DNS rebinding)? `dns.promises.lookup` and Chromium resolve independently. `net.resolveHost` goes through Chromium's own host cache, which floors positive TTLs at 60 s (`net/dns/host_resolver_manager_job.cc`, `kMinimumTTLSeconds`), so a shared entry would pin the connection to the checked answer.

**Setup.** A main-process-only Electron program started with `--log-net-log`: `net.fetch` a control host (a miss is expected), then `net.resolveHost(H)` immediately followed by `net.fetch('https://H/')`. Per request source, the net-log's `HOST_RESOLVER_MANAGER_*` events end in `CREATE_JOB` (a fresh resolution) or `CACHE_HIT`.

**Results (2026-08-26).**

| Request | Net-log key | Outcome |
|---|---|---|
| control `net.fetch('https://www.cloudflare.com/')` | `https://www.cloudflare.com` | `CREATE_JOB` |
| `net.resolveHost('example.com')` | `example.com:0` | `CREATE_JOB` |
| `net.fetch('https://example.com/')` right after | `https://example.com` | **`CREATE_JOB`** — resolved again |
| `net.resolveHost('example.com:443')`, `net.resolveHost('https://example.com')` | `[example.com:443]:0`, `[https://example.com]:0` | `ERR_NAME_NOT_RESOLVED` — taken as literal names |

**Finding.** Electron issues the request as `HostPortPair(host, 0)` with an empty `NetworkAnonymizationKey` (`shell/browser/net/resolve_host_function.cc`); the host cache is keyed by scheme-host-port, so nothing `resolveHost` produces is ever the entry an `https://` fetch reads. Re-validating after the fact is not available either: of the `webRequest` events only `onBeforeRedirect` carries an `ip`, and `net.fetch` exposes no socket.

**Consequence in code.** `network.ts` keeps `dns.promises.lookup` as a pre-check and the window is documented in `capabilities.md`. Pinning would need a Node-side HTTP stack with its own `lookup`, which forfeits the session's proxy and certificate handling.

## Findings whose probes were not kept

Established the same way — a throwaway page under the production scheme and CSP — but too small to keep as programs. Each is a one-file check to rebuild.

| Finding | Re-check | Consequence in code |
|---|---|---|
| Deleting `window.localStorage` / `indexedDB` in the top document is undone inside an `<iframe srcdoc>` or `about:blank` — the child gets a fresh global | Strip the API in the parent, create a child frame, read `window.localStorage` there | Web Storage is denied by CSP `sandbox`, which propagates, not by stripping (`protocol.ts`) |
| `frame-src` does not cover `srcdoc` / `about:blank` children | `frame-src 'none'`, then `<iframe srcdoc="…">` — it renders | Same: the containment must be inherited, not addressed by URL |
| Under CSP `sandbox`, `fetch()` of the app's **own** files fails as cross-origin unless the scheme is `corsEnabled` and answers `access-control-allow-origin` | Serve a page with `sandbox allow-scripts`, `fetch('./a.txt')` | `MINI_APP_PRIVILEGES.corsEnabled: true` and the ACAO header on every response |
| A scheme registered without `standard: true` yields an opaque origin and loses relative URL resolution | Register without it, load `cherry-miniapp://id/index.html` with a relative `<script src>` | `standard: true` in `MINI_APP_PRIVILEGES` |
| `did-attach-webview` fires with the guest's URL still empty | Log `contents.getURL()` in the handler | The host resolves the app from the guest's **session/partition**, never from its URL (`webviewHost.ts`) |
| `setPermissionRequestHandler` is never consulted for WebRTC, and CSP `webrtc 'block'` has no effect on Electron 41 | Probe 1, group `baseline`, with both installed | Both handlers stay for media/geolocation; WebRTC is refused by the proxy layer alone (`network.ts`) |
