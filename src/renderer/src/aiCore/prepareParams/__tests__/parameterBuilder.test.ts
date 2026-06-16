import type { Assistant, Model, Provider } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import { buildStreamTextParams, getEffectiveMaxToolCalls } from '../parameterBuilder'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/config/models', () => ({
  isAnthropicModel: vi.fn(() => false),
  isFixedReasoningModel: vi.fn(() => false),
  isGeminiModel: vi.fn(() => false),
  isGenerateImageModel: vi.fn(() => false),
  isGrokModel: vi.fn(() => false),
  isOpenAIModel: vi.fn(() => true),
  isOpenRouterBuiltInWebSearchModel: vi.fn(() => false),
  isPureGenerateImageModel: vi.fn(() => false),
  isSupportedReasoningEffortModel: vi.fn(() => false),
  isSupportedThinkingTokenModel: vi.fn(() => false),
  isWebSearchModel: vi.fn(() => false)
}))

vi.mock('@renderer/config/prompts-code-mode', () => ({
  getHubModeSystemPrompt: vi.fn(() => '')
}))

vi.mock('@renderer/services/AssistantService', () => ({
  DEFAULT_ASSISTANT_SETTINGS: {
    enableMaxToolCalls: true,
    maxToolCalls: 20
  },
  getDefaultModel: vi.fn()
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({
      websearch: {
        maxResults: 5,
        excludeDomains: [],
        searchWithTime: false
      }
    })
  }
}))

vi.mock('@renderer/utils/provider', () => ({
  isAIGatewayProvider: vi.fn(() => false),
  isAwsBedrockProvider: vi.fn(() => false),
  isSupportUrlContextProvider: vi.fn(() => false)
}))

vi.mock('@renderer/utils/prompt', () => ({
  replacePromptVariables: vi.fn((prompt: string) => prompt)
}))

vi.mock('../../provider/factory', () => ({
  getAiSdkProviderId: vi.fn(() => 'openai')
}))

const customProviderParamsMock = vi.hoisted(() => ({
  value: { n: 3, store: false } as Record<string, unknown>
}))

vi.mock('../../utils/options', () => ({
  buildProviderOptions: vi.fn(() => ({
    providerOptions: { openai: { store: false } },
    standardParams: {},
    customProviderParams: customProviderParamsMock.value
  }))
}))

vi.mock('../modelParameters', () => ({
  filterStandardParams: vi.fn(() => ({})),
  getMaxTokens: vi.fn(() => undefined),
  getTemperature: vi.fn(() => undefined),
  getTopP: vi.fn(() => undefined)
}))

vi.mock('../../utils/mcp', () => ({
  setupToolsConfig: vi.fn(() => undefined)
}))

vi.mock('../../utils/websearch', () => ({
  buildProviderBuiltinWebSearchConfig: vi.fn()
}))

const baseModel: Model = {
  id: 'gpt-5',
  name: 'GPT-5',
  provider: 'openai',
  group: 'OpenAI',
  owned_by: 'openai'
}

const baseAssistant: Assistant = {
  id: 'assistant-id',
  name: 'Assistant',
  prompt: 'Follow the user instructions.',
  topics: [],
  type: 'assistant',
  model: baseModel,
  settings: {
    enableMaxToolCalls: true,
    maxToolCalls: 20
  }
}

const baseProvider: Provider = {
  id: 'openai',
  type: 'openai',
  name: 'OpenAI',
  apiKey: 'test-key',
  apiHost: 'https://api.openai.com',
  models: []
}

describe('buildStreamTextParams', () => {
  it('returns custom provider params for fetch-layer injection', async () => {
    customProviderParamsMock.value = { n: 3, store: false }

    const result = await buildStreamTextParams([], baseAssistant, baseProvider, {})

    try {
      expect(result.customProviderParams).toEqual({ n: 3, store: false })
    } finally {
      result.idleTimeout.cleanup()
    }
  })
})

describe('getEffectiveMaxToolCalls', () => {
  it('uses the default cap when settings are missing', () => {
    expect(getEffectiveMaxToolCalls()).toBe(20)
  })

  it('uses the default cap when the switch is off', () => {
    expect(
      getEffectiveMaxToolCalls({
        enableMaxToolCalls: false,
        maxToolCalls: 50
      })
    ).toBe(20)
  })

  it('uses a custom cap when enabled', () => {
    expect(
      getEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 50
      })
    ).toBe(50)
  })

  it('clamps invalid custom values back to the default cap', () => {
    expect(
      getEffectiveMaxToolCalls({
        enableMaxToolCalls: true,
        maxToolCalls: 999
      })
    ).toBe(20)
  })

  it('uses the default cap for old assistants without the new fields', () => {
    expect(
      getEffectiveMaxToolCalls({
        temperature: 0.7,
        contextCount: 10
      } as { maxToolCalls?: number; enableMaxToolCalls?: boolean })
    ).toBe(20)
  })
})
