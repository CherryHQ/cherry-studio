import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useOpenApiKeyList } from '../useOpenApiKeyList'

const useProviderMock = vi.fn()
const useProviderMetaMock = vi.fn()
const useAuthenticationApiKeyMock = vi.fn()

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('../useProviderMeta', () => ({
  useProviderMeta: (...args: any[]) => useProviderMetaMock(...args)
}))

vi.mock('../useAuthenticationApiKey', () => ({
  useAuthenticationApiKey: (...args: any[]) => useAuthenticationApiKeyMock(...args)
}))

describe('useOpenApiKeyList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProviderMock.mockReturnValue({
      provider: { id: 'openai' }
    })
    useProviderMetaMock.mockReturnValue({
      fancyProviderName: 'OpenAI'
    })
    useAuthenticationApiKeyMock.mockReturnValue({
      commitInputApiKeyNow: vi.fn().mockResolvedValue(undefined)
    })
  })

  it('flushes the inline input before opening the local drawer', async () => {
    const commitInputApiKeyNow = vi.fn().mockResolvedValue(undefined)
    useAuthenticationApiKeyMock.mockReturnValue({
      commitInputApiKeyNow
    })

    const { result } = renderHook(() => useOpenApiKeyList('openai'))

    await act(async () => {
      await result.current.openApiKeyList()
    })

    expect(commitInputApiKeyNow).toHaveBeenCalled()
    expect(result.current.apiKeyListOpen).toBe(true)
    expect(result.current.title).toBe('OpenAI settings.provider.api.key.list.title')

    act(() => {
      result.current.closeApiKeyList()
    })

    expect(result.current.apiKeyListOpen).toBe(false)
  })

  it('is a no-op when the provider is missing', async () => {
    useProviderMock.mockReturnValue({
      provider: undefined
    })

    const { result } = renderHook(() => useOpenApiKeyList('missing'))

    await act(async () => {
      await result.current.openApiKeyList()
    })

    expect(result.current.apiKeyListOpen).toBe(false)
  })
})
