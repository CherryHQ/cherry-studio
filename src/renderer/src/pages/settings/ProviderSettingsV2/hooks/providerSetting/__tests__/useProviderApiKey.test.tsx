import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderApiKey } from '../useProviderApiKey'

const updateApiKeysMock = vi.fn().mockResolvedValue(undefined)
const useProviderMock = vi.fn()
const useProviderApiKeysMock = vi.fn()
const useProviderMutationsMock = vi.fn()

let apiKeysData:
  | {
      keys: Array<{ id: string; key: string; isEnabled: boolean; label?: string }>
    }
  | undefined

vi.mock('../../../adapters/providerSettingsSideEffects', () => ({
  applyProviderApiKeySideEffects: vi.fn()
}))

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args),
  useProviderMutations: (...args: any[]) => useProviderMutationsMock(...args)
}))

describe('useProviderApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    apiKeysData = {
      keys: []
    }
    useProviderMock.mockReturnValue({
      provider: { id: 'openai', isEnabled: true }
    })
    useProviderApiKeysMock.mockImplementation(() => ({
      data: apiKeysData
    }))
    useProviderMutationsMock.mockReturnValue({
      updateApiKeys: updateApiKeysMock
    })
  })

  it('keeps the local api key input when slower server echoes older values', () => {
    const { result, rerender } = renderHook(() => useProviderApiKey('openai'))

    expect(result.current.inputApiKey).toBe('')
    expect(result.current.serverApiKey).toBe('')
    expect(result.current.hasPendingSync).toBe(false)

    act(() => {
      result.current.setInputApiKey('sk-latest')
    })

    expect(result.current.inputApiKey).toBe('sk-latest')
    expect(result.current.hasPendingSync).toBe(true)

    apiKeysData = {
      keys: [{ id: 'k1', key: 'sk-partial', isEnabled: true }]
    }
    rerender()
    expect(result.current.inputApiKey).toBe('sk-latest')
    expect(result.current.hasPendingSync).toBe(true)

    apiKeysData = {
      keys: [{ id: 'k1', key: 'sk-latest', isEnabled: true }]
    }
    rerender()
    expect(result.current.inputApiKey).toBe('sk-latest')
    expect(result.current.hasPendingSync).toBe(false)

    apiKeysData = {
      keys: [{ id: 'k1', key: 'sk-remote-change', isEnabled: true }]
    }
    rerender()
    expect(result.current.inputApiKey).toBe('sk-remote-change')
    expect(result.current.serverApiKey).toBe('sk-remote-change')
  })

  it('preserves disabled keys and labels when inline edits update enabled keys', async () => {
    apiKeysData = {
      keys: [
        { id: 'k1', key: 'sk-one', isEnabled: true, label: 'Primary' },
        { id: 'k2', key: 'sk-two', isEnabled: false, label: 'Backup' }
      ]
    }

    const { result } = renderHook(() => useProviderApiKey('openai'))

    act(() => {
      result.current.setInputApiKey('sk-updated')
    })

    await act(async () => {
      vi.runAllTimers()
    })

    expect(updateApiKeysMock).toHaveBeenCalledTimes(1)
    expect(updateApiKeysMock.mock.calls[0][0]).toEqual([
      { id: 'k1', key: 'sk-updated', isEnabled: true, label: 'Primary' },
      { id: 'k2', key: 'sk-two', isEnabled: false, label: 'Backup' }
    ])
  })

  it('filters blank and duplicate inline keys before persisting', async () => {
    apiKeysData = {
      keys: [{ id: 'k1', key: 'sk-existing', isEnabled: true, label: 'Primary' }]
    }

    const { result } = renderHook(() => useProviderApiKey('openai'))

    act(() => {
      result.current.setInputApiKey(' sk-next ,, sk-next ,   ')
    })

    await act(async () => {
      vi.runAllTimers()
    })

    expect(updateApiKeysMock).toHaveBeenCalledTimes(1)
    expect(updateApiKeysMock.mock.calls[0][0]).toEqual([
      { id: 'k1', key: 'sk-next', isEnabled: true, label: 'Primary' }
    ])
  })

  it('commits the current input immediately when requested', async () => {
    const { result } = renderHook(() => useProviderApiKey('openai'))

    act(() => {
      result.current.setInputApiKey('sk-now')
    })

    await act(async () => {
      await result.current.commitInputApiKeyNow()
    })

    expect(updateApiKeysMock).toHaveBeenCalledWith([{ id: expect.any(String), key: 'sk-now', isEnabled: true }])
  })

  it('keeps api key input local to each store', () => {
    const first = renderHook(() => useProviderApiKey('openai'))
    const second = renderHook(() => useProviderApiKey('openai'))

    act(() => {
      first.result.current.setInputApiKey('sk-shared')
    })

    expect(second.result.current.inputApiKey).toBe('')
  })
})
