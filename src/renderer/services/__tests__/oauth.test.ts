// @vitest-environment jsdom
import { loggerService } from '@logger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  }
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key },
  getLanguageCode: async () => 'en'
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { on: vi.fn(() => () => {}), request: vi.fn() }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn() }
}))

import { listenForPopupMessage } from '../popupMessage'
import { oauthWith302AI, oauthWithAiOnly, oauthWithSiliconFlow } from '../oauth'

function fakeWindow(): Window {
  return { closed: false } as unknown as Window
}

function postMessage(data: unknown, source: unknown = null): void {
  window.dispatchEvent(new MessageEvent('message', { data, source }))
}

describe('listenForPopupMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers a matching payload exactly once and removes the listener', async () => {
    const popup = fakeWindow()
    const setKey = vi.fn()
    const isExpected = (d: unknown): d is string => typeof d === 'string'
    listenForPopupMessage({ popup, isExpected, onMessage: setKey })

    postMessage('the-key', popup)
    postMessage('the-key', popup)

    await vi.runAllTimersAsync()
    expect(setKey).toHaveBeenCalledTimes(1)
  })

  it('never throws on null / string / unrelated payloads', async () => {
    const popup = fakeWindow()
    const onMessage = vi.fn()
    listenForPopupMessage({ popup, isExpected: (d): d is string => typeof d === 'string', onMessage })

    expect(() => {
      postMessage(null, popup)
      postMessage({ other: 'shape' }, popup)
      postMessage(undefined, popup)
    }).not.toThrow()
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('ignores messages whose source is not the popup', () => {
    const popup = fakeWindow()
    const onMessage = vi.fn()
    listenForPopupMessage({ popup, isExpected: (d): d is string => typeof d === 'string', onMessage })

    postMessage('the-key', fakeWindow())
    postMessage('the-key', null)

    expect(onMessage).not.toHaveBeenCalled()
  })

  it('cleans up when the popup is closed by the user', () => {
    const popup = fakeWindow()
    const onMessage = vi.fn()
    listenForPopupMessage({ popup, isExpected: (d): d is string => typeof d === 'string', onMessage })

    ;(popup as unknown as { closed: boolean }).closed = true
    vi.advanceTimersByTime(1500)

    postMessage('the-key', popup)
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('does not arm a listener at all when the popup was blocked', () => {
    const onMessage = vi.fn()
    listenForPopupMessage({ popup: null, isExpected: (d): d is string => typeof d === 'string', onMessage })

    postMessage('the-key', null)
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('removes the listener when onMessage throws', async () => {
    const popup = fakeWindow()
    const boom = vi.fn(() => {
      throw new Error('boom')
    })
    listenForPopupMessage({ popup, isExpected: (d): d is string => typeof d === 'string', onMessage: boom })

    expect(() => postMessage('k', popup)).not.toThrow()
    postMessage('k', popup)

    await vi.runAllTimersAsync()
    expect(boom).toHaveBeenCalledTimes(1)
  })
})

describe('oauth flows use the popup listener helper (#19210)', () => {
  const popups: Window[] = []

  beforeEach(() => {
    popups.length = 0
    vi.spyOn(window, 'open').mockImplementation(() => {
      const w = fakeWindow()
      popups.push(w)
      return w
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('oauthWithSiliconFlow sets the key once and removes its listener', async () => {
    const setKey = vi.fn()
    await oauthWithSiliconFlow(setKey)

    postMessage([{ secretKey: 'sk-sf' }], popups[0])
    postMessage([{ secretKey: 'sk-sf' }], popups[0])

    expect(setKey).toHaveBeenCalledTimes(1)
    expect(setKey).toHaveBeenCalledWith('sk-sf')
  })

  it('oauthWithSiliconFlow ignores same-shaped payloads from other windows', async () => {
    const setKey = vi.fn()
    await oauthWithSiliconFlow(setKey)

    // A stale flow's message shape arriving from a foreign source.
    postMessage([{ secretKey: 'sk-evil' }], fakeWindow())

    expect(setKey).not.toHaveBeenCalled()
  })

  it('oauthWithAiOnly completes exactly once', async () => {
    const setKey = vi.fn()
    await oauthWithAiOnly(setKey)

    postMessage([{ secretKey: 'sk-only' }], popups[0])
    postMessage([{ secretKey: 'sk-only' }], popups[0])

    expect(setKey).toHaveBeenCalledTimes(1)
  })

  it('oauthWith302AI tolerates null-data messages', async () => {
    const setKey = vi.fn()
    await oauthWith302AI(setKey)

    expect(() => postMessage(null, popups[0])).not.toThrow()
    postMessage({ data: { apikey: 'k302' } }, popups[0])

    expect(setKey).toHaveBeenCalledTimes(1)
    expect(setKey).toHaveBeenCalledWith('k302')
  })
})

// keep the logger import referenced for the module graph under test
void loggerService
