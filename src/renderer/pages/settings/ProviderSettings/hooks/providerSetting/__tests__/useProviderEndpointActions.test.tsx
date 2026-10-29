import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ConfirmActionPopup, { type ConfirmActionParams } from '@renderer/components/popups/ConfirmActionPopup'
import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { useProviderEndpointActions } from '../useProviderEndpointActions'
import { useProviderEndpoints } from '../useProviderEndpoints'

const showMock = vi.mocked(ConfirmActionPopup.show)
const patchProviderMock = vi.fn().mockResolvedValue(undefined)
const setApiHostMock = vi.fn()
const setAnthropicApiHostMock = vi.fn()

async function flushEndpointAction() {
  await Promise.resolve()
  await Promise.resolve()
}

function useDraftEndpointActions(provider: Provider | undefined, defaultApiHost = 'https://api.openai.com') {
  const endpoints = useProviderEndpoints(provider)
  const actions = useProviderEndpointActions({
    ...endpoints,
    provider,
    defaultApiHost,
    patchProvider: patchProviderMock
  })
  return { ...endpoints, ...actions }
}

function holdConfirmation() {
  let params!: ConfirmActionParams
  let settle!: (approved: boolean) => void
  const pending = new Promise<boolean>((resolve) => {
    settle = resolve
  })
  showMock.mockImplementation((nextParams) => {
    params = nextParams
    return pending
  })
  return {
    get params() {
      return params
    },
    settle
  }
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
    showMock.mockReset()
    vi.useFakeTimers()
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
        defaultApiHost: 'https://api.openai.com',
        apiVersion: '',
        patchProvider: patchProviderMock
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
  })

  it('flushes host persistence on blur without syncing models', async () => {
    const { result } = renderHook(() =>
      useProviderEndpointActions({
        provider,
        primaryEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        apiHost: 'https://proxy.example.com',
        setApiHost: setApiHostMock,
        providerApiHost: 'https://api.openai.com',
        anthropicApiHost: '',
        setAnthropicApiHost: setAnthropicApiHostMock,
        defaultApiHost: 'https://api.openai.com',
        apiVersion: '',
        patchProvider: patchProviderMock
      })
    )

    await act(async () => {
      await result.current.commitApiHost()
      await flushEndpointAction()
    })

    expect(patchProviderMock).toHaveBeenCalledTimes(1)
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
        defaultApiHost: 'https://api.openai.com',
        apiVersion: '',
        patchProvider: patchProviderMock
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
        anthropicApiHost: 'https://anthropic.example.com',
        setAnthropicApiHost: setAnthropicApiHostMock,
        defaultApiHost: 'https://api.openai.com',
        apiVersion: '',
        patchProvider: patchProviderMock
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

  const customProvider = {
    ...provider,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
        baseUrl: 'https://proxy.example.com',
        dialect: { developerRole: false }
      },
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
        baseUrl: 'https://anthropic.example.com',
        dialect: { streamOptions: false }
      }
    }
  }

  it('keeps the saved custom host while reset is pending and after cancellation', async () => {
    const dialog = holdConfirmation()
    const { result } = renderHook(() => useDraftEndpointActions(customProvider))
    let reset!: Promise<boolean>

    await act(async () => {
      reset = result.current.resetApiHost()
      vi.advanceTimersByTime(200)
      await flushEndpointAction()
    })

    expect(result.current.apiHost).toBe('https://proxy.example.com')
    expect(patchProviderMock).not.toHaveBeenCalled()

    await act(async () => {
      dialog.settle(false)
      expect(await reset).toBe(false)
      vi.advanceTimersByTime(200)
      await flushEndpointAction()
    })

    expect(result.current.apiHost).toBe('https://proxy.example.com')
    expect(patchProviderMock).not.toHaveBeenCalled()
  })

  it('resets the primary host to the registry default only after approval and preserves other options', async () => {
    const dialog = holdConfirmation()
    const { result } = renderHook(() => useDraftEndpointActions(customProvider))
    let reset!: Promise<boolean>

    await act(async () => {
      reset = result.current.resetApiHost()
      vi.advanceTimersByTime(200)
      await flushEndpointAction()
    })

    expect(result.current.apiHost).toBe('https://proxy.example.com')
    expect(patchProviderMock).not.toHaveBeenCalled()
    expect(dialog.params).toMatchObject({
      title: 'common.reset',
      content: 'settings.provider.api.url.reset_confirm',
      okText: 'common.reset',
      cancelText: 'common.cancel',
      danger: true
    })

    await act(async () => {
      await dialog.params.action()
      dialog.settle(true)
      expect(await reset).toBe(true)
    })

    expect(result.current.apiHost).toBe('https://api.openai.com')
    expect(patchProviderMock).toHaveBeenCalledWith({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://api.openai.com',
          dialect: { developerRole: false }
        },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: 'https://anthropic.example.com',
          dialect: { streamOptions: false }
        }
      }
    })
  })

  it('saves a pending custom edit normally while reset is open and retains it on cancellation', async () => {
    const dialog = holdConfirmation()
    const { result } = renderHook(() => useDraftEndpointActions(customProvider))
    let reset!: Promise<boolean>

    act(() => {
      result.current.setApiHost('https://second-proxy.example.com')
    })
    await act(async () => {
      reset = result.current.resetApiHost()
      vi.advanceTimersByTime(200)
      await flushEndpointAction()
    })

    expect(result.current.apiHost).toBe('https://second-proxy.example.com')
    const customPayload = {
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://second-proxy.example.com',
          dialect: { developerRole: false }
        },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: 'https://anthropic.example.com',
          dialect: { streamOptions: false }
        }
      }
    }
    expect(patchProviderMock).toHaveBeenCalledWith(customPayload)
    for (const [payload] of patchProviderMock.mock.calls) {
      expect(payload).toEqual(customPayload)
    }

    await act(async () => {
      dialog.settle(false)
      expect(await reset).toBe(false)
      vi.advanceTimersByTime(200)
      await flushEndpointAction()
    })

    expect(result.current.apiHost).toBe('https://second-proxy.example.com')
    for (const [payload] of patchProviderMock.mock.calls) {
      expect(payload).toEqual(customPayload)
    }
  })

  it.each([
    { name: 'missing provider', value: undefined, defaultApiHost: 'https://api.openai.com' },
    { name: 'empty default', value: customProvider, defaultApiHost: '' },
    { name: 'raw draft equal to default', value: provider, defaultApiHost: 'https://api.openai.com' }
  ])('declines reset without a dialog for $name', async ({ value, defaultApiHost }) => {
    const { result } = renderHook(() => useDraftEndpointActions(value, defaultApiHost))
    const originalHost = result.current.apiHost

    await act(async () => {
      expect(await result.current.resetApiHost()).toBe(false)
      vi.advanceTimersByTime(200)
      await flushEndpointAction()
    })

    expect(showMock).not.toHaveBeenCalled()
    expect(result.current.apiHost).toBe(originalHost)
    expect(patchProviderMock).not.toHaveBeenCalled()
  })

  it('allows resetting a whitespace-padded default draft to the exact default after approval', async () => {
    const dialog = holdConfirmation()
    const { result } = renderHook(() => useDraftEndpointActions(provider))
    let reset!: Promise<boolean>

    act(() => {
      result.current.setApiHost(' https://api.openai.com ')
    })
    await act(async () => {
      reset = result.current.resetApiHost()
      vi.advanceTimersByTime(200)
      await flushEndpointAction()
    })

    expect(result.current.apiHost).toBe(' https://api.openai.com ')
    expect(patchProviderMock).not.toHaveBeenCalled()

    await act(async () => {
      await dialog.params.action()
      dialog.settle(true)
      expect(await reset).toBe(true)
    })

    expect(result.current.apiHost).toBe('https://api.openai.com')
    expect(patchProviderMock).toHaveBeenCalledWith({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com' }
      }
    })
  })

  it('rejects an approved reset with the actionable error and leaves feedback to the dialog', async () => {
    patchProviderMock.mockRejectedValueOnce(
      DataApiErrorFactory.validation({ endpointConfigs: ['Host is not allowed'] }, 'This API host is not allowed')
    )
    const dialog = holdConfirmation()
    const { result } = renderHook(() => useDraftEndpointActions(customProvider))
    let reset!: Promise<boolean>
    let resetOutcome: boolean | undefined

    await act(async () => {
      reset = result.current.resetApiHost()
      void reset.then((outcome) => {
        resetOutcome = outcome
      })
      await flushEndpointAction()
    })

    await act(async () => {
      await expect(dialog.params.action()).rejects.toThrow(/^This API host is not allowed$/)
      await flushEndpointAction()
    })

    expect(resetOutcome).toBeUndefined()
    expect(toast.error).not.toHaveBeenCalled()

    await act(async () => {
      dialog.settle(false)
      expect(await reset).toBe(false)
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
        anthropicApiHost: '',
        setAnthropicApiHost: setAnthropicApiHostMock,
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
