import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import {
  clearLastWrittenEndpointConfigs,
  getLastWrittenEndpointConfigs,
  setLastWrittenEndpointConfigs
} from '../providerSetting/endpointConfigsWriteCoordinator'
import { useProviderDeepLinkImport } from '../useProviderDeepLinkImport'

const createProviderMock = vi.fn()
const updateProviderByIdMock = vi.fn()
const addApiKeyTriggerMock = vi.fn()
const navigateMock = vi.fn()
const popupShowMock = vi.fn()
const refetchProvidersMock = vi.fn()
let providersFixture: Array<{ id: string; endpointConfigs?: Record<string, unknown> }> = []

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({
    createProvider: createProviderMock,
    providers: providersFixture,
    refetch: refetchProvidersMock
  }),
  useProviderActions: () => ({
    updateProviderById: updateProviderByIdMock
  })
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useMutation: () => ({
    trigger: addApiKeyTriggerMock
  })
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock
}))

vi.mock('../../UrlSchemaInfoPopup', () => ({
  default: {
    show: (...args: any[]) => popupShowMock(...args)
  }
}))

describe('useProviderDeepLinkImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providersFixture = []
    refetchProvidersMock.mockResolvedValue(undefined)
    clearLastWrittenEndpointConfigs('openai')
    clearLastWrittenEndpointConfigs('anthropic')
    clearLastWrittenEndpointConfigs('custom-vllm')
    createProviderMock.mockResolvedValue({ id: 'openai' })
    updateProviderByIdMock.mockResolvedValue(undefined)
    addApiKeyTriggerMock.mockResolvedValue(undefined)
  })

  it('creates a provider, posts the API key, and navigates for a valid deep link', async () => {
    const onSelectProvider = vi.fn()

    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        apiKey: 'sk-openai',
        apiHost: 'https://api.openai.com'
      },
      isNew: true,
      displayName: 'OpenAI'
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'openai',
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com',
          type: 'openai',
          name: 'OpenAI'
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(createProviderMock).toHaveBeenCalledTimes(1))

    expect(popupShowMock).toHaveBeenCalledWith({
      id: 'openai',
      apiKey: 'sk-openai',
      baseUrl: 'https://api.openai.com',
      type: 'openai',
      name: 'OpenAI'
    })
    expect(createProviderMock).toHaveBeenCalledWith({
      providerId: 'openai',
      name: 'OpenAI',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://api.openai.com'
        }
      }
    })
    expect(updateProviderByIdMock).not.toHaveBeenCalled()
    expect(addApiKeyTriggerMock).toHaveBeenCalledWith({
      params: { providerId: 'openai' },
      body: { key: 'sk-openai' }
    })
    expect(onSelectProvider).toHaveBeenCalledWith('openai')
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/settings/provider',
      search: { id: 'openai' }
    })
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('updates an existing provider when the deep link resolves to an existing entry', async () => {
    const onSelectProvider = vi.fn()

    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'anthropic',
        name: 'Anthropic',
        type: 'anthropic',
        apiKey: 'sk-anthropic',
        apiHost: 'https://api.anthropic.com'
      },
      isNew: false,
      displayName: 'Anthropic'
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'anthropic',
          apiKey: 'sk-anthropic',
          baseUrl: 'https://api.anthropic.com',
          type: 'anthropic',
          name: 'Anthropic'
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(updateProviderByIdMock).toHaveBeenCalledTimes(1))

    expect(createProviderMock).not.toHaveBeenCalled()
    expect(updateProviderByIdMock).toHaveBeenCalledWith('anthropic', {
      name: 'Anthropic',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: 'https://api.anthropic.com'
        }
      }
    })
    expect(addApiKeyTriggerMock).toHaveBeenCalledWith({
      params: { providerId: 'anthropic' },
      body: { key: 'sk-anthropic' }
    })
    expect(onSelectProvider).toHaveBeenCalledWith('anthropic')
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/settings/provider',
      search: { id: 'anthropic' }
    })
  })

  it('shows an error toast and clears the search state for invalid input', async () => {
    const onSelectProvider = vi.fn()

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: '',
          apiKey: 'sk-invalid',
          baseUrl: ''
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))

    expect(popupShowMock).not.toHaveBeenCalled()
    expect(createProviderMock).not.toHaveBeenCalled()
    expect(updateProviderByIdMock).not.toHaveBeenCalled()
    expect(addApiKeyTriggerMock).not.toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider' })
    expect(onSelectProvider).not.toHaveBeenCalled()
  })

  it('shows an error toast and clears the search state when provider import mutations fail', async () => {
    const onSelectProvider = vi.fn()
    createProviderMock.mockRejectedValue(new Error('create failed'))
    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        apiKey: 'sk-openai',
        apiHost: 'https://api.openai.com'
      },
      isNew: true,
      displayName: 'OpenAI'
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'openai',
          apiKey: 'sk-openai',
          baseUrl: 'https://api.openai.com',
          type: 'openai',
          name: 'OpenAI'
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))

    expect(addApiKeyTriggerMock).not.toHaveBeenCalled()
    expect(onSelectProvider).not.toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider' })
  })

  it('merges the imported host onto persisted endpoint configs for an existing provider', async () => {
    const onSelectProvider = vi.fn()
    const CHAT = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    const RESPONSES = ENDPOINT_TYPE.OPENAI_RESPONSES
    providersFixture = [
      {
        id: 'custom-vllm',
        endpointConfigs: {
          [CHAT]: { baseUrl: 'https://old-host/v1', reasoningFormat: { type: 'self-hosted' } },
          [RESPONSES]: { baseUrl: 'https://old-host/v1', reasoningFormat: { type: 'openai-responses' } }
        }
      }
    ]
    refetchProvidersMock.mockResolvedValue(providersFixture)

    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'custom-vllm',
        name: 'Custom vLLM',
        type: 'openai',
        apiKey: 'sk-custom',
        apiHost: 'https://new-host/v1'
      },
      isNew: false,
      displayName: 'Custom vLLM'
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'custom-vllm',
          apiKey: 'sk-custom',
          baseUrl: 'https://new-host/v1',
          type: 'openai',
          name: 'Custom vLLM'
        }),
        onSelectProvider
      )
    )

    const expectedEndpointConfigs = {
      [CHAT]: { baseUrl: 'https://new-host/v1', reasoningFormat: { type: 'self-hosted' } },
      [RESPONSES]: { baseUrl: 'https://old-host/v1', reasoningFormat: { type: 'openai-responses' } }
    }

    await waitFor(() => expect(updateProviderByIdMock).toHaveBeenCalledTimes(1))

    expect(updateProviderByIdMock).toHaveBeenCalledWith('custom-vllm', {
      name: 'Custom vLLM',
      defaultChatEndpoint: CHAT,
      endpointConfigs: expectedEndpointConfigs
    })
    expect(getLastWrittenEndpointConfigs('custom-vllm')).toEqual(expectedEndpointConfigs)
  })

  it('builds on the shared snapshot when refetch misses an in-flight drawer save', async () => {
    const onSelectProvider = vi.fn()
    const CHAT = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    providersFixture = [
      {
        id: 'custom-vllm',
        endpointConfigs: { [CHAT]: { baseUrl: 'https://old-host/v1' } }
      }
    ]
    // The refetch misses the in-flight drawer result, forcing the shared-snapshot fallback.
    refetchProvidersMock.mockResolvedValue(undefined)
    setLastWrittenEndpointConfigs('custom-vllm', {
      [CHAT]: { baseUrl: 'https://old-host/v1', reasoningFormat: { type: 'self-hosted' } }
    } as never)

    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'custom-vllm',
        name: 'Custom vLLM',
        type: 'openai',
        apiKey: 'sk-custom',
        apiHost: 'https://new-host/v1'
      },
      isNew: false,
      displayName: 'Custom vLLM'
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'custom-vllm',
          apiKey: 'sk-custom',
          baseUrl: 'https://new-host/v1',
          type: 'openai',
          name: 'Custom vLLM'
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(updateProviderByIdMock).toHaveBeenCalledTimes(1))

    // The refetch misses the in-flight drawer write, so the shared snapshot wins.
    expect(updateProviderByIdMock).toHaveBeenCalledWith('custom-vllm', {
      name: 'Custom vLLM',
      defaultChatEndpoint: CHAT,
      endpointConfigs: {
        [CHAT]: { baseUrl: 'https://new-host/v1', reasoningFormat: { type: 'self-hosted' } }
      }
    })
  })

  it('prefers the shared snapshot over a stale truthy refetch', async () => {
    const onSelectProvider = vi.fn()
    const CHAT = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    providersFixture = [
      {
        id: 'custom-vllm',
        endpointConfigs: { [CHAT]: { baseUrl: 'https://old-host/v1' } }
      }
    ]
    // The refetch resolves but hasn't observed the coordinated write yet.
    refetchProvidersMock.mockResolvedValue(providersFixture)
    setLastWrittenEndpointConfigs('custom-vllm', {
      [CHAT]: { baseUrl: 'https://old-host/v1', reasoningFormat: { type: 'self-hosted' } }
    } as never)

    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'custom-vllm',
        name: 'Custom vLLM',
        type: 'openai',
        apiKey: 'sk-custom',
        apiHost: 'https://new-host/v1'
      },
      isNew: false,
      displayName: 'Custom vLLM'
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'custom-vllm',
          apiKey: 'sk-custom',
          baseUrl: 'https://new-host/v1',
          type: 'openai',
          name: 'Custom vLLM'
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(updateProviderByIdMock).toHaveBeenCalledTimes(1))

    expect(updateProviderByIdMock).toHaveBeenCalledWith('custom-vllm', {
      name: 'Custom vLLM',
      defaultChatEndpoint: CHAT,
      endpointConfigs: {
        [CHAT]: { baseUrl: 'https://new-host/v1', reasoningFormat: { type: 'self-hosted' } }
      }
    })
  })
})
