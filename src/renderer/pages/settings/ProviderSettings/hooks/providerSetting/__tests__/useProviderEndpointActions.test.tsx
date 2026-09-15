import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

import { useProviderEndpointActions } from '../useProviderEndpointActions'

const patchProviderMock = vi.fn().mockResolvedValue(undefined)
const setApiHostMock = vi.fn()

async function flushEndpointAction() {
  await Promise.resolve()
  await Promise.resolve()
}

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe('useProviderEndpointActions', () => {
  const provider = {
    id: 'openai',
    name: 'OpenAI',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
        baseUrl: 'https://api.openai.com'
      }
    },
    settings: {}
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resets invalid hosts on blur without persisting or syncing', async () => {
    const { result } = renderHook(() =>
      useProviderEndpointActions({
        provider,
        primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiHost: 'not-a-url',
        setApiHost: setApiHostMock,
        providerApiHost: 'https://api.openai.com',
        defaultApiHost: 'https://api.openai.com',
        apiVersion: '',
        patchProvider: patchProviderMock
      })
    )

    await act(async () => {
      await result.current.commitApiHost()
      await flushEndpointAction()
    })

    expect(setApiHostMock).toHaveBeenCalledWith('https://api.openai.com')

    expect(toast.error).toHaveBeenCalledWith('settings.provider.api_host_no_valid')
    expect(patchProviderMock).not.toHaveBeenCalled()
  })

  it('updates only the primary endpoint when committing the main host', async () => {
    const providerWithAnthropicEndpoint = {
      ...provider,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://api.openai.com'
        },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: 'https://anthropic.example.com'
        }
      }
    }

    const { result } = renderHook(() =>
      useProviderEndpointActions({
        provider: providerWithAnthropicEndpoint,
        primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiHost: 'https://proxy.example.com',
        setApiHost: setApiHostMock,
        providerApiHost: 'https://api.openai.com',
        defaultApiHost: 'https://api.openai.com',
        apiVersion: '',
        patchProvider: patchProviderMock
      })
    )

    await act(async () => {
      await result.current.commitApiHost()
      await flushEndpointAction()
    })

    expect(patchProviderMock).toHaveBeenCalledWith({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://proxy.example.com'
        },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: 'https://anthropic.example.com'
        }
      }
    })
  })

  it('resets the primary host to the registry default and persists it', async () => {
    const editedProvider = {
      ...provider,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://proxy.example.com' }
      }
    }

    const { result } = renderHook(() =>
      useProviderEndpointActions({
        provider: editedProvider,
        primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiHost: 'https://proxy.example.com',
        setApiHost: setApiHostMock,
        providerApiHost: 'https://proxy.example.com',
        defaultApiHost: 'https://api.openai.com',
        apiVersion: '',
        patchProvider: patchProviderMock
      })
    )

    await act(async () => {
      await result.current.resetApiHost()
      await flushEndpointAction()
    })

    expect(setApiHostMock).toHaveBeenCalledWith('https://api.openai.com')
    expect(patchProviderMock).toHaveBeenCalledWith({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com' }
      }
    })
  })

  it('shows specific Data API error messages instead of the generic save failure toast', async () => {
    patchProviderMock.mockRejectedValueOnce(
      DataApiErrorFactory.validation({ apiVersion: ['Unsupported version'] }, 'Unsupported API version')
    )

    const { result } = renderHook(() =>
      useProviderEndpointActions({
        provider,
        primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiHost: 'https://api.openai.com',
        setApiHost: setApiHostMock,
        providerApiHost: 'https://api.openai.com',
        defaultApiHost: 'https://api.openai.com',
        apiVersion: 'bad-version',
        patchProvider: patchProviderMock
      })
    )

    await act(async () => {
      await result.current.commitApiVersion()
      await flushEndpointAction()
    })

    expect(toast.error).toHaveBeenCalledWith('Unsupported API version')
  })
})
