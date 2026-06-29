import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// AI stream calls go through ipcApi now; this suite only exercises the no-overlay no-op
// path (no streams flow), so a static mock that never crashes is enough.
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn().mockResolvedValue(undefined), on: vi.fn(() => () => {}) }
}))

import { useTranslateMessage } from '../useTranslateMessage'

/**
 * Regression: rendered with NO `TranslationOverlaySetterProvider` ancestor
 * (the agent-session / quick-assistant case), the hook must not throw and
 * `translate` must be a safe no-op — it used to crash via the strict
 * `useTranslationOverlaySetter()` guard.
 */
describe('useTranslateMessage without a translation-overlay provider', () => {
  const translateOpen = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('window', {
      api: {
        translate: { open: translateOpen }
      }
    } as unknown as Window & typeof globalThis)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    translateOpen.mockReset()
  })

  it('mounts without throwing', () => {
    expect(() => renderHook(() => useTranslateMessage('msg-1'))).not.toThrow()
  })

  it('translate() is a no-op (never opens a stream) when no overlay sink', async () => {
    const { result } = renderHook(() => useTranslateMessage('msg-1'))

    await act(async () => {
      await result.current.translate('hello', { langCode: 'en-us' } as never)
    })

    expect(translateOpen).not.toHaveBeenCalled()
  })
})
