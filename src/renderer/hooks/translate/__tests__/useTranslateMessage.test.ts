import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ipcRequestMock } = vi.hoisted(() => ({
  ipcRequestMock: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock, on: vi.fn(() => () => {}) }
}))

import { useTranslateMessage } from '../useTranslateMessage'

/**
 * Regression: rendered with NO `TranslationOverlaySetterProvider` ancestor
 * (the agent-session / quick-assistant case), the hook must not throw and
 * `translate` must be a safe no-op — it used to crash via the strict
 * `useTranslationOverlaySetter()` guard.
 */
describe('useTranslateMessage without a translation-overlay provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('translate() is a no-op (never opens a stream) when no overlay sink', async () => {
    const { result } = renderHook(() => useTranslateMessage('msg-1'))

    await act(async () => {
      await result.current.translate('hello', { langCode: 'en-us' } as never)
    })

    expect(ipcRequestMock).not.toHaveBeenCalled()
  })
})
