/**
 * Default-deny network containment for a mini app partition.
 *
 * THREE layers, all required: `webRequest` is the hard boundary inside Chromium's
 * network stack, CSP is defence in depth and gives a legible failure in DevTools, and
 * the PAC is the only one that sees a WebRTC TURN connection at all (measured, §8).
 * CSP alone is enforced by the renderer, which runs the third-party code; webRequest
 * alone turns every failure into an opaque one.
 */

import { loggerService } from '@logger'
import { MINI_APP_SCHEME } from '@shared/types/miniAppManifest'

import { buildMiniAppCsp } from './protocol'

const logger = loggerService.withContext('miniAppNetwork')

/**
 * The guest partition reaches NOTHING but its own package. Declared hosts are not
 * consulted here — outbound traffic goes through `cherry.network.fetch` in the main
 * process, which is not a browser context and therefore not subject to CORS. One rule
 * to verify, instead of an allowlist spread over webRequest, CSP and a generated PAC.
 */
export function shouldAllowRequest(url: string, appId: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  // DevTools' own frontend loads inside the guest's session. The guest cannot reach
  // `devtools:` itself — it is a privileged scheme, not web-accessible — so admitting it
  // opens nothing to the page; refusing it leaves the DevTools window blank.
  if (parsed.protocol === 'devtools:') return true
  // Not `startsWith`: `cherry-miniapp://com.example.a.evil` shares the prefix.
  return parsed.protocol === `${MINI_APP_SCHEME}:` && parsed.host === appId
}

export async function installNetworkPolicy(session: Electron.Session, appId: string): Promise<void> {
  session.webRequest.onBeforeRequest((details, callback) => {
    // No host allowlist here: the guest document may not reach the network at all. Remote
    // bytes arrive only via `cherry.network.fetch`, which checks hosts in the main process.
    const allowed = shouldAllowRequest(details.url, appId)
    if (!allowed) logger.debug('Blocked mini app request', { appId, url: details.url })
    callback({ cancel: !allowed })
  })

  // Second delivery of the same CSP the protocol handler already sends (`protocol.ts`).
  // Not for DevTools' own pages: a `sandbox` CSP on the frontend breaks the inspector.
  session.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith('devtools:')) return callback({})
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildMiniAppCsp()]
      }
    })
  })

  // Measured: this handler is never invoked for WebRTC and CSP `webrtc 'block'` has no
  // effect on Electron 41. It stays for media/geolocation; WebRTC is handled below.
  /*
   * Chromium's own permission layer defaults to GRANTED and none of it passes through the
   * bridge, so `Notification`, `mediaDevices`, geolocation and clipboard would sidestep
   * the manifest, the usage attribution and the rate limits alike. Refuse EVERYTHING —
   * opening one later is a deliberate change with its own declaration key.
   */
  session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
  session.setPermissionCheckHandler(() => false)
  // Screen and device pickers have their own handlers and do NOT consult the two above.
  session.setDisplayMediaRequestHandler((_req, cb) => cb({}))
  session.setDevicePermissionHandler(() => false)
  session.setBluetoothPairingHandler(null)

  // Chromium's default for an unhandled download is the system save dialog — a guest
  // writing to the user's disk through `<a download>` or a blob URL, past every quota
  // and every rate limit here. `cherry.file.export` is the one way out, and it runs in main.
  // REPLACED, not appended, like every other handler in this function: `session` is
  // process-global per partition and `on` stacks, so a prepare that fails after this line
  // (the awaited `setProxy` below, or `protocol.handle`) leaves the listener behind and the
  // documented retry adds a second one.
  session.removeAllListeners('will-download')
  session.on('will-download', (event, item) => {
    event.preventDefault()
    logger.debug('Blocked mini app download', { appId, url: item.getURL() })
  })

  // The THIRD containment layer, and the only one that sees WebRTC. AWAITED: a proxy
  // is not in effect until `setProxy` resolves, and the guest may attach before then.
  await session.setProxy({ pacScript: `data:text/plain,${encodeURIComponent(DENY_ALL_PAC)}` })
}

/**
 * Cuts WebRTC's UDP path — **half** the WebRTC story, never used alone.
 *
 * Measured (design §8; `docs/references/mini-app/probes.md`, probe 1): with this
 * policy and `setProxy({ mode: 'direct' })`, a guest declaring NO network still opened
 * TCP to an undeclared host and sent a 196-byte STUN Allocate. The policy means "UDP
 * only through a proxy"; TCP on the public interface is explicitly allowed, and Electron
 * has no other switch (`setWebRTCIPHandlingPolicy` + `setWebRTCUDPPortRange` are the
 * whole surface). The other half is `DENY_ALL_PAC`.
 */
export function installWebRtcPolicy(contents: Electron.WebContents): void {
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
}

/** Unroutable on purpose: anything sent here fails rather than reaching a real proxy. */
const DEAD_PROXY = '127.0.0.1:1'

/**
 * Everything, unconditionally. The only layer that can refuse a WebRTC TURN connection,
 * because neither CSP nor `webRequest` ever observes one.
 *
 * There is no host list to interpolate: outbound traffic goes through
 * `cherry.network.fetch` in the main process, which does not use this
 * session. An allowlisted PAC was measured and is NOT enough — a host-only rule turns
 * "https on 443" into "any port on a declared host", a bidirectional channel
 * `webRequest` cannot see (design §8). Denying everything has no such edge.
 *
 * It also never needs rebuilding: it does not depend on grants, so revoking a domain
 * does not have to remember to call anything here.
 */
export const DENY_ALL_PAC = `function FindProxyForURL(url, host) { return "PROXY ${DEAD_PROXY}"; }`
