import type { Assistant, Model, Provider, ProviderType } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

// --- Mocks (vi.mock calls are hoisted) ---

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('i18next', () => {
  const instance = {
    t: (key: string) => key,
    use: vi.fn().mockReturnThis(),
    init: vi.fn().mockReturnThis(),
    language: 'en'
  }
  return { default: instance, ...instance }
})

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } })
}))

// Cut off the deep store/redux/AssistantService import chain
vi.mock('@renderer/services/AssistantService', () => ({
  getDefaultAssistant: vi.fn(() => ({ id: 'default', name: 'Default' })),
  getDefaultTopic: vi.fn(() => ({ id: 'topic', name: 'Topic' }))
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn(() => ({})),
    dispatch: vi.fn(),
    subscribe: vi.fn()
  },
  store: {
    getState: vi.fn(() => ({})),
    dispatch: vi.fn(),
    subscribe: vi.fn()
  }
}))

vi.mock('@renderer/hooks/useStore', () => ({
  useAppSelector: vi.fn(),
  useAppDispatch: vi.fn()
}))

vi.mock('@renderer/config/models', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    isGemini3Model: vi.fn(() => false),
    isQwen35Model: vi.fn(() => false),
    isSupportedThinkingTokenQwenModel: vi.fn(() => false)
  }
})

vi.mock('@renderer/hooks/useSettings', () => ({
  getEnableDeveloperMode: vi.fn(() => false)
}))

vi.mock('@renderer/utils/provider', () => ({
  isOllamaProvider: vi.fn(() => false),
  isSupportEnableThinkingProvider: vi.fn(() => false)
}))

vi.mock('../utils/image', () => ({
  isOpenRouterGeminiGenerateImageModel: vi.fn(() => false)
}))

import { buildPlugins } from '../PluginBuilder'

// --- Helpers ---

function makeProvider(type: ProviderType, id: string = type): Provider {
  return {
    id,
    name: id,
    type,
    apiKey: 'test-key',
    apiHost: 'https://test.example.com',
    isSystem: false,
    models: []
  } as Provider
}

function makeModel(id = 'deepseek-r1'): Model {
  return { id, provider: 'test', name: id, group: 'test' } as Model
}

function makeConfig() {
  return {
    streamOutput: true,
    enableReasoning: false,
    isSupportedToolUse: false,
    isImageGenerationEndpoint: false,
    enableWebSearch: false,
    enableGenerateImage: false,
    isPromptToolUse: false,
    enableUrlContext: false,
    assistant: { id: 'test', name: 'Test' } as Assistant
  }
}

function hasReasoningPlugin(plugins: { name: string }[]): boolean {
  return plugins.some((p) => p.name === 'reasoningExtraction')
}

// --- Tests ---

describe('PluginBuilder - reasoning extraction', () => {
  const model = makeModel()
  const config = makeConfig()

  describe('should include reasoningExtraction plugin for OpenAI-compatible providers', () => {
    const includedTypes: ProviderType[] = [
      'openai',
      'azure-openai',
      'new-api',
      'gateway',
      'ollama',
      'mistral',
      'aws-bedrock'
    ]

    it.each(includedTypes)('provider type: %s', (type) => {
      const provider = makeProvider(type)
      const plugins = buildPlugins({ provider, model, config })
      expect(hasReasoningPlugin(plugins)).toBe(true)
    })
  })

  describe('should NOT include reasoningExtraction plugin for providers with native reasoning', () => {
    const excludedTypes: ProviderType[] = ['anthropic', 'vertex-anthropic', 'gemini', 'vertexai', 'openai-response']

    it.each(excludedTypes)('provider type: %s', (type) => {
      const provider = makeProvider(type)
      const plugins = buildPlugins({ provider, model, config })
      expect(hasReasoningPlugin(plugins)).toBe(false)
    })
  })

  it('should NOT include reasoningExtraction plugin for OpenRouter (has its own plugin)', () => {
    const provider = makeProvider('openai', 'openrouter')
    const plugins = buildPlugins({ provider, model, config })
    expect(hasReasoningPlugin(plugins)).toBe(false)
  })
})
