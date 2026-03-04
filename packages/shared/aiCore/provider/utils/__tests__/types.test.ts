import type { Provider } from '@types'
import { describe, expect, it } from 'vitest'

import {
  isAnthropicProvider,
  isAzureOpenAIProvider,
  isCherryAIProvider,
  isGeminiProvider,
  isOllamaProvider,
  isPerplexityProvider,
  isVertexProvider
} from '../types'

const createProvider = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'custom',
    type: 'openai',
    name: 'Custom Provider',
    apiKey: 'key',
    apiHost: 'https://api.example.com',
    models: [],
    ...overrides
  }) as Provider

describe('provider type utils', () => {
  it('detects Anthropic providers', () => {
    expect(isAnthropicProvider(createProvider({ type: 'anthropic' }))).toBe(true)
    expect(isAnthropicProvider(createProvider())).toBe(false)
  })

  it('detects Ollama providers', () => {
    expect(isOllamaProvider(createProvider({ type: 'ollama' }))).toBe(true)
    expect(isOllamaProvider(createProvider())).toBe(false)
  })

  it('detects Gemini providers', () => {
    expect(isGeminiProvider(createProvider({ type: 'gemini' }))).toBe(true)
    expect(isGeminiProvider(createProvider())).toBe(false)
  })

  it('detects Azure OpenAI providers', () => {
    expect(isAzureOpenAIProvider(createProvider({ type: 'azure-openai' }))).toBe(true)
    expect(isAzureOpenAIProvider(createProvider())).toBe(false)
  })

  it('detects Vertex providers', () => {
    expect(isVertexProvider(createProvider({ type: 'vertexai' }))).toBe(true)
    expect(isVertexProvider(createProvider())).toBe(false)
  })

  it('detects Perplexity providers', () => {
    expect(isPerplexityProvider(createProvider({ id: 'perplexity' }))).toBe(true)
    expect(isPerplexityProvider(createProvider())).toBe(false)
  })

  it('detects CherryAI providers', () => {
    expect(isCherryAIProvider(createProvider({ id: 'cherryai' }))).toBe(true)
    expect(isCherryAIProvider(createProvider())).toBe(false)
  })
})
