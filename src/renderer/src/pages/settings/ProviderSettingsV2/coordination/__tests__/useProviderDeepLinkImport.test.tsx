import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderDeepLinkImport } from '../useProviderDeepLinkImport'

const createProviderMock = vi.fn()
const updateProviderByIdMock = vi.fn()
const addApiKeyTriggerMock = vi.fn()
const navigateMock = vi.fn()
const popupShowMock = vi.fn()

vi.mock('@renderer/hooks/useProviders', () => ({
  useProviders: () => ({
    createProvider: createProviderMock
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
    createProviderMock.mockResolvedValue({ id: 'openai' })
    updateProviderByIdMock.mockResolvedValue(undefined)
    addApiKeyTriggerMock.mockResolvedValue(undefined)
    ;(window as any).toast = {
      success: vi.fn(),
      error: vi.fn()
    }
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
      to: '/settings/provider-v2',
      search: { id: 'openai' }
    })
    expect(window.toast.success).toHaveBeenCalledTimes(1)
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
      to: '/settings/provider-v2',
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

    await waitFor(() => expect(window.toast.error).toHaveBeenCalledTimes(1))

    expect(popupShowMock).not.toHaveBeenCalled()
    expect(createProviderMock).not.toHaveBeenCalled()
    expect(updateProviderByIdMock).not.toHaveBeenCalled()
    expect(addApiKeyTriggerMock).not.toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider-v2' })
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

    await waitFor(() => expect(window.toast.error).toHaveBeenCalledTimes(1))

    expect(addApiKeyTriggerMock).not.toHaveBeenCalled()
    expect(onSelectProvider).not.toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/settings/provider-v2' })
  })
})
