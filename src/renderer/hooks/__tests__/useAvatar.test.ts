import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcRequest = vi.fn()
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: (...args: any[]) => ipcRequest(...args) } }))

import UserAvatar from '@renderer/assets/images/avatar.webp'

import useAvatar from '../useAvatar'

beforeEach(() => {
  vi.clearAllMocks()
  MockUsePreferenceUtils.resetMocks()
})

describe('useAvatar', () => {
  it('returns an emoji avatar verbatim without touching the file IPC', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.user.avatar', '🙂')

    const { result } = renderHook(() => useAvatar())

    expect(result.current).toBe('🙂')
    expect(ipcRequest).not.toHaveBeenCalled()
  })

  it('falls back to the bundled default for an empty preference', () => {
    MockUsePreferenceUtils.setPreferenceValue('app.user.avatar', '')

    const { result } = renderHook(() => useAvatar())

    expect(result.current).toBe(UserAvatar)
    expect(ipcRequest).not.toHaveBeenCalled()
  })

  it('resolves a file:<id> avatar to a file:// url via file.batch_get_physical_paths', async () => {
    ipcRequest.mockResolvedValue({ 'id-1': '/data/files/id-1.webp' })
    MockUsePreferenceUtils.setPreferenceValue('app.user.avatar', 'file:id-1')

    const { result } = renderHook(() => useAvatar())

    await waitFor(() => expect(result.current).toMatch(/^file:\/\/.*id-1\.webp$/))
    expect(ipcRequest).toHaveBeenCalledWith('file.batch_get_physical_paths', { ids: ['id-1'] })
  })

  it('falls back to the default when the resolved path is missing', async () => {
    ipcRequest.mockResolvedValue({}) // no path for the id
    MockUsePreferenceUtils.setPreferenceValue('app.user.avatar', 'file:id-2')

    const { result } = renderHook(() => useAvatar())

    await waitFor(() => expect(ipcRequest).toHaveBeenCalled())
    expect(result.current).toBe(UserAvatar)
  })

  it('falls back to the default when the file IPC rejects', async () => {
    ipcRequest.mockRejectedValue(new Error('ipc boom'))
    MockUsePreferenceUtils.setPreferenceValue('app.user.avatar', 'file:id-3')

    const { result } = renderHook(() => useAvatar())

    await waitFor(() => expect(ipcRequest).toHaveBeenCalled())
    expect(result.current).toBe(UserAvatar)
  })

  it('keeps the current avatar when an older file resolution completes later', async () => {
    let resolveOld!: (value: Record<string, string>) => void
    let resolveCurrent!: (value: Record<string, string>) => void
    const oldRequest = new Promise<Record<string, string>>((resolve) => {
      resolveOld = resolve
    })
    const currentRequest = new Promise<Record<string, string>>((resolve) => {
      resolveCurrent = resolve
    })
    ipcRequest.mockReturnValueOnce(oldRequest).mockReturnValueOnce(currentRequest)
    MockUsePreferenceUtils.setPreferenceValue('app.user.avatar', 'file:id-4')

    const { result, rerender } = renderHook(() => useAvatar())
    expect(result.current).toBe(UserAvatar)

    MockUsePreferenceUtils.setPreferenceValue('app.user.avatar', 'file:id-5')
    rerender()
    expect(ipcRequest).toHaveBeenNthCalledWith(2, 'file.batch_get_physical_paths', { ids: ['id-5'] })

    await act(async () => {
      resolveCurrent({ 'id-5': '/data/files/id-5.webp' })
      await currentRequest
    })
    expect(result.current).toBe('file:///data/files/id-5.webp')

    await act(async () => {
      resolveOld({ 'id-4': '/data/files/id-4.webp' })
      await oldRequest
    })
    expect(result.current).toBe('file:///data/files/id-5.webp')
  })
})
