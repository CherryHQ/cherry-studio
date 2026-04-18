import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerMock = vi.mocked(getProviderByModel)

vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: vi.fn(),
  getAssistantSettings: vi.fn(),
  getDefaultAssistant: vi.fn().mockReturnValue({
    id: 'default',
    name: 'Default Assistant',
    prompt: '',
    settings: {}
  })
}))

vi.mock('@renderer/hooks/useStore', () => ({
  getStoreProviders: vi.fn(() => [])
}))

vi.mock('@renderer/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({
      llm: { providers: [] },
      settings: {}
    })
  },
  useAppDispatch: vi.fn(),
  useAppSelector: vi.fn()
}))

vi.mock('@renderer/store/settings', () => {
  const noop = vi.fn()
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'initialState') {
          return {}
        }
        return noop
      }
    }
  )
})

vi.mock('@renderer/hooks/useSettings', () => ({
  useSettings: vi.fn(() => ({})),
  useNavbarPosition: vi.fn(() => ({ navbarPosition: 'left' })),
  useMessageStyle: vi.fn(() => ({ isBubbleStyle: false })),
  getStoreSetting: vi.fn()
}))

import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Model, Provider } from '@renderer/types'
import { SystemProviderIds } from '@renderer/types'

import { isOpenAIDeepResearchModel } from '../openai'
import {
  isHunyuanSearchModel,
  isMandatoryWebSearchModel,
  isOpenAIWebSearchChatCompletionOnlyModel,
  isOpenAIWebSearchModel,
  isOpenRouterBuiltInWebSearchModel,
  isWebSearchModel
} from '../websearch'

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'gpt-4o',
  name: 'gpt-4o',
  provider: 'openai',
  group: 'OpenAI',
  ...overrides
})

const createProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'openai',
  type: 'openai',
  name: 'OpenAI',
  apiKey: '',
  apiHost: '',
  models: [],
  ...overrides
})

describe('websearch helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerMock.mockReturnValue(createProvider())
  })

  describe('isOpenAIDeepResearchModel', () => {
    it('detects deep research ids for OpenAI only', () => {
      expect(isOpenAIDeepResearchModel(createModel({ id: 'openai/deep-research-preview' }))).toBe(true)
      expect(isOpenAIDeepResearchModel(createModel({ provider: 'openai', id: 'gpt-4o' }))).toBe(false)
      expect(isOpenAIDeepResearchModel(createModel({ provider: 'openrouter', id: 'deep-research' }))).toBe(false)
    })
  })

  describe('isWebSearchModel', () => {
    it('honors user overrides', () => {
      const enabled = createModel({ capabilities: [{ type: 'web_search', isUserSelected: true }] })
      expect(isWebSearchModel(enabled)).toBe(true)

      const disabled = createModel({ capabilities: [{ type: 'web_search', isUserSelected: false }] })
      expect(isWebSearchModel(disabled)).toBe(false)
    })

    it('reads WEB_SEARCH capability from model id', () => {
      expect(isWebSearchModel(createModel({ id: 'gpt-4o-search-preview' }))).toBe(true)
      expect(isWebSearchModel(createModel({ id: 'sonar-pro' }))).toBe(true)
      expect(isWebSearchModel(createModel({ id: 'hunyuan-pro' }))).toBe(true)
    })

    it('returns false for non-search models', () => {
      expect(isWebSearchModel(createModel({ id: 'gpt-4o-image' }))).toBe(false)
      expect(isWebSearchModel(createModel({ id: 'hunyuan-lite' }))).toBe(false)
      expect(isWebSearchModel(createModel({ id: 'glm-5' }))).toBe(false)
    })
  })

  describe('isMandatoryWebSearchModel', () => {
    it('requires sonar ids for perplexity/openrouter providers', () => {
      providerMock.mockReturnValueOnce(createProvider({ id: SystemProviderIds.perplexity }))
      expect(isMandatoryWebSearchModel(createModel({ id: 'sonar-pro' }))).toBe(true)

      providerMock.mockReturnValueOnce(createProvider({ id: SystemProviderIds.openrouter }))
      expect(isMandatoryWebSearchModel(createModel({ id: 'sonar-reasoning' }))).toBe(true)

      providerMock.mockReturnValueOnce(createProvider({ id: 'openai' }))
      expect(isMandatoryWebSearchModel(createModel({ id: 'sonar-pro' }))).toBe(false)
    })

    it.each([
      ['perplexity', 'non-sonar'],
      ['openrouter', 'gpt-4o-search-preview']
    ])('returns false for %s provider when id is %s', (providerId, modelId) => {
      providerMock.mockReturnValueOnce(createProvider({ id: providerId }))
      expect(isMandatoryWebSearchModel(createModel({ id: modelId }))).toBe(false)
    })
  })

  describe('isOpenRouterBuiltInWebSearchModel', () => {
    it('checks for sonar ids or OpenAI chat-completion-only variants', () => {
      providerMock.mockReturnValueOnce(createProvider({ id: 'openrouter' }))
      expect(isOpenRouterBuiltInWebSearchModel(createModel({ id: 'sonar-reasoning' }))).toBe(true)

      providerMock.mockReturnValueOnce(createProvider({ id: 'openrouter' }))
      expect(isOpenRouterBuiltInWebSearchModel(createModel({ id: 'gpt-4o-search-preview' }))).toBe(true)

      providerMock.mockReturnValueOnce(createProvider({ id: 'custom' }))
      expect(isOpenRouterBuiltInWebSearchModel(createModel({ id: 'sonar-reasoning' }))).toBe(false)
    })
  })

  describe('OpenAI web search helpers', () => {
    it('detects chat completion only variants and openai search ids', () => {
      expect(isOpenAIWebSearchChatCompletionOnlyModel(createModel({ id: 'gpt-4o-search-preview' }))).toBe(true)
      expect(isOpenAIWebSearchChatCompletionOnlyModel(createModel({ id: 'gpt-4o-mini-search-preview' }))).toBe(true)
      expect(isOpenAIWebSearchChatCompletionOnlyModel(createModel({ id: 'gpt-4o' }))).toBe(false)

      expect(isOpenAIWebSearchModel(createModel({ id: 'gpt-4.1-turbo' }))).toBe(true)
      expect(isOpenAIWebSearchModel(createModel({ id: 'gpt-4o-image' }))).toBe(false)
      expect(isOpenAIWebSearchModel(createModel({ id: 'gpt-5.1-chat' }))).toBe(false)
      expect(isOpenAIWebSearchModel(createModel({ id: 'o3-mini' }))).toBe(true)
    })

    it.each(['gpt-4.1-preview', 'gpt-4o-2024-05-13', 'o4-mini', 'gpt-5-explorer'])(
      'treats %s as an OpenAI web search model',
      (id) => {
        expect(isOpenAIWebSearchModel(createModel({ id }))).toBe(true)
      }
    )

    it.each(['gpt-4o-image-preview', 'gpt-4.1-nano', 'gpt-5.1-chat', 'gpt-image-1'])(
      'excludes %s from OpenAI web search',
      (id) => {
        expect(isOpenAIWebSearchModel(createModel({ id }))).toBe(false)
      }
    )

    it.each(['gpt-4o-search-preview', 'gpt-4o-mini-search-preview'])('flags %s as chat-completion-only', (id) => {
      expect(isOpenAIWebSearchChatCompletionOnlyModel(createModel({ id }))).toBe(true)
    })
  })

  describe('isHunyuanSearchModel', () => {
    it('identifies hunyuan models except lite', () => {
      expect(isHunyuanSearchModel(createModel({ id: 'hunyuan-pro', provider: 'hunyuan' }))).toBe(true)
      expect(isHunyuanSearchModel(createModel({ id: 'hunyuan-lite', provider: 'hunyuan' }))).toBe(false)
      expect(isHunyuanSearchModel(createModel())).toBe(false)
    })

    it.each(['hunyuan-standard', 'hunyuan-advanced'])('accepts %s', (suffix) => {
      expect(isHunyuanSearchModel(createModel({ id: suffix, provider: 'hunyuan' }))).toBe(true)
    })
  })
})
