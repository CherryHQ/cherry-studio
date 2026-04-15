import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import {
  getFancyProviderName,
  hasApiKeys,
  isAnthropicProvider,
  isAnthropicSupportedProvider,
  isAwsBedrockProvider,
  isAzureOpenAIProvider,
  isCherryAIProvider,
  isGeminiProvider,
  isNewApiProvider,
  isOllamaProvider,
  isOpenAIChatProvider,
  isOpenAICompatibleProvider,
  isOpenAIResponsesProvider,
  isPerplexityProvider,
  isSupportArrayContentProvider,
  isSupportDeveloperRoleProvider,
  isSupportEnableThinkingProvider,
  isSupportServiceTierProvider,
  isSupportStreamOptionsProvider,
  isSupportVerbosityProvider,
  isSystemProvider,
  isVertexProvider,
  matchKeywordsInProvider,
  replaceEndpointConfigDomain
} from '../provider.v2'

/** Helper to create a minimal v2 Provider for testing */
function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    apiKeys: [],
    authType: 'api-key',
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
    ...overrides
  }
}

describe('provider.v2 - Protocol-level identity checks', () => {
  it('isAnthropicProvider: true when defaultChatEndpoint is ANTHROPIC_MESSAGES', () => {
    const p = makeProvider({ defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES })
    expect(isAnthropicProvider(p)).toBe(true)
  })

  it('isAnthropicProvider: false for other endpoints', () => {
    expect(isAnthropicProvider(makeProvider({ defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS }))).toBe(
      false
    )
    expect(isAnthropicProvider(makeProvider())).toBe(false) // undefined endpoint
  })

  it('isGeminiProvider: true when defaultChatEndpoint is GOOGLE_GENERATE_CONTENT', () => {
    const p = makeProvider({ defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT })
    expect(isGeminiProvider(p)).toBe(true)
  })

  it('isGeminiProvider: false for other endpoints', () => {
    expect(isGeminiProvider(makeProvider())).toBe(false)
  })

  it('isOllamaProvider: true when defaultChatEndpoint is OLLAMA_CHAT', () => {
    const p = makeProvider({ defaultChatEndpoint: ENDPOINT_TYPE.OLLAMA_CHAT })
    expect(isOllamaProvider(p)).toBe(true)
  })

  it('isOpenAIResponsesProvider: true when defaultChatEndpoint is OPENAI_RESPONSES', () => {
    const p = makeProvider({ defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES })
    expect(isOpenAIResponsesProvider(p)).toBe(true)
  })

  it('isOpenAIChatProvider: true when defaultChatEndpoint is OPENAI_CHAT_COMPLETIONS', () => {
    const p = makeProvider({ defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS })
    expect(isOpenAIChatProvider(p)).toBe(true)
  })
})

describe('provider.v2 - Vendor-level identity checks (authType)', () => {
  it('isAzureOpenAIProvider: true when authType is iam-azure', () => {
    const p = makeProvider({ authType: 'iam-azure' })
    expect(isAzureOpenAIProvider(p)).toBe(true)
  })

  it('isAzureOpenAIProvider: false for other authTypes', () => {
    expect(isAzureOpenAIProvider(makeProvider({ authType: 'api-key' }))).toBe(false)
  })

  it('isVertexProvider: true when authType is iam-gcp', () => {
    const p = makeProvider({ authType: 'iam-gcp' })
    expect(isVertexProvider(p)).toBe(true)
  })

  it('isAwsBedrockProvider: true when authType is iam-aws', () => {
    const p = makeProvider({ authType: 'iam-aws' })
    expect(isAwsBedrockProvider(p)).toBe(true)
  })
})

describe('provider.v2 - ID-level identity checks', () => {
  it('isCherryAIProvider: true when id is cherryai', () => {
    expect(isCherryAIProvider(makeProvider({ id: 'cherryai' }))).toBe(true)
    expect(isCherryAIProvider(makeProvider({ id: 'other' }))).toBe(false)
  })

  it('isPerplexityProvider: true when id is perplexity', () => {
    expect(isPerplexityProvider(makeProvider({ id: 'perplexity' }))).toBe(true)
    expect(isPerplexityProvider(makeProvider({ id: 'other' }))).toBe(false)
  })

  it('isNewApiProvider: true for new-api or cherryin id, or presetProviderId new-api', () => {
    expect(isNewApiProvider(makeProvider({ id: 'new-api' }))).toBe(true)
    expect(isNewApiProvider(makeProvider({ id: 'cherryin' }))).toBe(true)
    expect(isNewApiProvider(makeProvider({ id: 'custom', presetProviderId: 'new-api' }))).toBe(true)
    expect(isNewApiProvider(makeProvider({ id: 'openai' }))).toBe(false)
  })

  it('isSystemProvider: true when presetProviderId is defined', () => {
    expect(isSystemProvider(makeProvider({ presetProviderId: 'openai' }))).toBe(true)
    expect(isSystemProvider(makeProvider())).toBe(false) // no presetProviderId
  })
})

describe('provider.v2 - Composite identity checks', () => {
  it('isOpenAICompatibleProvider: true for OPENAI_CHAT_COMPLETIONS or OPENAI_RESPONSES', () => {
    expect(
      isOpenAICompatibleProvider(makeProvider({ defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS }))
    ).toBe(true)
    expect(isOpenAICompatibleProvider(makeProvider({ defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES }))).toBe(true)
    expect(isOpenAICompatibleProvider(makeProvider({ defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES }))).toBe(
      false
    )
  })

  it('isAnthropicSupportedProvider: true for ANTHROPIC_MESSAGES endpoint', () => {
    const p = makeProvider({ defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES })
    expect(isAnthropicSupportedProvider(p)).toBe(true)
  })

  it('isAnthropicSupportedProvider: true when endpointConfigs has ANTHROPIC_MESSAGES baseUrl', () => {
    const p = makeProvider({
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.example.com' } }
    })
    expect(isAnthropicSupportedProvider(p)).toBe(true)
  })

  it('isAnthropicSupportedProvider: false when neither condition is met', () => {
    const p = makeProvider({ defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS })
    expect(isAnthropicSupportedProvider(p)).toBe(false)
  })
})

describe('provider.v2 - Capability checks (apiFeatures)', () => {
  it('isSupportArrayContentProvider reads apiFeatures.arrayContent', () => {
    expect(isSupportArrayContentProvider(makeProvider({ apiFeatures: features({ arrayContent: true }) }))).toBe(true)
    expect(isSupportArrayContentProvider(makeProvider({ apiFeatures: features({ arrayContent: false }) }))).toBe(false)
  })

  it('isSupportDeveloperRoleProvider reads apiFeatures.developerRole', () => {
    expect(isSupportDeveloperRoleProvider(makeProvider({ apiFeatures: features({ developerRole: true }) }))).toBe(true)
    expect(isSupportDeveloperRoleProvider(makeProvider({ apiFeatures: features({ developerRole: false }) }))).toBe(
      false
    )
  })

  it('isSupportStreamOptionsProvider reads apiFeatures.streamOptions', () => {
    expect(isSupportStreamOptionsProvider(makeProvider({ apiFeatures: features({ streamOptions: true }) }))).toBe(true)
    expect(isSupportStreamOptionsProvider(makeProvider({ apiFeatures: features({ streamOptions: false }) }))).toBe(
      false
    )
  })

  it('isSupportServiceTierProvider reads apiFeatures.serviceTier', () => {
    expect(isSupportServiceTierProvider(makeProvider({ apiFeatures: features({ serviceTier: true }) }))).toBe(true)
    expect(isSupportServiceTierProvider(makeProvider({ apiFeatures: features({ serviceTier: false }) }))).toBe(false)
  })

  it('isSupportVerbosityProvider reads apiFeatures.verbosity', () => {
    expect(isSupportVerbosityProvider(makeProvider({ apiFeatures: features({ verbosity: true }) }))).toBe(true)
    expect(isSupportVerbosityProvider(makeProvider({ apiFeatures: features({ verbosity: false }) }))).toBe(false)
  })

  it('isSupportEnableThinkingProvider reads apiFeatures.enableThinking', () => {
    expect(isSupportEnableThinkingProvider(makeProvider({ apiFeatures: features({ enableThinking: true }) }))).toBe(
      true
    )
    expect(isSupportEnableThinkingProvider(makeProvider({ apiFeatures: features({ enableThinking: false }) }))).toBe(
      false
    )
  })
})

describe('provider.v2 - Display helpers', () => {
  it('getFancyProviderName: uses provider label for system providers', () => {
    const p = makeProvider({ id: 'openai', presetProviderId: 'openai', name: 'My Custom Name' })
    // System provider → should use i18n label (mocked as id-based fallback)
    const name = getFancyProviderName(p)
    expect(typeof name).toBe('string')
    expect(name.length).toBeGreaterThan(0)
  })

  it('getFancyProviderName: uses provider.name for custom providers', () => {
    const p = makeProvider({ name: 'My Custom Provider' })
    expect(getFancyProviderName(p)).toBe('My Custom Provider')
  })

  it('matchKeywordsInProvider: matches by name for custom providers', () => {
    const p = makeProvider({ name: 'My Custom Provider' })
    expect(matchKeywordsInProvider(['custom'], p)).toBe(true)
    expect(matchKeywordsInProvider(['nonexistent'], p)).toBe(false)
  })

  it('matchKeywordsInProvider: matches by id for system providers', () => {
    const p = makeProvider({ id: 'openai', presetProviderId: 'openai' })
    expect(matchKeywordsInProvider(['openai'], p)).toBe(true)
  })

  it('matchKeywordsInProvider: returns true for empty keywords', () => {
    const p = makeProvider()
    expect(matchKeywordsInProvider([], p)).toBe(true)
  })
})

describe('provider.v2 - API Key helpers', () => {
  it('hasApiKeys: returns false for empty apiKeys array', () => {
    expect(hasApiKeys(makeProvider({ apiKeys: [] }))).toBe(false)
  })

  it('hasApiKeys: returns false when all keys are disabled', () => {
    expect(
      hasApiKeys(
        makeProvider({
          apiKeys: [
            { id: '1', isEnabled: false },
            { id: '2', isEnabled: false }
          ]
        })
      )
    ).toBe(false)
  })

  it('hasApiKeys: returns true when at least one key is enabled', () => {
    expect(
      hasApiKeys(
        makeProvider({
          apiKeys: [
            { id: '1', isEnabled: false },
            { id: '2', isEnabled: true }
          ]
        })
      )
    ).toBe(true)
  })
})

describe('provider.v2 - Endpoint config helpers', () => {
  it('replaceEndpointConfigDomain: replaces domain in all baseUrls while preserving paths', () => {
    const result = replaceEndpointConfigDomain(
      {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://old.com/v1' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://old.com/anthropic' }
      },
      'new.com'
    )
    expect(result[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl).toBe('https://new.com/v1')
    expect(result[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl).toBe('https://new.com/anthropic')
  })

  it('replaceEndpointConfigDomain: returns empty object for undefined input', () => {
    expect(replaceEndpointConfigDomain(undefined, 'new.com')).toEqual({})
  })

  it('replaceEndpointConfigDomain: preserves invalid URLs unchanged', () => {
    const result = replaceEndpointConfigDomain(
      { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'not-a-url' } },
      'new.com'
    )
    expect(result[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl).toBe('not-a-url')
  })

  it('replaceEndpointConfigDomain: handles URLs with ports and paths', () => {
    const result = replaceEndpointConfigDomain(
      { [ENDPOINT_TYPE.OLLAMA_CHAT]: { baseUrl: 'http://localhost:11434/api' } },
      '192.168.1.100'
    )
    expect(result[ENDPOINT_TYPE.OLLAMA_CHAT]?.baseUrl).toBe('http://192.168.1.100:11434/api')
  })

  it('replaceEndpointConfigDomain: preserves other EndpointConfig fields', () => {
    const result = replaceEndpointConfigDomain(
      {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://old.com/v1', reasoningFormatType: 'openai-chat' }
      },
      'new.com'
    )
    expect(result[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl).toBe('https://new.com/v1')
    expect(result[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.reasoningFormatType).toBe('openai-chat')
  })
})

/** Helper to create RuntimeApiFeatures with defaults */
function features(overrides: Partial<Provider['apiFeatures']> = {}): Provider['apiFeatures'] {
  return {
    arrayContent: true,
    streamOptions: true,
    developerRole: false,
    serviceTier: false,
    verbosity: false,
    enableThinking: true,
    ...overrides
  }
}
