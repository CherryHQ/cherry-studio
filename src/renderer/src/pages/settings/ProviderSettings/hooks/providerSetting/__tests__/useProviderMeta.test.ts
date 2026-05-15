import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProviderMeta } from '../useProviderMeta'

const useProviderMock = vi.fn()
const useTranslationMock = vi.fn()

vi.mock('@renderer/hooks/useProviders', () => ({
  useProvider: (...args: any[]) => useProviderMock(...args)
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => useTranslationMock()
}))

describe('useProviderMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTranslationMock.mockReturnValue({
      i18n: {
        language: 'en-US'
      }
    })
  })

  it('reads provider website links from the provider read', () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'openai',
        name: 'OpenAI',
        authType: 'api-key',
        apiKeys: [],
        apiFeatures: {
          arrayContent: true,
          streamOptions: true,
          developerRole: false,
          serviceTier: false,
          verbosity: false,
          enableThinking: true
        },
        settings: {},
        isEnabled: true,
        websites: {
          official: 'https://openai.com',
          apiKey: 'https://platform.openai.com/api-keys',
          docs: 'https://platform.openai.com/docs/overview',
          models: 'https://platform.openai.com/docs/models'
        }
      }
    })

    const { result } = renderHook(() => useProviderMeta('openai'))

    expect(result.current.officialWebsite).toBe('https://openai.com')
    expect(result.current.apiKeyWebsite).toBe('https://platform.openai.com/api-keys')
    expect(result.current.docsWebsite).toBe('https://platform.openai.com/docs/overview')
    expect(result.current.modelsWebsite).toBe('https://platform.openai.com/docs/models')
  })

  it('reads provider website links for inherited providers from the provider read', () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'openai-main',
        name: 'My OpenAI',
        authType: 'api-key',
        apiKeys: [],
        apiFeatures: {
          arrayContent: true,
          streamOptions: true,
          developerRole: false,
          serviceTier: false,
          verbosity: false,
          enableThinking: true
        },
        settings: {},
        isEnabled: true,
        websites: {
          official: 'https://openai.com',
          docs: 'https://platform.openai.com/docs/overview'
        }
      }
    })

    const { result } = renderHook(() => useProviderMeta('openai-main'))

    expect(result.current.officialWebsite).toBe('https://openai.com')
    expect(result.current.docsWebsite).toBe('https://platform.openai.com/docs/overview')
  })

  it('returns empty website links for fully custom providers without websites', () => {
    useProviderMock.mockReturnValue({
      provider: {
        id: 'custom-provider',
        name: 'Custom Provider',
        authType: 'api-key',
        apiKeys: [],
        apiFeatures: {
          arrayContent: true,
          streamOptions: true,
          developerRole: false,
          serviceTier: false,
          verbosity: false,
          enableThinking: true
        },
        settings: {},
        isEnabled: true
      }
    })

    const { result } = renderHook(() => useProviderMeta('custom-provider'))

    expect(result.current.officialWebsite).toBeUndefined()
    expect(result.current.apiKeyWebsite).toBeUndefined()
    expect(result.current.docsWebsite).toBeUndefined()
    expect(result.current.modelsWebsite).toBeUndefined()
  })
})
