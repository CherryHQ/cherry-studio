// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() },
  useIpcOn: vi.fn()
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { ipcApi, useIpcOn } from '@renderer/ipc'
import type { MiniAppKind } from '@shared/data/types/miniApp'
import { WEBVIEW_KEYDOWN_CHANNEL } from '@shared/utils/webviewKey'

import WebviewContainer from '../WebviewContainer'

const renderWebview = (props: {
  appid?: string
  url?: string
  kind: MiniAppKind
  onFocusChange?: (appid: string, focused: boolean) => void
}) => {
  const { container } = render(
    <WebviewContainer
      appid={props.appid ?? 'chatgpt'}
      url={props.url ?? 'https://chat.openai.com'}
      kind={props.kind}
      onSetRefCallback={vi.fn()}
      onLoadedCallback={vi.fn()}
      onFocusChange={props.onFocusChange}
    />
  )
  return container
}

const attachedWebview = async (container: HTMLElement) => {
  await act(async () => {})
  const webview = container.querySelector('webview')!
  expect(webview).not.toBeNull()
  return webview
}

const webviewIn = async (container: HTMLElement) => {
  await waitFor(() => expect(container.querySelector('webview')).not.toBeNull())
  return container.querySelector('webview')!
}

beforeEach(() => {
  MockUsePreferenceUtils.resetMocks()
  vi.mocked(ipcApi.request).mockImplementation(async (route) =>
    route === 'webview.region.prepare' ? { partition: 'persist:webview', fake: false } : undefined
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const focusOn = (element: Element | null) => {
  Object.defineProperty(document, 'activeElement', { value: element, configurable: true })
}

/**
 * Injects the relay message a SITE guest's preload sends. It proves what the host does
 * with one — never that anything emits it: a LOCAL mini app has no relay preload at all
 * (`WebviewService`, "yields the preload slot to a LOCAL mini app"), so every case below
 * is scoped to `kind: 'site'` on purpose and none of them covers a local app's shortcuts.
 */
const sendGuestKey = (webview: Element, payload: Record<string, unknown>) => {
  act(() => {
    webview.dispatchEvent(
      Object.assign(new Event('ipc-message'), { channel: WEBVIEW_KEYDOWN_CHANNEL, args: [payload] })
    )
  })
}

const captureWindowKeydown = () => {
  const seen: KeyboardEvent[] = []
  const listener = (event: Event) => seen.push(event as KeyboardEvent)
  window.addEventListener('keydown', listener)
  return { seen, stop: () => window.removeEventListener('keydown', listener) }
}

describe('WebviewContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    focusOn(document.body)
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('cancels a delayed loaded callback when the WebView is evicted', async () => {
    const onLoaded = vi.fn()
    const { container, unmount } = render(
      <WebviewContainer
        appid="chatgpt"
        url="https://chat.openai.com"
        kind="site"
        onSetRefCallback={vi.fn()}
        onLoadedCallback={onLoaded}
      />
    )
    const webview = await attachedWebview(container)

    act(() => {
      webview?.dispatchEvent(new Event('did-finish-load'))
    })
    unmount()
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(onLoaded).not.toHaveBeenCalled()
  })

  it('reports the WebView as loaded when dom-ready is the only readiness event', async () => {
    const onLoaded = vi.fn()
    const { container } = render(
      <WebviewContainer
        appid="chatgpt"
        url="https://chat.openai.com"
        kind="site"
        onSetRefCallback={vi.fn()}
        onLoadedCallback={onLoaded}
      />
    )
    const webview = await attachedWebview(container)
    Object.defineProperty(webview, 'getWebContentsId', { value: () => 42 })

    act(() => {
      webview?.dispatchEvent(new Event('dom-ready'))
    })

    expect(onLoaded).toHaveBeenCalledOnce()
    expect(onLoaded).toHaveBeenCalledWith('chatgpt')
  })

  it('cancels the previous loaded callback when a new load cycle starts', async () => {
    const onLoaded = vi.fn()
    const { container } = render(
      <WebviewContainer
        appid="chatgpt"
        url="https://chat.openai.com"
        kind="site"
        onSetRefCallback={vi.fn()}
        onLoadedCallback={onLoaded}
      />
    )
    const webview = await attachedWebview(container)

    act(() => {
      webview?.dispatchEvent(new Event('did-finish-load'))
      webview?.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isInPlace: false, isMainFrame: true }))
      vi.advanceTimersByTime(100)
    })

    expect(onLoaded).not.toHaveBeenCalled()
  })

  it('keeps the delayed loaded callback for an in-place main-frame navigation', async () => {
    const onLoaded = vi.fn()
    const { container } = render(
      <WebviewContainer
        appid="chatgpt"
        url="https://chat.openai.com"
        kind="site"
        onSetRefCallback={vi.fn()}
        onLoadedCallback={onLoaded}
      />
    )
    const webview = await attachedWebview(container)

    act(() => {
      webview?.dispatchEvent(new Event('did-finish-load'))
      webview?.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isInPlace: true, isMainFrame: true }))
      vi.advanceTimersByTime(100)
    })

    expect(onLoaded).toHaveBeenCalledWith('chatgpt')
  })

  it('replays a guest keydown on the host window, targeted at the WebView it came from', async () => {
    const webview = await attachedWebview(renderWebview({ kind: 'site' }))
    focusOn(webview)
    const { seen, stop } = captureWindowKeydown()

    sendGuestKey(webview, { key: 'f', code: 'KeyF', ctrlKey: true, shiftKey: false, isTrusted: true })
    stop()

    expect(seen).toHaveLength(1)
    expect(seen[0].key).toBe('f')
    expect(seen[0].ctrlKey).toBe(true)
    expect(seen[0].target).toBe(webview)
  })

  it('drops a keydown the guest page synthesized instead of a real key press', async () => {
    const webview = await attachedWebview(renderWebview({ kind: 'site' }))
    focusOn(webview)
    const { seen, stop } = captureWindowKeydown()

    sendGuestKey(webview, { key: 'f', code: 'KeyF', ctrlKey: true, isTrusted: false })
    stop()

    expect(seen).toHaveLength(0)
  })

  it('drops a guest keydown that arrives while the WebView is not focused', async () => {
    const webview = await attachedWebview(renderWebview({ kind: 'site' }))
    focusOn(document.body)
    const { seen, stop } = captureWindowKeydown()

    sendGuestKey(webview, { key: 'f', code: 'KeyF', ctrlKey: true, isTrusted: true })
    stop()

    expect(seen).toHaveLength(0)
  })

  it('reports focus and blur so the pool can own the context key', async () => {
    const onFocusChange = vi.fn()
    const webview = await attachedWebview(renderWebview({ kind: 'site', onFocusChange }))

    act(() => {
      webview.dispatchEvent(new Event('focus'))
    })
    expect(onFocusChange).toHaveBeenLastCalledWith('chatgpt', true)

    act(() => {
      webview.dispatchEvent(new Event('blur'))
    })
    expect(onFocusChange).toHaveBeenLastCalledWith('chatgpt', false)
  })

  it('prints the WebView the key came from, not another mounted pane', async () => {
    const other = await attachedWebview(renderWebview({ appid: 'claude', kind: 'site' }))
    const target = await attachedWebview(renderWebview({ appid: 'chatgpt', kind: 'site' }))
    Object.defineProperty(other, 'getWebContentsId', { value: () => 11 })
    Object.defineProperty(target, 'getWebContentsId', { value: () => 22 })
    vi.mocked(ipcApi.request).mockClear().mockResolvedValue(null)

    const event = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, cancelable: true })
    Object.defineProperty(event, 'target', { get: () => target })
    await act(async () => {
      window.dispatchEvent(event)
    })

    expect(ipcApi.request).toHaveBeenCalledTimes(1)
    expect(ipcApi.request).toHaveBeenCalledWith('webview.print_to_pdf', { webviewId: 22 })
  })
})

describe('WebviewContainer partitioning', () => {
  it('shares the persistent website partition across tabs with no preload', async () => {
    const first = await webviewIn(renderWebview({ appid: 'google', url: 'https://google.com', kind: 'site' }))
    const duplicate = await webviewIn(renderWebview({ appid: 'google', url: 'https://google.com', kind: 'site' }))
    expect(first.getAttribute('partition')).toBe('persist:webview')
    expect(duplicate.getAttribute('partition')).toBe(first.getAttribute('partition'))
    expect(first.getAttribute('preload')).toBeNull()
  })

  it('gives each local app its own partition', async () => {
    const a = await webviewIn(
      renderWebview({ appid: 'com.example.a', url: 'cherry-miniapp://com.example.a/index.html', kind: 'app' })
    )
    const b = await webviewIn(
      renderWebview({ appid: 'com.example.b', url: 'cherry-miniapp://com.example.b/index.html', kind: 'app' })
    )
    expect(a.getAttribute('partition')).toBe('persist:miniapp:com.example.a')
    expect(b.getAttribute('partition')).not.toBe(a.getAttribute('partition'))
  })

  it('never sets a preload attribute — main imposes it', async () => {
    const wv = await webviewIn(
      renderWebview({ appid: 'com.example.a', url: 'cherry-miniapp://com.example.a/index.html', kind: 'app' })
    )
    // The renderer sets NO preload — main imposes it on the webPreferences side.
    // A renderer that names one is refused outright by `applyMiniAppWebviewPolicy`.
    expect(wv.getAttribute('preload')).toBeNull()
  })

  it('never enables popups for a local app', async () => {
    const wv = await webviewIn(
      renderWebview({ appid: 'com.example.a', url: 'cherry-miniapp://com.example.a/index.html', kind: 'app' })
    )
    expect(wv.getAttribute('allowpopups')).toBeNull()
  })

  it('never hands a local app to the site popup handler', async () => {
    // `webview.set_open_link_external` REPLACES the guest's deny-all popup policy in main;
    // asking for it on a local app would reopen `window.open` as an exit from the sandbox.
    for (const kind of ['app', 'site'] as const) {
      vi.mocked(ipcApi.request).mockClear()
      const wv = await webviewIn(
        renderWebview({
          appid: kind === 'app' ? 'com.example.a' : 'google',
          url: kind === 'app' ? 'cherry-miniapp://com.example.a/index.html' : 'https://google.com',
          kind
        })
      )
      Object.defineProperty(wv, 'getWebContentsId', { value: () => 7 })
      act(() => {
        wv.dispatchEvent(new Event('dom-ready'))
      })
      const asked = vi.mocked(ipcApi.request).mock.calls.some(([route]) => route === 'webview.set_open_link_external')
      expect(asked).toBe(kind === 'site')
    }
  })

  it('keeps popups enabled for site mini apps', async () => {
    const wv = await webviewIn(renderWebview({ appid: 'google', url: 'https://google.com', kind: 'site' }))
    expect(wv.getAttribute('allowpopups')).toBe('true')
  })
})

describe('WebviewContainer partition readiness', () => {
  it('releases its regional lease and prepares the default guest after an HTTPS-to-file edit', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.developer_mode.enabled': true,
      'feature.mini_app.fake_environment.enabled': true,
      'feature.mini_app.region_profiles': { chatgpt: 'JP' }
    })
    const leaseId = '00000000-0000-4000-8000-000000000013'
    let fileSite = false
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route !== 'webview.region.prepare') return undefined
      return fileSite
        ? { partition: 'persist:webview', fake: false, leaseId: null }
        : { partition: 'persist:webview-fake:JP:chatgpt', fake: true, leaseId }
    })
    const props = {
      appid: 'chatgpt',
      kind: 'site' as const,
      onSetRefCallback: vi.fn(),
      onLoadedCallback: vi.fn()
    }
    const view = render(<WebviewContainer {...props} url="https://chatgpt.com" />)
    const original = await webviewIn(view.container)
    expect(original).toHaveAttribute('partition', 'persist:webview-fake:JP:chatgpt')

    fileSite = true
    view.rerender(<WebviewContainer {...props} url="file:///C:/mini-app/index.html" />)
    await waitFor(() => expect(view.container.querySelector('webview')).toHaveAttribute('partition', 'persist:webview'))
    const current = await webviewIn(view.container)
    expect(current).not.toBe(original)
    expect(current).toHaveAttribute('src', 'file:///C:/mini-app/index.html')
    expect(ipcApi.request).toHaveBeenCalledWith('webview.region.release', { leaseId })
  })

  it('prepares a new guest and releases the old lease when its regional session is invalidated', async () => {
    const leases = ['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012']
    let prepared = 0
    vi.mocked(ipcApi.request).mockImplementation(async (route) =>
      route === 'webview.region.prepare'
        ? { partition: 'persist:webview-us:chatgpt', fake: true, leaseId: leases[prepared++] }
        : undefined
    )
    const container = renderWebview({ kind: 'site' })
    const old = await webviewIn(container)
    const invalidate = vi.mocked(useIpcOn).mock.calls.find(([name]) => name === 'webview.region.invalidated')![1]
    await act(async () => invalidate({ appId: 'chatgpt' }))
    const current = await webviewIn(container)
    expect(current).not.toBe(old)
    expect(ipcApi.request).toHaveBeenCalledWith('webview.region.release', { leaseId: leases[0] })
    expect(prepared).toBe(2)
  })
  it('releases a regional preparation that finishes after its host component unmounts', async () => {
    const leaseId = '00000000-0000-4000-8000-000000000001'
    let finish!: (value: unknown) => void
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'webview.region.prepare')
        return new Promise((resolve) => {
          finish = resolve
        })
      return undefined
    })
    const view = render(
      <WebviewContainer
        appid="chatgpt"
        kind="site"
        url="https://chatgpt.com"
        onSetRefCallback={vi.fn()}
        onLoadedCallback={vi.fn()}
      />
    )
    view.unmount()
    await act(async () => finish({ partition: 'persist:webview-us:chatgpt', fake: true, leaseId }))
    expect(ipcApi.request).toHaveBeenCalledWith('webview.region.release', { leaseId })
  })

  it('releases its regional lease when the mounted guest is removed', async () => {
    const leaseId = '00000000-0000-4000-8000-000000000002'
    vi.mocked(ipcApi.request).mockImplementation(async (route) =>
      route === 'webview.region.prepare' ? { partition: 'persist:webview-us:chatgpt', fake: true, leaseId } : undefined
    )
    const view = render(
      <WebviewContainer
        appid="chatgpt"
        kind="site"
        url="https://chatgpt.com"
        onSetRefCallback={vi.fn()}
        onLoadedCallback={vi.fn()}
      />
    )
    await webviewIn(view.container)
    view.unmount()
    expect(ipcApi.request).toHaveBeenCalledWith('webview.region.release', { leaseId })
  })
  it('does not mount a local app webview before prepare resolves', async () => {
    // The bug this guards: attaching first makes `will-attach-webview` veto the
    // attach, and the veto is silent — the user sees a spinner that never ends.
    let resolve: () => void = () => {}
    vi.mocked(ipcApi.request).mockReturnValue(new Promise<void>((r) => (resolve = r)))

    const container = renderWebview({
      appid: 'com.example.a',
      url: 'cherry-miniapp://com.example.a/index.html',
      kind: 'app'
    })

    expect(container.querySelector('webview')).toBeNull()
    await act(async () => resolve())
  })

  it('waits for the new app preparation when a mounted container changes identity', async () => {
    const props = {
      kind: 'app' as const,
      onSetRefCallback: vi.fn(),
      onLoadedCallback: vi.fn()
    }
    const view = render(
      <WebviewContainer {...props} appid="com.example.a" url="cherry-miniapp://com.example.a/index.html" />
    )
    await webviewIn(view.container)
    let resolve: () => void = () => {}
    vi.mocked(ipcApi.request).mockImplementation((route) =>
      route === 'mini_app.runtime.prepare'
        ? new Promise<void>((done) => {
            resolve = done
          })
        : Promise.resolve(undefined)
    )
    view.rerender(<WebviewContainer {...props} appid="com.example.b" url="cherry-miniapp://com.example.b/index.html" />)
    expect(view.container.querySelector('webview')).toBeNull()
    await act(async () => resolve())
    const guest = await webviewIn(view.container)
    expect(guest).toHaveAttribute('partition', 'persist:miniapp:com.example.b')
    expect(guest).toHaveAttribute('src', 'cherry-miniapp://com.example.b/index.html')
  })

  it('mounts it once prepare resolves', async () => {
    const container = renderWebview({
      appid: 'com.example.a',
      url: 'cherry-miniapp://com.example.a/index.html',
      kind: 'app'
    })

    expect(await webviewIn(container)).not.toBeNull()
    expect(ipcApi.request).toHaveBeenCalledWith('mini_app.runtime.prepare', { appId: 'com.example.a' })
  })

  it('assigns the src once the partition is ready', async () => {
    // The bug this guards: gating the mount without gating the init effect leaves a
    // webview that is attached, configured, and pointed at nothing.
    const wv = await webviewIn(
      renderWebview({ appid: 'com.example.a', url: 'cherry-miniapp://com.example.a/index.html', kind: 'app' })
    )
    await waitFor(() => expect(wv.getAttribute('src')).toBe('cherry-miniapp://com.example.a/index.html'))
  })

  it('does not contact a Fake website before native emulation is ready', async () => {
    let ready: () => void = () => {}
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'webview.region.prepare') return { partition: 'persist:webview-us:google', fake: true }
      if (route === 'webview.region.wait_until_ready')
        return new Promise<void>((resolve) => {
          ready = resolve
        })
      return undefined
    })
    const container = renderWebview({ appid: 'google', url: 'https://google.com', kind: 'site' })
    const guest = await webviewIn(container)
    Object.defineProperty(guest, 'getWebContentsId', { value: () => 7 })
    expect(guest).toHaveAttribute('src', 'about:blank')
    await act(async () => {
      guest.dispatchEvent(new Event('dom-ready'))
    })
    expect(guest).toHaveAttribute('src', 'about:blank')
    await act(async () => ready())
    expect(guest).toHaveAttribute('src', 'https://google.com')
    expect(guest).toHaveAttribute('partition', 'persist:webview-us:google')
  })

  it('recreates Fake guests on country changes while preserving Default guests', async () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'app.developer_mode.enabled': true,
      'feature.mini_app.fake_environment.enabled': true,
      'feature.mini_app.us_environment_app_ids': ['chatgpt']
    })
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route !== 'webview.region.prepare') return undefined
      const active =
        (input as { appId: string }).appId === 'chatgpt' &&
        MockUsePreferenceUtils.getPreferenceValue('app.developer_mode.enabled')
      return {
        partition: active
          ? `persist:fake:${MockUsePreferenceUtils.getPreferenceValue('feature.mini_app.fake_environment.country')}`
          : 'persist:webview',
        fake: Boolean(active)
      }
    })
    const props = {
      kind: 'site' as const,
      url: 'https://example.com',
      onSetRefCallback: vi.fn(),
      onLoadedCallback: vi.fn(),
      onNavigateCallback: vi.fn()
    }
    const views = () => (
      <>
        <WebviewContainer {...props} appid="chatgpt" />
        <WebviewContainer {...props} appid="default-app" />
      </>
    )
    const { container, rerender } = render(views())
    await waitFor(() => expect(container.querySelectorAll('webview')).toHaveLength(2))
    const initialFake = container.querySelector('[data-mini-app-id="chatgpt"]')!
    const originalDefault = container.querySelector('[data-mini-app-id="default-app"]')!
    MockUsePreferenceUtils.setPreferenceValue('feature.mini_app.fake_environment.country', 'JP')
    rerender(views())
    await waitFor(() =>
      expect(container.querySelector('[data-mini-app-id="chatgpt"]')).toHaveAttribute('partition', 'persist:fake:JP')
    )
    expect(container.querySelector('[data-mini-app-id="chatgpt"]')).not.toBe(initialFake)
    expect(container.querySelector('[data-mini-app-id="default-app"]')).toBe(originalDefault)
    MockUsePreferenceUtils.setPreferenceValue('app.developer_mode.enabled', false)
    rerender(views())
    await waitFor(() =>
      expect(container.querySelector('[data-mini-app-id="chatgpt"]')).toHaveAttribute('partition', 'persist:webview')
    )
  })

  it('does not fall back to the system environment when native emulation fails', async () => {
    vi.mocked(ipcApi.request).mockImplementation(async (route) => {
      if (route === 'webview.region.prepare') return { partition: 'persist:webview-us:google', fake: true }
      if (route === 'webview.region.wait_until_ready') throw new Error('Debugger unavailable')
      return undefined
    })
    const container = renderWebview({ appid: 'google', url: 'https://google.com', kind: 'site' })
    const guest = await webviewIn(container)
    Object.defineProperty(guest, 'getWebContentsId', { value: () => 7 })
    await act(async () => {
      guest.dispatchEvent(new Event('dom-ready'))
    })
    expect(container.querySelector('webview')).toBeNull()
    expect(container).toHaveTextContent('miniApp.region.failed')
  })

  it('surfaces a prepare failure instead of spinning forever', async () => {
    vi.mocked(ipcApi.request).mockRejectedValue(new Error('no such app'))

    const container = renderWebview({
      appid: 'com.example.a',
      url: 'cherry-miniapp://com.example.a/index.html',
      kind: 'app'
    })

    await waitFor(() => expect(container.querySelector('[data-mini-app-prepare-failed]')).not.toBeNull())
    expect(container.querySelector('webview')).toBeNull()
  })
})

describe('WebviewContainer update check on open', () => {
  it('paints before the update check answers at all', async () => {
    // A check that NEVER settles. An implementation that awaits it anywhere on the way
    // to 'ready' — even behind a catch — leaves this webview unmounted; an immediately
    // rejecting check would let that implementation pass.
    vi.mocked(ipcApi.request).mockImplementation(async (route: string) => {
      if (route === 'mini_app.update.check_on_open') return new Promise<never>(() => {})
      return undefined
    })

    const container = renderWebview({
      appid: 'com.example.mygame',
      url: 'cherry-miniapp://com.example.mygame/index.html',
      kind: 'app'
    })

    await webviewIn(container)
    // The check is fired from a passive effect, which can land after the element does.
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('mini_app.update.check_on_open', { appId: 'com.example.mygame' })
    )
  })

  it('keeps the webview up when the update check rejects', async () => {
    // Offline is not a failed launch: a rejection must not take the webview down.
    vi.mocked(ipcApi.request).mockImplementation(async (route: string) => {
      if (route === 'mini_app.update.check_on_open') throw new Error('offline')
      return undefined
    })

    const container = renderWebview({
      appid: 'com.example.mygame',
      url: 'cherry-miniapp://com.example.mygame/index.html',
      kind: 'app'
    })

    await webviewIn(container)
    await waitFor(() =>
      expect(ipcApi.request).toHaveBeenCalledWith('mini_app.update.check_on_open', { appId: 'com.example.mygame' })
    )
    expect(container.querySelector('webview')).not.toBeNull()
  })
})
