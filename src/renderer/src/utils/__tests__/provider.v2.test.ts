import type { Provider } from '@shared/data/types/provider'
import { EndpointType } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import {
  getFancyProviderName,
  isAnthropicProvider,
  isAnthropicSupportedProvider,
  isAwsBedrockProvider,
  isAzureOpenAIProvider,
  isCherryAIProvider,
  matchKeywordsInProvider,
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
  isVertexProvider
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
    const p = makeProvider({ defaultChatEndpoint: EndpointType.ANTHROPIC_MESSAGES })
    expect(isAnthropicProvider(p)).toBe(true)
  })

  it('isAnthropicProvider: false for other endpoints', () => {
    expect(isAnthropicProvider(makeProvider({ defaultChatEndpoint: EndpointType.OPENAI_CHAT_COMPLETIONS }))).toBe(false)
    expect(isAnthropicProvider(makeProvider())).toBe(false) // undefined endpoint
  })

  it('isGeminiProvider: true when defaultChatEndpoint is GOOGLE_GENERATE_CONTENT', () => {
    const p = makeProvider({ defaultChatEndpoint: EndpointType.GOOGLE_GENERATE_CONTENT })
    expect(isGeminiProvider(p)).toBe(true)
  })

  it('isGeminiProvider: false for other endpoints', () => {
    expect(isGeminiProvider(makeProvider())).toBe(false)
  })

  it('isOllamaProvider: true when defaultChatEndpoint is OLLAMA_CHAT', () => {
    const p = makeProvider({ defaultChatEndpoint: EndpointType.OLLAMA_CHAT })
    expect(isOllamaProvider(p)).toBe(true)
  })

  it('isOpenAIResponsesProvider: true when defaultChatEndpoint is OPENAI_RESPONSES', () => {
    const p = makeProvider({ defaultChatEndpoint: EndpointType.OPENAI_RESPONSES })
    expect(isOpenAIResponsesProvider(p)).toBe(true)
  })

  it('isOpenAIChatProvider: true when defaultChatEndpoint is OPENAI_CHAT_COMPLETIONS', () => {
    const p = makeProvider({ defaultChatEndpoint: EndpointType.OPENAI_CHAT_COMPLETIONS })
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
      isOpenAICompatibleProvider(makeProvider({ defaultChatEndpoint: EndpointType.OPENAI_CHAT_COMPLETIONS }))
    ).toBe(true)
    expect(isOpenAICompatibleProvider(makeProvider({ defaultChatEndpoint: EndpointType.OPENAI_RESPONSES }))).toBe(true)
    expect(isOpenAICompatibleProvider(makeProvider({ defaultChatEndpoint: EndpointType.ANTHROPIC_MESSAGES }))).toBe(
      false
    )
  })

  it('isAnthropicSupportedProvider: true for ANTHROPIC_MESSAGES endpoint', () => {
    const p = makeProvider({ defaultChatEndpoint: EndpointType.ANTHROPIC_MESSAGES })
    expect(isAnthropicSupportedProvider(p)).toBe(true)
  })

  it('isAnthropicSupportedProvider: true when baseUrls has ANTHROPIC_MESSAGES key', () => {
    const p = makeProvider({
      defaultChatEndpoint: EndpointType.OPENAI_CHAT_COMPLETIONS,
      baseUrls: { [EndpointType.ANTHROPIC_MESSAGES]: 'https://api.example.com' }
    })
    expect(isAnthropicSupportedProvider(p)).toBe(true)
  })

  it('isAnthropicSupportedProvider: false when neither condition is met', () => {
    const p = makeProvider({ defaultChatEndpoint: EndpointType.OPENAI_CHAT_COMPLETIONS })
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
