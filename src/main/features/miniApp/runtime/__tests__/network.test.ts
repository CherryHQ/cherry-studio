import { describe, expect, it, vi } from 'vitest'

import { DENY_ALL_PAC, installNetworkPolicy, shouldAllowRequest } from '../network'
import { buildMiniAppCsp } from '../protocol'

const APP = 'com.example.mygame'

describe('shouldAllowRequest', () => {
  it('allows the app its own origin', () => {
    expect(shouldAllowRequest(`cherry-miniapp://${APP}/index.html`, APP)).toBe(true)
  })

  it('blocks another app origin', () => {
    expect(shouldAllowRequest('cherry-miniapp://com.example.other/x', APP)).toBe(false)
  })

  it('blocks an origin that merely starts with this appId', () => {
    // Prefix matching would hand `com.example.mygame.evil` the whole package.
    expect(shouldAllowRequest(`cherry-miniapp://${APP}.evil/x`, APP)).toBe(false)
  })

  it("admits DevTools' own frontend, which loads inside the guest session", () => {
    // Refusing it leaves the inspector window blank; the page itself cannot request a
    // privileged scheme, so nothing reaches the guest through this.
    expect(shouldAllowRequest('devtools://devtools/bundled/devtools_app.html', APP)).toBe(true)
  })

  it('blocks every external host, declared or not', () => {
    // The guest layer has no allowlist any more: declared hosts are reachable only
    // through `cherry.network.fetch`, which runs in the main process.
    expect(shouldAllowRequest('https://api.mygame.com/v1', APP)).toBe(false)
    expect(shouldAllowRequest('wss://api.mygame.com/socket', APP)).toBe(false)
    expect(shouldAllowRequest('http://api.mygame.com/', APP)).toBe(false)
  })
})

type HeadersListener = (
  details: Electron.OnHeadersReceivedListenerDetails,
  cb: (response: Electron.HeadersReceivedResponse) => void
) => void
type RequestListener = (details: { url: string }, cb: (response: { cancel: boolean }) => void) => void
type PermissionRequestHandler = (wc: unknown, permission: string, cb: (granted: boolean) => void) => void

/** A partition session that records every handler the policy installs on it. */
function fakeSession(setProxy = vi.fn().mockResolvedValue(undefined)) {
  const captured = {
    onHeaders: undefined as HeadersListener | undefined,
    onRequest: undefined as RequestListener | undefined,
    onPermissionRequest: undefined as PermissionRequestHandler | undefined,
    permissionCheck: undefined as (() => boolean) | undefined,
    devicePermission: undefined as (() => boolean) | undefined,
    displayMedia: undefined as ((req: unknown, cb: (streams: object) => void) => void) | undefined,
    willDownload: undefined as
      | ((event: { preventDefault: () => void }, item: { getURL: () => string }) => void)
      | undefined,
    /** Electron STACKS `on` listeners — the count is what tells "replaced" from "added again" apart. */
    willDownloadCount: 0
  }
  const session = {
    webRequest: {
      onBeforeRequest: vi.fn((l: RequestListener) => (captured.onRequest = l)),
      onHeadersReceived: vi.fn((l: HeadersListener) => (captured.onHeaders = l))
    },
    setPermissionRequestHandler: vi.fn((h: PermissionRequestHandler) => (captured.onPermissionRequest = h)),
    setPermissionCheckHandler: vi.fn((h: () => boolean) => (captured.permissionCheck = h)),
    setDisplayMediaRequestHandler: vi.fn((h: typeof captured.displayMedia) => (captured.displayMedia = h)),
    setDevicePermissionHandler: vi.fn((h: () => boolean) => (captured.devicePermission = h)),
    setBluetoothPairingHandler: vi.fn(),
    on: vi.fn((event: string, listener: typeof captured.willDownload) => {
      if (event !== 'will-download') return
      captured.willDownload = listener
      captured.willDownloadCount += 1
    }),
    removeAllListeners: vi.fn((event: string) => {
      if (event === 'will-download') captured.willDownloadCount = 0
    }),
    setProxy
  }
  return { session: session as unknown as Electron.Session, captured, setProxy }
}

describe('installNetworkPolicy', () => {
  it('cancels every download, so a blob URL cannot open the system save dialog', async () => {
    // Electron's default for an unhandled `will-download` is a save dialog — a way onto
    // the user's disk that bypasses `cherry.file.export` and everything it checks.
    const { session, captured } = fakeSession()
    await installNetworkPolicy(session, APP)

    const preventDefault = vi.fn()
    captured.willDownload!({ preventDefault }, { getURL: () => 'blob:cherry-miniapp://com.example.a/uuid' })

    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('holds one download listener however many times a partition is prepared', async () => {
    // Every OTHER handler here replaces on re-invocation; `session.on` appends. A prepare
    // that fails after this line leaves the listener installed, and the documented retry
    // ("leave the session clean so the retry starts from nothing") would stack another.
    const { session, captured } = fakeSession()
    await installNetworkPolicy(session, APP)
    await installNetworkPolicy(session, APP)

    expect(captured.willDownloadCount).toBe(1)
  })

  it('injects the exact CSP the protocol handler sends', async () => {
    // Two delivery paths, one string. A copy here could drift, and then whichever
    // path Chromium honours for a custom scheme would sandbox a different document.
    const { session, captured } = fakeSession()

    await installNetworkPolicy(session, APP)

    const details = {
      url: `cherry-miniapp://${APP}/index.html`,
      responseHeaders: { 'content-type': ['text/html'] }
    } as unknown as Electron.OnHeadersReceivedListenerDetails
    const result = await new Promise<Electron.HeadersReceivedResponse>((resolve) =>
      captured.onHeaders!(details, resolve)
    )
    expect(result.responseHeaders?.['Content-Security-Policy']).toEqual([buildMiniAppCsp()])
    expect(result.responseHeaders?.['content-type']).toEqual(['text/html'])
  })

  it('does not sandbox the DevTools frontend with the guest CSP', async () => {
    const { session, captured } = fakeSession()
    await installNetworkPolicy(session, APP)

    const details = {
      url: 'devtools://devtools/bundled/devtools_app.html',
      responseHeaders: { 'content-type': ['text/html'] }
    } as unknown as Electron.OnHeadersReceivedListenerDetails
    const result = await new Promise<Electron.HeadersReceivedResponse>((resolve) =>
      captured.onHeaders!(details, resolve)
    )
    expect(result.responseHeaders?.['Content-Security-Policy']).toBeUndefined()
  })

  it('cancels every request that leaves the package and lets the package through', async () => {
    // `shouldAllowRequest` is a pure function until something wires it to the session;
    // the wiring — and the `cancel` polarity — is what this proves.
    const { session, captured } = fakeSession()
    await installNetworkPolicy(session, APP)
    const decide = (url: string) => new Promise<boolean>((r) => captured.onRequest!({ url }, ({ cancel }) => r(cancel)))

    expect(await decide('https://api.mygame.com/v1')).toBe(true)
    expect(await decide(`cherry-miniapp://${APP}/index.html`)).toBe(false)
  })

  it('refuses every Chromium permission prompt and check', async () => {
    // Chromium defaults these to GRANTED and none of them passes through the bridge:
    // `Notification`, camera, geolocation and clipboard would sidestep the manifest.
    const { session, captured } = fakeSession()
    await installNetworkPolicy(session, APP)

    for (const permission of ['notifications', 'media', 'geolocation', 'clipboard-read']) {
      const granted = await new Promise<boolean>((r) => captured.onPermissionRequest!({}, permission, r))
      expect(granted).toBe(false)
    }
    expect(captured.permissionCheck!()).toBe(false)
    expect(captured.devicePermission!()).toBe(false)
    expect(await new Promise<object>((r) => captured.displayMedia!({}, r))).toEqual({})
  })

  it('does not report ready until the deny-all proxy is actually in effect', async () => {
    // The renderer mounts the <webview> when `prepare` resolves. A proxy that is still
    // being applied at that moment lets the first load — and WebRTC — run un-proxied.
    let applied!: () => void
    const { session, setProxy } = fakeSession(vi.fn(() => new Promise<void>((r) => (applied = r))))
    let ready = false
    const install = installNetworkPolicy(session, APP).then(() => (ready = true))
    await new Promise((r) => setImmediate(r))

    expect(setProxy).toHaveBeenCalledWith({ pacScript: `data:text/plain,${encodeURIComponent(DENY_ALL_PAC)}` })
    expect(ready).toBe(false)

    applied()
    await install
    expect(ready).toBe(true)
  })
})

describe('DENY_ALL_PAC', () => {
  // A PAC is just text until something evaluates it; running it is the only way these
  // assertions say anything about what Chromium will do.
  const evalPac = (url: string, host: string) =>
    new Function(`${DENY_ALL_PAC}; return FindProxyForURL(${JSON.stringify(url)}, ${JSON.stringify(host)})`)()

  it('sends every host to the dead proxy, declared or not', () => {
    expect(evalPac('https://evil.example/', 'evil.example')).toMatch(/PROXY/)
    expect(evalPac('https://api.mygame.com/x', 'api.mygame.com')).toMatch(/PROXY/)
  })

  it('refuses a TURN target on a non-default port', () => {
    // The escape this layer exists for: measured at 196 bytes of real STUN Allocate
    // traffic under the previous host-only PAC (design §8).
    expect(evalPac('turn://api.mygame.com:3478/', 'api.mygame.com')).toMatch(/PROXY/)
  })
})
