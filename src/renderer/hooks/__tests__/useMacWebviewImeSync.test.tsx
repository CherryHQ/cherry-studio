// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WEBVIEW_COMPOSITION_CHANNEL } from '@shared/utils/webviewKey'

const mocks = vi.hoisted(() => ({
  releaseDocumentFocus: vi.fn(),
  isMac: true
}))

vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return mocks.isMac
  }
}))

vi.mock('@renderer/utils/webviewDocumentFocus', () => ({
  releaseDocumentFocus: mocks.releaseDocumentFocus,
  CLAIM_DOCUMENT_FOCUS_SCRIPT: '(function claimDocumentFocus(){})()'
}))

import { syncMacWebviewIme, useMacWebviewImeSync } from '../useMacWebviewImeSync'

function createGuest() {
  const listeners = new Map<string, Set<EventListener>>()
  const executeJavaScript = vi.fn().mockResolvedValue(undefined)
  const webview = {
    executeJavaScript,
    addEventListener: (type: string, listener: EventListener) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener)
    },
    dispatch: (type: string, event: Event) => {
      for (const listener of listeners.get(type) ?? []) listener(event)
    }
  }
  return { webview: webview as unknown as WebviewTag & { dispatch: typeof webview.dispatch }, executeJavaScript }
}

function setActiveElement(element: object | null) {
  Object.defineProperty(document, 'activeElement', {
    configurable: true,
    get: () => element
  })
}

describe('useMacWebviewImeSync', () => {
  beforeEach(() => {
    mocks.isMac = true
    mocks.releaseDocumentFocus.mockClear()
    setActiveElement(document.body)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not clear host selection on ready/settle/resize while the webview is unfocused', () => {
    // Bug this catches: unfocused ready/settle/resize must not wipe host selection
    // (composer caret / chrome focus) via releaseDocumentFocus.
    const { webview, executeJavaScript } = createGuest()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })

    renderHook(() => useMacWebviewImeSync(webview, true))
    act(() => {
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(50)
      vi.advanceTimersByTime(300)
    })

    expect(mocks.releaseDocumentFocus).not.toHaveBeenCalled()
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('reclaims guest document focus after ready when the webview already owns focus', () => {
    // Bug this catches: without a post-ready claim, macOS keeps launch-time caret
    // screen coordinates and places the candidate window ~sidebar-width away.
    const { webview, executeJavaScript } = createGuest()
    setActiveElement(webview)
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })

    renderHook(() => useMacWebviewImeSync(webview, true))

    expect(mocks.releaseDocumentFocus).toHaveBeenCalled()
    expect(executeJavaScript).toHaveBeenCalledWith('(function claimDocumentFocus(){})()')

    raf.mockRestore()
  })

  it('re-syncs on focus and debounced window resize, but not while the guest is composing', () => {
    const { webview, executeJavaScript } = createGuest()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })

    renderHook(() => useMacWebviewImeSync(webview, true))
    mocks.releaseDocumentFocus.mockClear()
    executeJavaScript.mockClear()

    act(() => {
      setActiveElement(webview)
      webview.dispatch('focus', new Event('focus'))
    })
    expect(mocks.releaseDocumentFocus).toHaveBeenCalledOnce()
    expect(executeJavaScript).toHaveBeenCalledOnce()

    act(() => {
      webview.dispatch(
        'ipc-message',
        Object.assign(new Event('ipc-message'), {
          channel: WEBVIEW_COMPOSITION_CHANNEL,
          args: [{ composing: true }]
        })
      )
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(50)
    })
    expect(mocks.releaseDocumentFocus).toHaveBeenCalledOnce()

    act(() => {
      webview.dispatch(
        'ipc-message',
        Object.assign(new Event('ipc-message'), {
          channel: WEBVIEW_COMPOSITION_CHANNEL,
          args: [{ composing: false }]
        })
      )
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(50)
    })
    expect(mocks.releaseDocumentFocus).toHaveBeenCalledTimes(2)
  })

  it('does nothing when disabled off macOS or before the guest is ready', () => {
    const { webview, executeJavaScript } = createGuest()
    setActiveElement(webview)
    mocks.isMac = false
    renderHook(() => useMacWebviewImeSync(webview, true))
    expect(mocks.releaseDocumentFocus).not.toHaveBeenCalled()

    mocks.isMac = true
    renderHook(() => useMacWebviewImeSync(webview, false))
    expect(mocks.releaseDocumentFocus).not.toHaveBeenCalled()
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('exposes syncMacWebviewIme for one-shot host callers only when focused', () => {
    const { webview, executeJavaScript } = createGuest()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    syncMacWebviewIme(webview)
    expect(mocks.releaseDocumentFocus).not.toHaveBeenCalled()

    setActiveElement(webview)
    syncMacWebviewIme(webview)
    expect(mocks.releaseDocumentFocus).toHaveBeenCalledOnce()
    expect(executeJavaScript).toHaveBeenCalledOnce()
  })

  it('swallows deferred executeJavaScript rejection when the guest detaches', async () => {
    // Bug this catches: void+try/catch alone leaves an unhandled rejection if the
    // guest tears down before the deferred claim settles.
    const { webview, executeJavaScript } = createGuest()
    setActiveElement(webview)
    executeJavaScript.mockRejectedValue(new Error('webview destroyed'))
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })

    expect(() => syncMacWebviewIme(webview)).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(executeJavaScript).toHaveBeenCalled()
  })
})
