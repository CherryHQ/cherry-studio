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

import WebviewContainer from '../WebviewContainer'

describe('WebviewContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
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
      webview?.dispatchEvent(new Event('did-start-loading'))
      vi.advanceTimersByTime(100)
    })

    expect(onLoaded).not.toHaveBeenCalled()
  })

  it('waits for an ignoring-cache reload before reporting an OpenClaw navigation as loaded', () => {
    const onLoaded = vi.fn()
    const reloadIgnoringCache = vi.fn()
    const { container } = render(
      <WebviewContainer
        appid="openclaw-dashboard"
        url="http://127.0.0.1:18790/?cherry_cache_bust=1#token=test"
        reloadIgnoringCacheOnNavigation
        onSetRefCallback={vi.fn()}
        onLoadedCallback={onLoaded}
        onNavigateCallback={vi.fn()}
      />
    )
    const webview = container.querySelector('webview')
    Object.defineProperty(webview, 'reloadIgnoringCache', { value: reloadIgnoringCache })

    act(() => {
      webview?.dispatchEvent(new Event('did-finish-load'))
      vi.advanceTimersByTime(100)
    })

    expect(reloadIgnoringCache).toHaveBeenCalledOnce()
    expect(onLoaded).not.toHaveBeenCalled()

    act(() => {
      webview?.dispatchEvent(new Event('did-finish-load'))
      vi.advanceTimersByTime(100)
    })

    expect(reloadIgnoringCache).toHaveBeenCalledOnce()
    expect(onLoaded).toHaveBeenCalledOnce()
  })
})
