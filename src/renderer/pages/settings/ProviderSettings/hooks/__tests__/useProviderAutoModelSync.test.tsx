import { renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
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
const updateProviderMock = vi.fn()

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: (...args: any[]) => loggerInfoMock(...args),
      error: (...args: any[]) => loggerErrorMock(...args)
    })
  }
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args),
  useProviderApiKeys: (...args: any[]) => useProviderApiKeysMock(...args)
}))

vi.mock('@renderer/hooks/useModel', () => ({
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
    updateProviderMock.mockResolvedValue(undefined)

    useProviderMock.mockReturnValue({
      provider: {
        id: 'openai',
        isEnabled: false,
        defaultChatEndpoint: 'openai_chat_completions',
        endpointConfigs: {
          openai_chat_completions: { baseUrl: 'https://api.openai.com/v1' }
        }
      },
      updateProvider: updateProviderMock
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

  it('skips auto sync for API-key providers (uses pull reconcile instead)', async () => {
    renderHook(() => useProviderAutoModelSync('openai'))

    await waitFor(() =>
      expect(loggerInfoMock).toHaveBeenCalledWith('Skipping provider auto model sync', {
        providerId: 'openai',
        reason: 'uses_pull_reconcile'
      })
    )
    expect(syncProviderModelsMock).not.toHaveBeenCalled()
  })

  it('auto syncs for non-key providers (e.g. Ollama) when models are missing', async () => {
    syncProviderModelsMock.mockResolvedValueOnce([{ id: 'ollama::llama3.2' }])
    useProviderMock.mockReturnValue({
      provider: {
        id: 'ollama',
        isEnabled: false,
        defaultChatEndpoint: 'ollama_chat',
        endpointConfigs: {
          ollama_chat: { baseUrl: 'http://localhost:11434' }
        }
      },
      updateProvider: updateProviderMock
    })
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [] }
    })

    renderHook(() => useProviderAutoModelSync('ollama'))

    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true }))
  })

  it('syncs only once for the same initial eligible configuration (non-key provider)', async () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'ollama',
        isEnabled: false,
        defaultChatEndpoint: 'ollama_chat',
        endpointConfigs: {
          ollama_chat: { baseUrl: 'http://localhost:11434' }
        }
      },
      updateProvider: updateProviderMock
    })
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [] }
    })
    syncProviderModelsMock.mockResolvedValue([])

    const { rerender } = renderHook(() => useProviderAutoModelSync('ollama'))

    await waitFor(() => expect(syncProviderModelsMock).toHaveBeenCalledTimes(1))

    rerender()

    await waitFor(() => expect(syncProviderModelsMock).toHaveBeenCalledTimes(1))
  })

  it('launches a single sync under StrictMode double-invocation', async () => {
    // StrictMode invokes effects twice in dev. `autoSyncDecision` is memoized and
    // does not observe the in-effect ref, so both invocations see shouldSync:true;
    // without the synchronous re-entrancy guard this fires two concurrent /models
    // mutations, one of which SWR discards as `undefined` and the caller spreads
    // ("created is not iterable"). The guard must collapse them to one launch.
    useProviderMock.mockReturnValue({
      provider: {
        id: 'ollama',
        isEnabled: false,
        defaultChatEndpoint: 'ollama_chat',
        endpointConfigs: {
          ollama_chat: { baseUrl: 'http://localhost:11434' }
        }
      },
      updateProvider: updateProviderMock
    })
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [] }
    })
    syncProviderModelsMock.mockResolvedValueOnce([{ id: 'ollama::llama3.2' }])

    renderHook(() => useProviderAutoModelSync('ollama'), { wrapper: StrictMode })

    await waitFor(() => expect(syncProviderModelsMock).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(syncProviderModelsMock).toHaveBeenCalledTimes(1)
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

  it('auto-syncs an external-cli provider even while it is still disabled', async () => {
    // claude-code is agent-only/undeletable and never chat-visible, so it is
    // exempt from the login gate: its registry catalog must materialize (and the
    // provider enable) regardless of CLI login state, so agents can pick a model.
    // It carries no API key — models come from the shipped registry catalog.
    useProviderMock.mockReturnValue({
      provider: {
        id: 'claude-code',
        isEnabled: false,
        authMethods: ['external-cli'],
        modelListSource: 'registry',
        defaultChatEndpoint: 'anthropic_messages',
        endpointConfigs: {
          anthropic_messages: { baseUrl: 'https://api.anthropic.com' }
        }
      },
      updateProvider: updateProviderMock
    })
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [] }
    })
    syncProviderModelsMock.mockResolvedValueOnce([{ id: 'claude-code::claude-sonnet' }])

    renderHook(() => useProviderAutoModelSync('claude-code'))

    await waitFor(() => expect(syncProviderModelsMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true }))
  })

  it('does not sync or enable a login provider until it is signed in', async () => {
    // Registry login providers ship disabled; visiting their settings page before
    // login must NOT sync (which would materialize models) or enable them — the
    // login flow flips isEnabled, which is the signal this hook waits for.
    useProviderMock.mockReturnValue({
      provider: {
        id: 'openai-codex',
        isEnabled: false,
        authMethods: ['oauth'],
        modelListSource: 'registry',
        defaultChatEndpoint: 'openai_responses',
        endpointConfigs: {
          openai_responses: { baseUrl: 'https://chatgpt.com/backend-api/codex' }
        }
      },
      updateProvider: updateProviderMock
    })
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [] }
    })

    renderHook(() => useProviderAutoModelSync('openai-codex'))

    await waitFor(() =>
      expect(loggerInfoMock).toHaveBeenCalledWith('Skipping provider auto model sync', {
        providerId: 'openai-codex',
        reason: 'login_required'
      })
    )
    expect(syncProviderModelsMock).not.toHaveBeenCalled()
    expect(updateProviderMock).not.toHaveBeenCalled()
  })

  it('skips auto sync for API-key provider even after key rotation (pull reconcile handles it)', async () => {
    const { rerender } = renderHook(() => useProviderAutoModelSync('openai'))

    // First render with keys → uses_pull_reconcile
    await waitFor(() =>
      expect(loggerInfoMock).toHaveBeenCalledWith('Skipping provider auto model sync', {
        providerId: 'openai',
        reason: 'uses_pull_reconcile'
      })
    )

    // Keys removed
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

    // Keys restored — still uses pull reconcile, no direct sync
    useProviderApiKeysMock.mockReturnValue({
      data: { keys: [{ id: 'key-1', key: 'sk-test', isEnabled: true }] }
    })
    rerender()

    await waitFor(() =>
      expect(loggerInfoMock).toHaveBeenCalledWith('Skipping provider auto model sync', {
        providerId: 'openai',
        reason: 'uses_pull_reconcile'
      })
    )
    expect(syncProviderModelsMock).not.toHaveBeenCalled()
  })
})
