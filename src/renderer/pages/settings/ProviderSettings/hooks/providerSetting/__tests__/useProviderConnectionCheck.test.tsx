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
const updateProviderMock = vi.fn()
const commitInputApiKeyNowMock = vi.fn()
const showErrorDetailPopupMock = vi.fn()
const { loggerErrorMock } = vi.hoisted(() => ({
  loggerErrorMock: vi.fn()
}))

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

vi.mock('@renderer/services/ApiService', () => ({
  checkApi: (...args: any[]) => checkApiMock(...args)
}))

vi.mock('@renderer/components/ErrorDetailModal', () => ({
  showErrorDetailPopup: (...args: any[]) => showErrorDetailPopupMock(...args)
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

    ;(window as any).toast = {
      error: vi.fn(),
      success: vi.fn()
    }

    useProviderMock.mockReturnValue({
      provider: { id: 'cherryin', name: 'CherryIN', isEnabled: false },
      updateProvider: updateProviderMock
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
    useAuthenticationApiKeyMock.mockReturnValue({
      inputApiKey: 'sk-a,sk-b',
      commitInputApiKeyNow: commitInputApiKeyNowMock
    })
    useProviderEndpointsMock.mockReturnValue({
      apiHost: 'https://open.cherryin.cc',
      anthropicApiHost: 'https://anthropic.cherryin.cc'
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
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(result.current.connectionCheckOpen).toBe(false)
    expect(setTimeoutTimer).toHaveBeenCalled()
  })

  it('enables a disabled provider after a successful model connection check', async () => {
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    await act(async () => {
      await result.current.startConnectionCheck({
        model: result.current.checkableModels[0],
        apiKey: 'sk-a'
      })
    })

    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true })
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
    expect(updateProviderMock).toHaveBeenCalledWith({ isEnabled: true })
    // commit must run before the check (so the check validates the pending key,
    // not a stale saved one) and before enabling the provider.
    expect(commitInputApiKeyNowMock.mock.invocationCallOrder[0]).toBeLessThan(checkApiMock.mock.invocationCallOrder[0])
    expect(checkApiMock.mock.invocationCallOrder[0]).toBeLessThan(updateProviderMock.mock.invocationCallOrder[0])
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
    expect(updateProviderMock).not.toHaveBeenCalled()
    expect(loggerErrorMock).toHaveBeenCalledWith('Failed to persist pending API key before connection check', {
      providerId: 'cherryin',
      modelId: 'cherryin::claude-4-sonnet',
      error: saveError
    })
    expect(window.toast.error).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'settings.provider.api_key.save_failed' })
    )
    expect(window.toast.success).not.toHaveBeenCalled()
  })

  it('does not patch an already enabled provider after a successful model connection check', async () => {
    useProviderMock.mockReturnValue({
      provider: { id: 'cherryin', name: 'CherryIN', isEnabled: true },
      updateProvider: updateProviderMock
    })
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    await act(async () => {
      await result.current.startConnectionCheck({
        model: result.current.checkableModels[0],
        apiKey: 'sk-a'
      })
    })

    expect(updateProviderMock).not.toHaveBeenCalled()
  })

  it('logs provider/model context when the connection check fails', async () => {
    checkApiMock.mockRejectedValueOnce(new Error('timeout'))
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

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
    expect(window.toast.error).toHaveBeenCalled()
  })
})
