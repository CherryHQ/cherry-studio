import { type AzureOpenAIProvider, type Provider, SystemProviderIds } from '@renderer/types'
import { describe, expect, it, vi } from 'vitest'

import {
  getClaudeSupportedProviders,
  isAIGatewayProvider,
  isAnthropicProvider,
  isAzureOpenAIProvider,
  isCherryAIProvider,
  isGeminiProvider,
  isGeminiWebSearchProvider,
  isNewApiProvider,
  isOpenAICompatibleProvider,
  isOpenAIProvider,
  isPerplexityProvider,
  isSupportAPIVersionProvider,
  isSupportArrayContentProvider,
  isSupportDeveloperRoleProvider,
  isSupportEnableThinkingProvider,
  isSupportServiceTierProvider,
  isSupportStreamOptionsProvider,
  isSupportUrlContextProvider
} from '../provider'

vi.mock('@renderer/store/settings', () => ({
  default: (state = { settings: {} }) => state
}))

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


const createProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'custom',
  type: 'openai',
  name: 'Custom Provider',
  apiKey: 'key',
  apiHost: 'https://api.example.com',
  models: [],
  ...overrides
})

const createSystemProvider = (overrides: Partial<Provider> = {}): Provider =>
  createProvider({
    id: SystemProviderIds.openai,
    isSystem: true,
    ...overrides
  })

describe('provider utils', () => {
  it('filters Claude supported providers', () => {
    const providers = [
      createProvider({ id: 'anthropic-official', type: 'anthropic' }),
      createProvider({ id: 'custom-host', anthropicApiHost: 'https://anthropic.local' }),
      createProvider({ id: 'aihubmix' }),
      createProvider({ id: 'other' })
    ]

    expect(getClaudeSupportedProviders(providers)).toEqual(providers.slice(0, 3))
  })

  it('evaluates message array content support', () => {
    expect(isSupportArrayContentProvider(createProvider())).toBe(true)

    expect(
      isSupportArrayContentProvider(createProvider({ apiOptions: { isNotSupportArrayContent: true } }))
    ).toBe(false)

    expect(isSupportArrayContentProvider(createSystemProvider({ id: SystemProviderIds.deepseek }))).toBe(false)
  })

  it('evaluates developer role support', () => {
    expect(
      isSupportDeveloperRoleProvider(createProvider({ apiOptions: { isSupportDeveloperRole: true } }))
    ).toBe(true)
    expect(isSupportDeveloperRoleProvider(createSystemProvider())).toBe(true)
    expect(isSupportDeveloperRoleProvider(createSystemProvider({ id: SystemProviderIds.poe }))).toBe(false)
  })

  it('checks stream options support', () => {
    expect(isSupportStreamOptionsProvider(createProvider())).toBe(true)
    expect(
      isSupportStreamOptionsProvider(createProvider({ apiOptions: { isNotSupportStreamOptions: true } }))
    ).toBe(false)
    expect(isSupportStreamOptionsProvider(createSystemProvider({ id: SystemProviderIds.mistral }))).toBe(false)
  })

  it('checks enable thinking support', () => {
    expect(isSupportEnableThinkingProvider(createProvider())).toBe(true)
    expect(
      isSupportEnableThinkingProvider(createProvider({ apiOptions: { isNotSupportEnableThinking: true } }))
    ).toBe(false)
    expect(isSupportEnableThinkingProvider(createSystemProvider({ id: SystemProviderIds.nvidia }))).toBe(false)
  })

  it('determines service tier support', () => {
    expect(isSupportServiceTierProvider(createProvider({ apiOptions: { isSupportServiceTier: true } }))).toBe(true)
    expect(isSupportServiceTierProvider(createSystemProvider())).toBe(true)
    expect(isSupportServiceTierProvider(createSystemProvider({ id: SystemProviderIds.github }))).toBe(false)
  })

  it('detects URL context capable providers', () => {
    expect(isSupportUrlContextProvider(createProvider({ type: 'gemini' }))).toBe(true)
    expect(
      isSupportUrlContextProvider(
        createSystemProvider({ id: SystemProviderIds.cherryin, type: 'openai', isSystem: true })
      )
    ).toBe(true)
    expect(isSupportUrlContextProvider(createProvider())).toBe(false)
  })

  it('identifies Gemini web search providers', () => {
    expect(isGeminiWebSearchProvider(createSystemProvider({ id: SystemProviderIds.gemini, type: 'gemini' }))).toBe(
      true
    )
    expect(
      isGeminiWebSearchProvider(createSystemProvider({ id: SystemProviderIds.vertexai, type: 'vertexai' }))
    ).toBe(true)
    expect(isGeminiWebSearchProvider(createSystemProvider())).toBe(false)
  })

  it('detects New API providers by id or type', () => {
    expect(isNewApiProvider(createProvider({ id: SystemProviderIds['new-api'] }))).toBe(true)
    expect(isNewApiProvider(createProvider({ id: SystemProviderIds.cherryin }))).toBe(true)
    expect(isNewApiProvider(createProvider({ type: 'new-api' }))).toBe(true)
    expect(isNewApiProvider(createProvider())).toBe(false)
  })

  it('detects specific provider ids', () => {
    expect(isCherryAIProvider(createProvider({ id: 'cherryai' }))).toBe(true)
    expect(isCherryAIProvider(createProvider())).toBe(false)

    expect(isPerplexityProvider(createProvider({ id: SystemProviderIds.perplexity }))).toBe(true)
    expect(isPerplexityProvider(createProvider())).toBe(false)
  })

  it('recognizes OpenAI compatible providers', () => {
    expect(isOpenAICompatibleProvider(createProvider({ type: 'openai' }))).toBe(true)
    expect(isOpenAICompatibleProvider(createProvider({ type: 'new-api' }))).toBe(true)
    expect(isOpenAICompatibleProvider(createProvider({ type: 'mistral' }))).toBe(true)
    expect(isOpenAICompatibleProvider(createProvider({ type: 'anthropic' }))).toBe(false)
  })

  it('narrows Azure OpenAI providers', () => {
    const azureProvider = {
      ...createProvider({ type: 'azure-openai' }),
      apiVersion: '2024-06-01'
    } as AzureOpenAIProvider
    expect(isAzureOpenAIProvider(azureProvider)).toBe(true)
    expect(isAzureOpenAIProvider(createProvider())).toBe(false)
  })

  it('checks provider type helpers', () => {
    expect(isOpenAIProvider(createProvider({ type: 'openai-response' }))).toBe(true)
    expect(isOpenAIProvider(createProvider())).toBe(false)

    expect(isAnthropicProvider(createProvider({ type: 'anthropic' }))).toBe(true)
    expect(isGeminiProvider(createProvider({ type: 'gemini' }))).toBe(true)
    expect(isAIGatewayProvider(createProvider({ type: 'ai-gateway' }))).toBe(true)
  })

  it('computes API version support', () => {
    expect(isSupportAPIVersionProvider(createSystemProvider())).toBe(true)
    expect(isSupportAPIVersionProvider(createSystemProvider({ id: SystemProviderIds.github }))).toBe(false)
    expect(isSupportAPIVersionProvider(createProvider())).toBe(true)
    expect(
      isSupportAPIVersionProvider(createProvider({ apiOptions: { isNotSupportAPIVersion: false } }))
    ).toBe(false)
  })
})
