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

describe('useMacWebviewImeSync', () => {
  beforeEach(() => {
    mocks.isMac = true
    mocks.releaseDocumentFocus.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reclaims guest document focus after ready so cold-start IME uses a fresh caret rect', () => {
    // Bug this catches: without a post-ready claim, macOS keeps launch-time caret
    // screen coordinates and places the candidate window ~sidebar-width away.
    const { webview, executeJavaScript } = createGuest()
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
    mocks.isMac = false
    renderHook(() => useMacWebviewImeSync(webview, true))
    expect(mocks.releaseDocumentFocus).not.toHaveBeenCalled()

    mocks.isMac = true
    renderHook(() => useMacWebviewImeSync(webview, false))
    expect(mocks.releaseDocumentFocus).not.toHaveBeenCalled()
    expect(executeJavaScript).not.toHaveBeenCalled()
  })

  it('exposes syncMacWebviewIme for one-shot host callers', () => {
    const { webview, executeJavaScript } = createGuest()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0)
      return 1
    })
    syncMacWebviewIme(webview)
    expect(mocks.releaseDocumentFocus).toHaveBeenCalledOnce()
    expect(executeJavaScript).toHaveBeenCalledOnce()
  })
})
