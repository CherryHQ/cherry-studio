import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderConnectionCheck } from '../useProviderConnectionCheck'

const useProviderMock = vi.fn()
const useModelsMock = vi.fn()
const useTimerMock = vi.fn()
const useAuthenticationApiKeyMock = vi.fn()
const useProviderEndpointsMock = vi.fn()
const providerCheckApiAdapterMock = vi.fn()
const showErrorDetailPopupMock = vi.fn()

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

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('@renderer/hooks/useModels', () => ({
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

vi.mock('../../../adapters/providerCheckApiAdapter', () => ({
  providerCheckApiAdapter: (...args: any[]) => providerCheckApiAdapterMock(...args)
}))

vi.mock('@renderer/components/ErrorDetailModal', () => ({
  showErrorDetailPopup: (...args: any[]) => showErrorDetailPopupMock(...args)
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
      provider: { id: 'cherryin', name: 'CherryIN' }
    })
    useModelsMock.mockReturnValue({
      models: [
        {
          id: 'cherryin::claude-4-sonnet',
          name: 'Claude 4 Sonnet',
          providerId: 'cherryin',
          endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
        },
        {
          id: 'cherryin::rerank-1',
          name: 'Rerank',
          providerId: 'cherryin',
          endpointTypes: [ENDPOINT_TYPE.JINA_RERANK]
        }
      ]
    })
    useTimerMock.mockReturnValue({ setTimeoutTimer })
    useAuthenticationApiKeyMock.mockReturnValue({
      inputApiKey: 'sk-a,sk-b'
    })
    useProviderEndpointsMock.mockReturnValue({
      apiHost: 'https://open.cherryin.cc',
      anthropicApiHost: 'https://anthropic.cherryin.cc'
    })
  })

  it('opens the connection drawer for multi-key providers instead of silently redirecting elsewhere', () => {
    const { result } = renderHook(() => useProviderConnectionCheck('cherryin'))

    act(() => {
      result.current.openConnectionCheck()
    })

    expect(result.current.connectionCheckOpen).toBe(true)
    expect(result.current.checkableApiKeys).toEqual(['sk-a', 'sk-b'])
    expect(result.current.checkableModels).toHaveLength(1)
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

    expect(providerCheckApiAdapterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-b',
        apiHost: 'https://anthropic.cherryin.cc'
      })
    )
    expect(result.current.connectionCheckOpen).toBe(false)
    expect(setTimeoutTimer).toHaveBeenCalled()
  })
})
