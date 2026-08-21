// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [false]
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
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

import { MINI_APP_KEYDOWN_CHANNEL } from '@shared/utils/webviewKey'

import WebviewContainer from '../WebviewContainer'

const renderWebview = () => {
  const { container } = render(
    <WebviewContainer
      appid="chatgpt"
      url="https://chat.openai.com"
      onSetRefCallback={vi.fn()}
      onLoadedCallback={vi.fn()}
      onNavigateCallback={vi.fn()}
    />
  )
  const webview = container.querySelector('webview')!
  expect(webview).not.toBeNull()
  return webview
}

const focusOn = (element: Element | null) => {
  Object.defineProperty(document, 'activeElement', { value: element, configurable: true })
}

const sendGuestKey = (webview: Element, payload: Record<string, unknown>) => {
  act(() => {
    webview.dispatchEvent(
      Object.assign(new Event('ipc-message'), { channel: MINI_APP_KEYDOWN_CHANNEL, args: [payload] })
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

  it('cancels a delayed loaded callback when the WebView is evicted', () => {
    const onLoaded = vi.fn()
    const { container, unmount } = render(
      <WebviewContainer
        appid="chatgpt"
        url="https://chat.openai.com"
        onSetRefCallback={vi.fn()}
        onLoadedCallback={onLoaded}
        onNavigateCallback={vi.fn()}
      />
    )
    const webview = container.querySelector('webview')
    expect(webview).not.toBeNull()

    act(() => {
      webview?.dispatchEvent(new Event('did-finish-load'))
    })
    unmount()
    act(() => {
      vi.advanceTimersByTime(100)
    })

    expect(onLoaded).not.toHaveBeenCalled()
  })

  it('reports the WebView as loaded when dom-ready is the only readiness event', () => {
    const onLoaded = vi.fn()
    const { container } = render(
      <WebviewContainer
        appid="chatgpt"
        url="https://chat.openai.com"
        onSetRefCallback={vi.fn()}
        onLoadedCallback={onLoaded}
        onNavigateCallback={vi.fn()}
      />
    )
    const webview = container.querySelector('webview')
    expect(webview).not.toBeNull()
    Object.defineProperty(webview, 'getWebContentsId', { value: () => 42 })

    act(() => {
      webview?.dispatchEvent(new Event('dom-ready'))
    })

    expect(onLoaded).toHaveBeenCalledOnce()
    expect(onLoaded).toHaveBeenCalledWith('chatgpt')
  })

  it('cancels the previous loaded callback when a new load cycle starts', () => {
    const onLoaded = vi.fn()
    const { container } = render(
      <WebviewContainer
        appid="chatgpt"
        url="https://chat.openai.com"
        onSetRefCallback={vi.fn()}
        onLoadedCallback={onLoaded}
        onNavigateCallback={vi.fn()}
      />
    )
    const webview = container.querySelector('webview')
    expect(webview).not.toBeNull()

    act(() => {
      webview?.dispatchEvent(new Event('did-finish-load'))
      webview?.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isInPlace: false, isMainFrame: true }))
      vi.advanceTimersByTime(100)
    })

    expect(onLoaded).not.toHaveBeenCalled()
  })

  it('keeps the delayed loaded callback for an in-place main-frame navigation', () => {
    const onLoaded = vi.fn()
    const { container } = render(
      <WebviewContainer
        appid="chatgpt"
        url="https://chat.openai.com"
        onSetRefCallback={vi.fn()}
        onLoadedCallback={onLoaded}
        onNavigateCallback={vi.fn()}
      />
    )
    const webview = container.querySelector('webview')
    expect(webview).not.toBeNull()

    act(() => {
      webview?.dispatchEvent(new Event('did-finish-load'))
      webview?.dispatchEvent(Object.assign(new Event('did-start-navigation'), { isInPlace: true, isMainFrame: true }))
      vi.advanceTimersByTime(100)
    })

    expect(onLoaded).toHaveBeenCalledWith('chatgpt')
  })

  it('replays a guest keydown on the host window, targeted at the WebView it came from', () => {
    const webview = renderWebview()
    focusOn(webview)
    const { seen, stop } = captureWindowKeydown()

    sendGuestKey(webview, { key: 'f', code: 'KeyF', ctrlKey: true, shiftKey: false, isTrusted: true })
    stop()

    expect(seen).toHaveLength(1)
    expect(seen[0].key).toBe('f')
    expect(seen[0].ctrlKey).toBe(true)
    expect(seen[0].target).toBe(webview)
  })

  it('drops a keydown the guest page synthesized instead of a real key press', () => {
    const webview = renderWebview()
    focusOn(webview)
    const { seen, stop } = captureWindowKeydown()

    sendGuestKey(webview, { key: 'f', code: 'KeyF', ctrlKey: true, isTrusted: false })
    stop()

    expect(seen).toHaveLength(0)
  })

  it('drops a guest keydown that arrives while the WebView is not focused', () => {
    const webview = renderWebview()
    focusOn(document.body)
    const { seen, stop } = captureWindowKeydown()

    sendGuestKey(webview, { key: 'f', code: 'KeyF', ctrlKey: true, isTrusted: true })
    stop()

    expect(seen).toHaveLength(0)
  })
})
