import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applyMiniAppWebviewPolicy, installMiniAppWebviewHost } from '../webviewHost'

// The gate consults the runtime service; this stub is the world it reads. `vi.hoisted`
// so the mock factory below can reach it, and each case sets the state it needs.
const { PRELOAD, runtime } = vi.hoisted(() => ({
  PRELOAD: '/app/out/preload/miniAppBridge.js',
  runtime: {
    ready: new Set<string>(),
    quiescing: new Set<string>(),
    sessionApp: new Map<unknown, string>(),
    registerGuest: (() => {}) as (appId: string, id: number) => void,
    unregisterGuest: (() => {}) as (id: number) => void
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
  applyMiniAppWebviewPolicy(event as never, webPreferences as never, params as never, PRELOAD)
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
    runtime.registerGuest = (appId, id) => registered.push([appId, id])
    runtime.unregisterGuest = (id) => unregistered.push(id)
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

  it('is wired from both window services', () => {
    // The bug this guards: `MiniAppTabsPool` also renders in SubWindowAppShell, so a
    // main-window-only gate leaves detached tabs unguarded and unregistered.
    for (const service of ['MainWindowService', 'SubWindowService']) {
      const source = readFileSync(new URL(`../../../../services/${service}.ts`, import.meta.url), 'utf8')
      expect(source).toMatch(/installMiniAppWebviewHost\(/)
    }
  })
})
