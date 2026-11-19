import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import type * as AppErrorDetailService from '@renderer/services/AppErrorDetailService'

import { useMiniAppUpdate } from '../useMiniAppUpdate'

const toastAppError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/AppErrorDetailService', async (importOriginal) => ({
  ...(await importOriginal<typeof AppErrorDetailService>()),
  toastAppError
}))

describe('useMiniAppUpdate', () => {
  beforeEach(() => {
    vi.mocked(ipcApi.request).mockReset()
    toastAppError.mockReset()
  })

  it('titles a failed update check with the localized message and keeps the raw error as its cause', async () => {
    const failure = new Error('ECONNRESET socket hang up')
    vi.mocked(ipcApi.request).mockRejectedValue(failure)
    const { result } = renderHook(() => useMiniAppUpdate('app-1', { name: 'App' }))

    await act(() => result.current.check())

    const [title, cause] = toastAppError.mock.calls[0]
    expect(title).toBe(i18n.t('miniApp.detail.action_failed'))
    expect(title).not.toContain('ECONNRESET')
    expect(cause).toBe(failure)
  })
})
