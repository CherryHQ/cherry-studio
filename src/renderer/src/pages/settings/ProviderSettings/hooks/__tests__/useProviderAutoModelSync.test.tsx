import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PROVIDER_SETTINGS_MODEL_SWR_OPTIONS } from '../providerSetting/constants'
import { useProviderAutoModelSync } from '../providerSetting/useProviderAutoModelSync'

const loggerInfoMock = vi.fn()
const loggerErrorMock = vi.fn()
const useProviderMock = vi.fn()
const useProviderApiKeysMock = vi.fn()
const useModelsMock = vi.fn()
const useProviderModelSyncMock = vi.fn()
const syncProviderModelsMock = vi.fn()

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: (...args: any[]) => loggerInfoMock(...args),
      error: (...args: any[]) => loggerErrorMock(...args)
    })
  }
}))

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args)
}))

vi.mock('@renderer/hooks/useModels', () => ({
  useModels: (...args: any[]) => useModelsMock(...args),
  useModelMutations: () => ({
    createModels: vi.fn(),
    isCreating: false
  })
}))

vi.mock('../useProviderModelSync', () => ({
  useProviderModelSync: (...args: any[]) => useProviderModelSyncMock(...args)
}))

describe('useProviderAutoModelSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    syncProviderModelsMock.mockResolvedValue([])

    useProviderMock.mockReturnValue({
      provider: {
        id: 'openai',
        defaultChatEndpoint: 'openai_chat_completions',
        endpointConfigs: {
          openai_chat_completions: { baseUrl: 'https://api.openai.com/v1' }
        }
      }
    })
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ id: 'key-1', key: 'sk-test', isEnabled: true }] }
    })
    useModelsMock.mockReturnValue({
      models: []
    })
    useProviderModelSyncMock.mockReturnValue({
      syncProviderModels: syncProviderModelsMock,
      isSyncingModels: false
    })
  })

  it('internalizes provider, api key, model, and sync dependencies behind providerId', async () => {
    renderHook(() => useProviderAutoModelSync('openai'))

    expect(useProviderMock).toHaveBeenCalledWith('openai')
    expect(useProviderApiKeysMock).toHaveBeenCalledWith('openai')
    expect(useModelsMock).toHaveBeenCalledWith(
      { providerId: 'openai' },
      { swrOptions: PROVIDER_SETTINGS_MODEL_SWR_OPTIONS }
    )
    expect(useProviderModelSyncMock).toHaveBeenCalledWith('openai', { existingModels: [] })
  })

  it('syncs only once for the same initial eligible configuration', async () => {
    const { rerender } = renderHook(() => useProviderAutoModelSync('openai'))

    await waitFor(() =>
      expect(syncProviderModelsMock).toHaveBeenCalledWith(useProviderMock.mock.results[0].value.provider)
    )
    expect(syncProviderModelsMock).toHaveBeenCalledTimes(1)

    rerender()

    await waitFor(() => expect(syncProviderModelsMock).toHaveBeenCalledTimes(1))
  })

  it('logs when auto sync is skipped because no api keys are available', async () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'silicon',
        defaultChatEndpoint: 'openai_chat_completions',
        endpointConfigs: {
          openai_chat_completions: { baseUrl: 'https://api.siliconflow.cn/v1' }
        }
      }
    })
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [] }
    })

    renderHook(() => useProviderAutoModelSync('silicon'))

    await waitFor(() =>
      expect(loggerInfoMock).toHaveBeenCalledWith('Skipping provider auto model sync', {
        providerId: 'silicon',
        reason: 'no_api_keys'
      })
    )
    expect(syncProviderModelsMock).not.toHaveBeenCalled()
  })

  it('logs auto sync failures and allows retrying when the same signature becomes eligible again', async () => {
    const syncError = new Error('sync down')
    syncProviderModelsMock.mockRejectedValueOnce(syncError).mockResolvedValueOnce([])

    const { rerender } = renderHook(() => useProviderAutoModelSync('openai'))

    await waitFor(() =>
      expect(loggerErrorMock).toHaveBeenCalledWith('Provider auto model sync failed', {
        providerId: 'openai',
        error: syncError
      })
    )

    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [] }
    })
    rerender()

    await waitFor(() =>
      expect(loggerInfoMock).toHaveBeenCalledWith('Skipping provider auto model sync', {
        providerId: 'openai',
        reason: 'no_api_keys'
      })
    )

    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ id: 'key-1', key: 'sk-test', isEnabled: true }] }
    })
    rerender()

    await waitFor(() => expect(syncProviderModelsMock).toHaveBeenCalledTimes(2))
  })
})
