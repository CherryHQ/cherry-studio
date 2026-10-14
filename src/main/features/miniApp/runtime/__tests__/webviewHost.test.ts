import { app, webContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyMiniAppWebviewPolicy, installMiniAppWebviewGate, installMiniAppWebviewHost } from '../webviewHost'

// The gate consults the runtime service; this stub is the world it reads. `vi.hoisted`
// so the mock factory below can reach it, and each case sets the state it needs.
const { PRELOAD, runtime } = vi.hoisted(() => ({
  PRELOAD: '/app/out/preload/miniAppBridge.js',
  runtime: {
    ready: new Set<string>(),
    quiescing: new Set<string>(),
    sessionApp: new Map<unknown, string>(),
    registerGuest: (_appId: string, _id: number): void => {
      void _appId
      void _id
    },
    unregisterGuest: (_id: number): void => {
      void _id
    }
  }
}))
vi.mock('@application', async () => {
  const { mockMiniAppApplication } = await import('../../__tests__/applicationMock')
  return mockMiniAppApplication({
    MiniAppRuntimeService: {
      bridgePreloadPath: PRELOAD,
      isPartitionReady: (appId: string) => runtime.ready.has(appId),
      isQuiescing: (appId: string) => runtime.quiescing.has(appId),
      resolveAppIdBySession: (s: unknown) => runtime.sessionApp.get(s),
      registerGuest: (appId: string, id: number) => runtime.registerGuest(appId, id),
      unregisterGuest: (id: number) => runtime.unregisterGuest(id)
    }
  })
})

function run(params: {
  partition: string
  src: string
  preload?: string
  webpreferences?: string
  blinkfeatures?: string
  disableblinkfeatures?: string
}) {
  const event = { preventDefault: vi.fn() }
  const webPreferences: Record<string, unknown> = { preload: params.preload, nodeIntegration: true, sandbox: false }
  applyMiniAppWebviewPolicy(event as never, webPreferences, params, PRELOAD)
  return { event, webPreferences }
}

describe('applyMiniAppWebviewPolicy', () => {
  it('ignores webviews outside a mini app partition', () => {
    const { event, webPreferences } = run({ partition: 'persist:webview', src: 'https://example.com' })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(webPreferences.nodeIntegration).toBe(true)
  })

  it('forces the sandbox for a mini app webview', () => {
    // No `preload` in the params: the element must NOT carry one. Passing it here
    // exercises the refusal path instead of the happy path this case is named for.
    const { event, webPreferences } = run({
      partition: 'persist:miniapp:com.example.a',
      src: 'cherry-miniapp://com.example.a/index.html'
    })
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(webPreferences).toMatchObject({
      preload: PRELOAD,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    })
  })

  it('blocks a mini app webview pointing at the open web', () => {
    expect(
      run({ partition: 'persist:miniapp:com.example.a', src: 'https://evil.com' }).event.preventDefault
    ).toHaveBeenCalled()
  })

  it('blocks a mini app webview pointing at a DIFFERENT app origin', () => {
    expect(
      run({
        partition: 'persist:miniapp:com.example.a',
        src: 'cherry-miniapp://com.example.b/index.html'
      }).event.preventDefault
    ).toHaveBeenCalled()
  })

  it('blocks ANY renderer-supplied preload, including the right one', () => {
    // The rule is "carries no preload", not "carries no WRONG preload": comparing
    // against the expected path would accept a renderer that learned it.
    for (const preload of ['/tmp/evil.js', PRELOAD]) {
      expect(
        run({
          partition: 'persist:miniapp:com.example.a',
          src: 'cherry-miniapp://com.example.a/index.html',
          preload
        }).event.preventDefault
      ).toHaveBeenCalled()
    }
  })

  it('blocks the attributes that would override the preferences imposed below them', () => {
    // Electron parses `webpreferences` with no allowlist and spreads it LAST over what it
    // derives from the other attributes, and its inheritance clamp covers only six keys —
    // `webviewTag` is not one. Answering these pref-by-pref would need an edit every time
    // Electron adds a preference; refusing the attribute outright does not.
    for (const attr of ['webpreferences', 'blinkfeatures', 'disableblinkfeatures'] as const) {
      expect(
        run({
          partition: 'persist:miniapp:com.example.a',
          src: 'cherry-miniapp://com.example.a/index.html',
          [attr]: 'webviewTag'
        }).event.preventDefault
      ).toHaveBeenCalled()
    }
  })

  it('denies the guest `webviewTag` outright, not only through the attribute', () => {
    // The attribute path above is one of TWO. The host runs `webviewTag: true` and
    // Electron's inheritance clamp does not cover `webviewTag`, so a guest that names it
    // nowhere still inherits it — and a nested webview attaches on any partition, outside
    // this app's origin check, PAC, request filter and CSP alike.
    expect(run(attachParams).webPreferences.webviewTag).toBe(false)
  })
})

/** A host window: captures both hooks so a case can fire them like Electron would. */
function installOnHost() {
  const hooks = new Map<string, (...args: never[]) => void>()
  const set = (name: string, fn: (...args: never[]) => void) => hooks.set(name, fn)
  installMiniAppWebviewHost({ id: 1, on: set, once: set } as never)
  const willAttach = (params: { partition: string; src: string; preload?: string }) => {
    const event = { preventDefault: vi.fn() }
    const webPreferences: Record<string, unknown> = { nodeIntegration: true, sandbox: false }
    hooks.get('will-attach-webview')!(event as never, webPreferences as never, params as never)
    return { event, webPreferences }
  }
  const didAttach = (contents: unknown) => hooks.get('did-attach-webview')!(undefined as never, contents as never)
  return { hooks, willAttach, didAttach }
}

const APP = 'com.example.a'
const attachParams = { partition: `persist:miniapp:${APP}`, src: `cherry-miniapp://${APP}/index.html` }

describe('installMiniAppWebviewHost', () => {
  beforeEach(() => {
    runtime.ready.clear()
    runtime.quiescing.clear()
    runtime.sessionApp.clear()
    runtime.registerGuest = () => {}
    runtime.unregisterGuest = () => {}
  })

  it('vetoes a guest whose partition was never prepared', () => {
    // `ensurePartition` is async and this hook is not: an attach that races ahead of
    // `mini_app.runtime.prepare` would load the guest with no protocol and no network policy.
    const { event, webPreferences } = installOnHost().willAttach(attachParams)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(webPreferences.preload).toBeUndefined()
  })

  it('vetoes a guest while its app is being taken offline', () => {
    // The side door into `withAppQuiesced`: old code attaching onto files and grants
    // that are changing under it.
    runtime.ready.add(APP)
    runtime.quiescing.add(APP)

    expect(installOnHost().willAttach(attachParams).event.preventDefault).toHaveBeenCalled()
  })

  it('imposes the sandbox policy on a guest whose partition is ready', () => {
    // The positive control for the two vetoes: a hook that vetoes everything passes them.
    runtime.ready.add(APP)

    const { event, webPreferences } = installOnHost().willAttach(attachParams)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(webPreferences).toMatchObject({ preload: PRELOAD, sandbox: true, nodeIntegration: false })
  })

  it('leaves a non-mini-app webview alone even when nothing is prepared', () => {
    const { event, webPreferences } = installOnHost().willAttach({ partition: 'persist:webview', src: 'https://x' })

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(webPreferences.nodeIntegration).toBe(true)
  })

  it('registers an attached guest by its SESSION and forgets it when it is destroyed', () => {
    // `did-attach-webview` fires with an empty `getURL()`, so identifying by URL registers
    // nothing and the bridge fails closed for every call the guest ever makes.
    const registered: Array<[string, number]> = []
    const unregistered: number[] = []
    runtime.registerGuest = (appId, id) => {
      registered.push([appId, id])
    }
    runtime.unregisterGuest = (id) => {
      unregistered.push(id)
    }
    const session = {}
    runtime.sessionApp.set(session, APP)
    const destroyedHandlers: Array<() => void> = []
    const contents = {
      id: 42,
      session,
      getURL: () => '',
      on: vi.fn(),
      once: (name: string, fn: () => void) => name === 'destroyed' && destroyedHandlers.push(fn),
      setWindowOpenHandler: vi.fn(),
      setWebRTCIPHandlingPolicy: vi.fn()
    }

    installOnHost().didAttach(contents)
    expect(registered).toEqual([[APP, 42]])
    expect(unregistered).toEqual([])

    for (const fn of destroyedHandlers) fn()
    expect(unregistered).toEqual([42])
  })

  it('registers nothing for a guest on a session it does not know', () => {
    const registered: unknown[] = []
    runtime.registerGuest = (...args) => registered.push(args)

    installOnHost().didAttach({ id: 7, session: {}, on: vi.fn(), once: vi.fn() })

    expect(registered).toEqual([])
  })
})

describe('installMiniAppWebviewGate', () => {
  const fakeContents = () => ({ on: vi.fn(), once: vi.fn(), id: Math.floor(Math.random() * 1e6) })
  /** `app.on` is overloaded per event name, so TS narrows the recorded calls to the first one. */
  const subscriber = () =>
    (vi.mocked(app.on).mock.calls as unknown as Array<[string, (e: unknown, c: unknown) => void]>).find(
      ([event]) => event === 'web-contents-created'
    )![1]

  beforeEach(() => {
    vi.mocked(app.on).mockReset()
    vi.mocked(app.removeListener).mockReset()
    vi.mocked(webContents.getAllWebContents).mockReset().mockReturnValue([])
  })

  it('arms the contents that already exist when it runs', () => {
    // The sweep is not decoration: this is called from a `WhenReady` service, and the main
    // window is built by another service in the same phase — so it can already be there.
    const existing = fakeContents()
    vi.mocked(webContents.getAllWebContents).mockReturnValue([existing] as never)

    installMiniAppWebviewGate()

    expect(existing.on).toHaveBeenCalledWith('will-attach-webview', expect.any(Function))
  })

  it('arms contents created after it runs', () => {
    // The regression this replaces a source-grep with: the gate used to be installed window
    // by window, so a window type nobody remembered — `QuickAssistant`, which declares
    // `webviewTag` with `sandbox: false` — had no main-process veto at all.
    installMiniAppWebviewGate()
    const later = fakeContents()

    subscriber()(undefined, later)

    expect(later.on).toHaveBeenCalledWith('will-attach-webview', expect.any(Function))
  })

  it('arms one contents once, however many times it is reached', () => {
    // The sweep and the event overlap by construction, and a second copy of these listeners
    // would register the same guest twice.
    const both = fakeContents()
    vi.mocked(webContents.getAllWebContents).mockReturnValue([both] as never)

    installMiniAppWebviewGate()
    subscriber()(undefined, both)

    expect(both.on.mock.calls.filter(([event]) => event === 'will-attach-webview')).toHaveLength(1)
  })

  it('stops arming new contents once disposed', () => {
    installMiniAppWebviewGate()()

    expect(app.removeListener).toHaveBeenCalledWith('web-contents-created', expect.any(Function))
  })
})
