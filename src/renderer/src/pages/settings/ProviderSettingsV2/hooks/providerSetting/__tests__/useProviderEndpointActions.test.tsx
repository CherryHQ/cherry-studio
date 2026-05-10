import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderEndpointActions } from '../useProviderEndpointActions'

const patchProviderMock = vi.fn().mockResolvedValue(undefined)
const syncProviderModelsMock = vi.fn().mockResolvedValue([])
const setApiHostMock = vi.fn()
const setAnthropicApiHostMock = vi.fn()

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
    window.toast = {
      error: vi.fn()
    } as any
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces api host persistence without syncing models', async () => {
    renderHook(() =>
      useProviderEndpointActions({
        provider,
        primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiHost: 'https://proxy.example.com',
        setApiHost: setApiHostMock,
        providerApiHost: 'https://api.openai.com',
        anthropicApiHost: '',
        setAnthropicApiHost: setAnthropicApiHostMock,
        apiVersion: '',
        patchProvider: patchProviderMock,
        syncProviderModels: syncProviderModelsMock
      })
    )

    await act(async () => {
      vi.advanceTimersByTime(149)
    })
    expect(patchProviderMock).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
    })

    expect(patchProviderMock).toHaveBeenCalledWith({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://proxy.example.com'
        }
      }
    })
    expect(syncProviderModelsMock).not.toHaveBeenCalled()
  })

  it('flushes host persistence on blur and syncs models with the latest endpoint config', async () => {
    const { result } = renderHook(() =>
      useProviderEndpointActions({
        provider,
        primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiHost: 'https://proxy.example.com',
        setApiHost: setApiHostMock,
        providerApiHost: 'https://api.openai.com',
        anthropicApiHost: '',
        setAnthropicApiHost: setAnthropicApiHostMock,
        apiVersion: '',
        patchProvider: patchProviderMock,
        syncProviderModels: syncProviderModelsMock
      })
    )

    await act(async () => {
      await result.current.commitApiHost()
      await flushEndpointAction()
    })

    expect(patchProviderMock).toHaveBeenCalledTimes(1)
    expect(syncProviderModelsMock).toHaveBeenCalledTimes(1)

    expect(syncProviderModelsMock).toHaveBeenCalledWith({
      ...provider,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://proxy.example.com'
        }
      }
    })
  })

  it('does not patch the same host twice when blur happens after the debounced save', async () => {
    const { result } = renderHook(() =>
      useProviderEndpointActions({
        provider,
        primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiHost: 'https://proxy.example.com',
        setApiHost: setApiHostMock,
        providerApiHost: 'https://api.openai.com',
        anthropicApiHost: '',
        setAnthropicApiHost: setAnthropicApiHostMock,
        apiVersion: '',
        patchProvider: patchProviderMock,
        syncProviderModels: syncProviderModelsMock
      })
    )

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(patchProviderMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.commitApiHost()
      await flushEndpointAction()
    })

    expect(syncProviderModelsMock).toHaveBeenCalledTimes(1)

    expect(patchProviderMock).toHaveBeenCalledTimes(1)
  })

  it('resets invalid hosts on blur without persisting or syncing', async () => {
    const { result } = renderHook(() =>
      useProviderEndpointActions({
        provider,
        primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiHost: 'not-a-url',
        setApiHost: setApiHostMock,
        providerApiHost: 'https://api.openai.com',
        anthropicApiHost: '',
        setAnthropicApiHost: setAnthropicApiHostMock,
        apiVersion: '',
        patchProvider: patchProviderMock,
        syncProviderModels: syncProviderModelsMock
      })
    )

    await act(async () => {
      await result.current.commitApiHost()
      await flushEndpointAction()
    })

    expect(setApiHostMock).toHaveBeenCalledWith('https://api.openai.com')

    expect(window.toast.error).toHaveBeenCalledWith('settings.provider.api_host_no_valid')
    expect(patchProviderMock).not.toHaveBeenCalled()
    expect(syncProviderModelsMock).not.toHaveBeenCalled()
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
        anthropicApiHost: 'https://anthropic.example.com',
        setAnthropicApiHost: setAnthropicApiHostMock,
        apiVersion: '',
        patchProvider: patchProviderMock,
        syncProviderModels: syncProviderModelsMock
      })
    )

    await act(async () => {
      await result.current.commitApiHost()
      await flushEndpointAction()
    })

    expect(patchProviderMock).toHaveBeenCalledTimes(1)

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
    expect(setAnthropicApiHostMock).not.toHaveBeenCalled()
  })
})
