import { HealthStatus } from '@renderer/pages/settings/ProviderSettings/types/healthCheck'
import { toast } from '@renderer/services/toast'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderConnectionCheck } from '../useProviderConnectionCheck'

const useProviderMock = vi.fn()
const useModelsMock = vi.fn()
const useTimerMock = vi.fn()
const useAuthenticationApiKeyMock = vi.fn()
const useProviderEndpointsMock = vi.fn()
const checkApiMock = vi.fn()
const enableProviderMock = vi.fn()
const commitInputApiKeyNowMock = vi.fn()
const { loggerErrorMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn()
}))
let inputApiKey = 'sk-a,sk-b'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { t: (key: string) => key }
    })
  }
})

vi.mock('@renderer/hooks/useProvider', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: (...args: any[]) => useModelsMock(...args)
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: (...args: any[]) => useTimerMock(...args)
}))

vi.mock('../useAuthenticationApiKey', () => ({
  useAuthenticationApiKey: (...args: any[]) => useAuthenticationApiKeyMock(...args)
}))

vi.mock('../useProviderEndpoints', () => ({
  useProviderEndpoints: (...args: any[]) => useProviderEndpointsMock(...args)
}))

vi.mock('@renderer/pages/settings/ProviderSettings/utils/healthCheck', () => ({
  checkApi: (...args: any[]) => checkApiMock(...args)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: loggerErrorMock
    })
  }
}))

describe('useProviderConnectionCheck', () => {
  const setTimeoutTimer = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    inputApiKey = 'sk-a,sk-b'

    useProviderMock.mockReturnValue({
      provider: { id: 'cherryin', name: 'CherryIN', isEnabled: false },
      enableProvider: enableProviderMock
    })
    useModelsMock.mockReturnValue({
      models: [
        {
          id: 'cherryin::claude-4-sonnet',
          name: 'Claude 4 Sonnet',
          providerId: 'cherryin',
          capabilities: [],
          endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
        },
        {
          id: 'cherryin::rerank-1',
          name: 'Rerank',
          providerId: 'cherryin',
          capabilities: [MODEL_CAPABILITY.RERANK],
          endpointTypes: [ENDPOINT_TYPE.JINA_RERANK]
        }
      ]
    })
    useTimerMock.mockReturnValue({ setTimeoutTimer })
    commitInputApiKeyNowMock.mockResolvedValue(undefined)
    useAuthenticationApiKeyMock.mockImplementation(() => ({
      inputApiKey,
      commitInputApiKeyNow: commitInputApiKeyNowMock
    }))
    useProviderEndpointsMock.mockReturnValue({
      apiHost: 'https://open.cherryin.net',
      anthropicApiHost: 'https://open.cherryin.net'
    })
  })

  it('opens the connection drawer with rerank models available for checking', () => {
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    act(() => {
      result.current.openConnectionCheck()
    })

    expect(result.current.connectionCheckOpen).toBe(true)
    expect(result.current.checkableApiKeys).toEqual(['sk-a', 'sk-b'])
    expect(result.current.checkableModels.map((model) => model.id)).toEqual([
      'cherryin::claude-4-sonnet',
      'cherryin::rerank-1'
    ])
  })

  it('opens the connection drawer without API keys for no-key providers', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'ollama', name: 'Ollama', isEnabled: false },
      enableProvider: enableProviderMock
    })
    useAuthenticationApiKeyMock.mockReturnValue({
      inputApiKey: '',
      commitInputApiKeyNow: commitInputApiKeyNowMock
    })
    const { result } = renderHook(() => useProviderConnectionCheck('ollama'))

    act(() => {
      result.current.openConnectionCheck()
    })

    expect(result.current.connectionCheckOpen).toBe(true)
    expect(result.current.requiresApiKey).toBe(false)
    expect(toast.error).not.toHaveBeenCalledWith('message.error.enter.api.label')
  })

  it('opens the connection drawer without API keys for providers derived from no-key presets', () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'custom-ollama', presetProviderId: 'ollama', name: 'Custom Ollama', isEnabled: false },
      enableProvider: enableProviderMock
    })
    useAuthenticationApiKeyMock.mockReturnValue({
      inputApiKey: '',
      commitInputApiKeyNow: commitInputApiKeyNowMock
    })
    const { result } = renderHook(() => useProviderConnectionCheck('custom-ollama'))

    act(() => {
      result.current.openConnectionCheck()
    })

    expect(result.current.connectionCheckOpen).toBe(true)
    expect(result.current.requiresApiKey).toBe(false)
    expect(toast.error).not.toHaveBeenCalledWith('message.error.enter.api.label')
  })

  it('uses the anthropic host for anthropic endpoint models and closes the drawer after checking', async () => {
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    act(() => {
      result.current.openConnectionCheck()
    })

    await act(async () => {
      await result.current.startConnectionCheck({
        model: result.current.checkableModels[0],
        apiKey: 'sk-b'
      })
    })

    expect(checkApiMock).toHaveBeenCalledWith(
      result.current.checkableModels[0].id,
      expect.objectContaining({ apiKey: 'sk-b', signal: expect.any(AbortSignal) })
    )
    expect(result.current.connectionCheckOpen).toBe(false)
    expect(setTimeoutTimer).toHaveBeenCalled()
  })

  it('runs no-key provider checks without an API key override', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'ollama', name: 'Ollama', isEnabled: false },
      enableProvider: enableProviderMock
    })
    useAuthenticationApiKeyMock.mockReturnValue({
      inputApiKey: '',
      commitInputApiKeyNow: commitInputApiKeyNowMock
    })
    const { result } = renderHook(() => useProviderConnectionCheck('ollama'))

    await act(async () => {
      await result.current.startConnectionCheck({
        model: result.current.checkableModels[0],
        apiKey: ''
      })
    })

    expect(checkApiMock).toHaveBeenCalledWith(
      result.current.checkableModels[0].id,
      expect.objectContaining({ apiKey: undefined, signal: expect.any(AbortSignal) })
    )
    expect(toast.error).not.toHaveBeenCalledWith('message.error.enter.api.label')
  })

  it('enables a disabled provider after a successful model connection check', async () => {
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    await act(async () => {
      await result.current.startConnectionCheck({
        model: result.current.checkableModels[0],
        apiKey: 'sk-a'
      })
    })

    expect(enableProviderMock).toHaveBeenCalledTimes(1)
  })

  it('persists the pending API key before running the check and before enabling the provider', async () => {
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    await act(async () => {
      await result.current.startConnectionCheck({
        model: result.current.checkableModels[0],
        apiKey: 'sk-a'
      })
    })

    expect(commitInputApiKeyNowMock).toHaveBeenCalledTimes(1)
    expect(enableProviderMock).toHaveBeenCalledTimes(1)
    // commit must run before the check so a freshly typed key is saved before
    // provider enablement, while the check still uses the selected key override.
    expect(commitInputApiKeyNowMock.mock.invocationCallOrder[0]).toBeLessThan(checkApiMock.mock.invocationCallOrder[0])
    expect(checkApiMock.mock.invocationCallOrder[0]).toBeLessThan(enableProviderMock.mock.invocationCallOrder[0])
  })

  it('does not run the check or enable the provider when saving the pending API key fails', async () => {
    const saveError = new Error('save failed')
    commitInputApiKeyNowMock.mockRejectedValueOnce(saveError)
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    await act(async () => {
      await result.current.startConnectionCheck({
        model: result.current.checkableModels[0],
        apiKey: 'sk-a'
      })
    })

    // Key persistence now runs before the check, so a save failure aborts before
    // probing (the check would otherwise validate a stale saved key) and before
    // enabling, surfacing only the failure path — never success-then-failure.
    // The toast must name the save failure, not the connection: nothing was probed.
    expect(checkApiMock).not.toHaveBeenCalled()
    expect(enableProviderMock).not.toHaveBeenCalled()
    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to persist pending API key before connection check', {
      providerId: 'cherryin',
      modelId: 'cherryin::claude-4-sonnet',
      error: saveError
    })
    expect(toast.error).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'settings.provider.api_key.save_failed' })
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('does not patch an already enabled provider after a successful model connection check', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'cherryin', name: 'CherryIN', isEnabled: true },
      enableProvider: enableProviderMock
    })
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    await act(async () => {
      await result.current.startConnectionCheck({
        model: result.current.checkableModels[0],
        apiKey: 'sk-a'
      })
    })

    expect(enableProviderMock).not.toHaveBeenCalled()
  })

  it('preserves connection success and warns when provider enablement fails', async () => {
    const enableError = new Error('enable and pin failed')
    enableProviderMock.mockRejectedValueOnce(enableError)
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    await act(async () => {
      await result.current.startConnectionCheck({
        model: result.current.checkableModels[0],
        apiKey: 'sk-a'
      })
    })

    expect(loggerErrorMock).toHaveBeenCalledWith('Provider connection succeeded but enablement failed', {
      providerId: 'cherryin',
      modelId: 'cherryin::claude-4-sonnet',
      error: enableError
    })
    expect(toast.warning).toHaveBeenCalledWith('settings.provider.enable_failed_after_connection')
    expect(toast.success).toHaveBeenCalled()
    expect(result.current.apiKeyConnectivity.status).toBe(HealthStatus.SUCCESS)
  })

  it('ignores an enablement failure from a superseded connection check', async () => {
    let rejectEnable: ((error: Error) => void) | undefined
    enableProviderMock.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectEnable = reject
        })
    )
    const { result, rerender } = renderHook(() => useProviderConnectionCheck('cherryin'))

    act(() => {
      void result.current.startConnectionCheck({
        model: result.current.checkableModels[0],
        apiKey: 'sk-a'
      })
    })
    await vi.waitFor(() => expect(enableProviderMock).toHaveBeenCalledTimes(1))

    inputApiKey = 'sk-new'
    rerender()

    await act(async () => {
      rejectEnable?.(new Error('stale enable failure'))
      await Promise.resolve()
    })

    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('logs provider/model context when the connection check fails', async () => {
    checkApiMock.mockRejectedValueOnce(new Error('timeout'))
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    act(() => {
      result.current.openConnectionCheck()
    })

    await act(async () => {
      await result.current.startConnectionCheck({
        model: result.current.checkableModels[0],
        apiKey: 'sk-a'
      })
    })

    expect(loggerErrorMock).toHaveBeenCalledWith('Provider connection check failed', {
      providerId: 'cherryin',
      modelId: 'cherryin::claude-4-sonnet',
      error: expect.any(Error)
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(result.current.connectionCheckOpen).toBe(true)
    expect(result.current.apiKeyConnectivity.error?.message).toBe('timeout')
  })
})
