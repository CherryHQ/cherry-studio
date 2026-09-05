import { toast } from '@renderer/services/toast'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderDeepLinkImport } from '../useProviderDeepLinkImport'

const createProviderMock = vi.fn()
const updateProviderByIdMock = vi.fn()
const createModelsMock = vi.fn()
const syncProviderModelsForProviderMock = vi.fn()
const addApiKeyTriggerMock = vi.fn()
const navigateMock = vi.fn()
const popupShowMock = vi.fn()

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({
    createProvider: createProviderMock
  }),
  useProviderActions: () => ({
    updateProviderById: updateProviderByIdMock
  })
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelMutations: () => ({
    createModels: createModelsMock
  })
}))

vi.mock('../useProviderModelSync', () => ({
  syncProviderModelsForProvider: (...args: any[]) => syncProviderModelsForProviderMock(...args)
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
    createModelsMock.mockResolvedValue([])
    syncProviderModelsForProviderMock.mockResolvedValue([])
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

  it('syncs models and enables the provider when the confirmed deep link opts in', async () => {
    const onSelectProvider = vi.fn()
    const persistedProvider = { id: 'everyapi', defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS }
    createProviderMock.mockResolvedValue(persistedProvider)
    syncProviderModelsForProviderMock.mockResolvedValue([{ id: 'everyapi::gpt-5' }])
    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'everyapi',
        name: 'EveryAPI',
        type: 'openai',
        apiKey: 'sk-everyapi',
        apiHost: 'https://api.everyapi.example/v1'
      },
      isNew: true,
      displayName: 'EveryAPI',
      autoSyncModels: true
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'everyapi',
          apiKey: 'sk-everyapi',
          baseUrl: 'https://api.everyapi.example/v1',
          type: 'openai',
          name: 'EveryAPI',
          autoSyncModels: true
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(onSelectProvider).toHaveBeenCalledWith('everyapi'))

    expect(syncProviderModelsForProviderMock).toHaveBeenCalledWith({
      providerId: 'everyapi',
      endpointProvider: persistedProvider,
      createModels: createModelsMock
    })
    expect(updateProviderByIdMock).toHaveBeenCalledWith('everyapi', { isEnabled: true })
  })

  it('does not sync models or enable an existing provider when autoSyncModels is requested', async () => {
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
      displayName: 'Anthropic',
      autoSyncModels: true
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'anthropic',
          apiKey: 'sk-anthropic',
          baseUrl: 'https://api.anthropic.com',
          type: 'anthropic',
          name: 'Anthropic',
          autoSyncModels: true
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(onSelectProvider).toHaveBeenCalledWith('anthropic'))

    expect(syncProviderModelsForProviderMock).not.toHaveBeenCalled()
    expect(updateProviderByIdMock).not.toHaveBeenCalledWith('anthropic', { isEnabled: true })
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('keeps the import successful when consented model sync finds no models', async () => {
    const onSelectProvider = vi.fn()
    createProviderMock.mockResolvedValue({ id: 'everyapi' })
    syncProviderModelsForProviderMock.mockResolvedValue([])
    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'everyapi',
        name: 'EveryAPI',
        type: 'openai',
        apiKey: 'sk-everyapi',
        apiHost: 'https://api.everyapi.example/v1'
      },
      isNew: true,
      displayName: 'EveryAPI',
      autoSyncModels: true
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'everyapi',
          apiKey: 'sk-everyapi',
          baseUrl: 'https://api.everyapi.example/v1',
          type: 'openai',
          name: 'EveryAPI',
          autoSyncModels: true
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(onSelectProvider).toHaveBeenCalledWith('everyapi'))

    expect(syncProviderModelsForProviderMock).toHaveBeenCalledTimes(1)
    expect(updateProviderByIdMock).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('keeps the import successful and warns when consented model sync fails', async () => {
    const onSelectProvider = vi.fn()
    createProviderMock.mockResolvedValue({ id: 'everyapi' })
    syncProviderModelsForProviderMock.mockRejectedValue(new Error('upstream failed'))
    popupShowMock.mockResolvedValue({
      updatedProvider: {
        id: 'everyapi',
        name: 'EveryAPI',
        type: 'openai',
        apiKey: 'sk-everyapi',
        apiHost: 'https://api.everyapi.example/v1'
      },
      isNew: true,
      displayName: 'EveryAPI',
      autoSyncModels: true
    })

    renderHook(() =>
      useProviderDeepLinkImport(
        JSON.stringify({
          id: 'everyapi',
          apiKey: 'sk-everyapi',
          baseUrl: 'https://api.everyapi.example/v1',
          type: 'openai',
          name: 'EveryAPI',
          autoSyncModels: true
        }),
        onSelectProvider
      )
    )

    await waitFor(() => expect(onSelectProvider).toHaveBeenCalledWith('everyapi'))

    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(updateProviderByIdMock).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
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
})
