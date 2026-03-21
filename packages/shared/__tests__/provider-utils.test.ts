import { describe, expect, it } from 'vitest'

import type { MinimalProvider } from '../types'
import { getBaseModelName, getLowerBaseModelName } from '../utils/naming'
import {
  isAIGatewayProvider,
  isAnthropicProvider,
  isAwsBedrockProvider,
  isAzureOpenAIProvider,
  isAzureResponsesEndpoint,
  isCherryAIProvider,
  isCopilotResponsesModel,
  isGeminiProvider,
  isNewApiProvider,
  isOllamaProvider,
  isOpenAICompatibleProvider,
  isOpenAIProvider,
  isPerplexityProvider,
  isVertexProvider
} from '../utils/provider'
import {
  formatApiHost,
  formatOllamaApiHost,
  formatVertexApiHost,
  getAiSdkBaseUrl,
  routeToEndpoint,
  validateApiHost
} from '../utils/url'

const createProvider = (overrides: Partial<MinimalProvider> = {}): MinimalProvider => ({
  id: 'provider-id',
  type: 'openai',
  apiKey: 'test-key',
  apiHost: 'https://api.example.com',
  ...overrides
})

describe('shared naming utils', () => {
  it('extracts the base model name with the default delimiter', () => {
    expect(getBaseModelName('deepseek-ai/deepseek/deepseek-r1')).toBe('deepseek-r1')
  })

  it('supports custom delimiters', () => {
    expect(getBaseModelName('provider::model-name', '::')).toBe('model-name')
  })

  it('normalizes model names to lowercase and strips free/cloud suffixes', () => {
    expect(getLowerBaseModelName('openrouter/DeepSeek-R1:FREE')).toBe('deepseek-r1')
    expect(getLowerBaseModelName('cherryin/Claude-4:cloud')).toBe('claude-4')
    expect(getLowerBaseModelName('cherryin/ModelName(free)')).toBe('modelname')
  })

  it('normalizes fireworks model ids', () => {
    expect(getLowerBaseModelName('accounts/fireworks/models/llama-v3p2')).toBe('llama-v3.2')
  })
})

describe('shared provider utils', () => {
  it('detects provider kinds from provider.type', () => {
    expect(isAnthropicProvider(createProvider({ type: 'anthropic' }))).toBe(true)
    expect(isOpenAIProvider(createProvider({ type: 'openai-response' }))).toBe(true)
    expect(isGeminiProvider(createProvider({ type: 'gemini' }))).toBe(true)
    expect(isAzureOpenAIProvider(createProvider({ type: 'azure-openai' }))).toBe(true)
    expect(isVertexProvider(createProvider({ type: 'vertexai' }))).toBe(true)
    expect(isAwsBedrockProvider(createProvider({ type: 'aws-bedrock' }))).toBe(true)
    expect(isAIGatewayProvider(createProvider({ type: 'gateway' }))).toBe(true)
    expect(isOllamaProvider(createProvider({ type: 'ollama' }))).toBe(true)
  })

  it('detects id-based providers and compatibility helpers', () => {
    expect(isCherryAIProvider(createProvider({ id: 'cherryai' }))).toBe(true)
    expect(isPerplexityProvider(createProvider({ id: 'perplexity' }))).toBe(true)
    expect(isNewApiProvider(createProvider({ id: 'new-api', type: 'openai' }))).toBe(true)
    expect(isNewApiProvider(createProvider({ id: 'cherryin', type: 'openai' }))).toBe(true)
    expect(isOpenAICompatibleProvider(createProvider({ type: 'mistral' }))).toBe(true)
    expect(isOpenAICompatibleProvider(createProvider({ type: 'anthropic' }))).toBe(false)
  })

  it('detects azure responses endpoints by apiVersion', () => {
    expect(isAzureResponsesEndpoint(createProvider({ type: 'azure-openai', apiVersion: 'preview' }))).toBe(true)
    expect(isAzureResponsesEndpoint(createProvider({ type: 'azure-openai', apiVersion: 'v1' }))).toBe(true)
    expect(isAzureResponsesEndpoint(createProvider({ type: 'azure-openai', apiVersion: '2024-10-21' }))).toBe(false)
  })

  it('detects copilot responses model ids after normalization', () => {
    expect(isCopilotResponsesModel({ id: 'openai/gpt-5-codex' })).toBe(true)
    expect(isCopilotResponsesModel({ id: 'openai/GPT-5.1-CODEX-MINI' })).toBe(true)
    expect(isCopilotResponsesModel({ id: 'openai/gpt-4.1' })).toBe(false)
  })
})

describe('shared url utils', () => {
  it('formats api host by appending a version when missing', () => {
    expect(formatApiHost('https://api.example.com')).toBe('https://api.example.com/v1')
    expect(formatApiHost(' https://api.example.com/ ')).toBe('https://api.example.com/v1')
  })

  it('keeps explicit versions and strips trailing sharp markers', () => {
    expect(formatApiHost('https://api.example.com/v2beta')).toBe('https://api.example.com/v2beta')
    expect(formatApiHost('https://api.example.com/chat/completions#')).toBe('https://api.example.com/chat/completions')
  })

  it('routes endpoint-marked hosts into baseURL and endpoint', () => {
    expect(routeToEndpoint('https://api.example.com/openai/chat/completions#')).toEqual({
      baseURL: 'https://api.example.com/openai',
      endpoint: 'chat/completions'
    })
  })

  it('builds ai sdk base urls with version suffixes', () => {
    expect(getAiSdkBaseUrl('https://api.example.com')).toBe('https://api.example.com/v1')
    expect(getAiSdkBaseUrl('https://api.example.com/v2')).toBe('https://api.example.com/v2')
    expect(getAiSdkBaseUrl('https://api.example.com/chat/completions#')).toBe('https://api.example.com/v1')
  })

  it('formats ollama hosts to /api endpoints', () => {
    expect(formatOllamaApiHost('http://localhost:11434')).toBe('http://localhost:11434/api')
    expect(formatOllamaApiHost('http://localhost:11434/v1')).toBe('http://localhost:11434/api')
  })

  it('formats vertex hosts using region defaults and custom hosts', () => {
    const provider = createProvider({ type: 'vertexai', apiHost: '' })
    expect(formatVertexApiHost(provider, 'project-1', 'asia-east1')).toBe(
      'https://asia-east1-aiplatform.googleapis.com/v1/projects/project-1/locations/asia-east1'
    )

    const customProvider = createProvider({ type: 'vertexai', apiHost: 'https://custom.vertex.example.com/' })
    expect(formatVertexApiHost(customProvider, 'project-1', 'asia-east1')).toBe('https://custom.vertex.example.com/v1')
  })

  it('validates api hosts', () => {
    expect(validateApiHost('https://api.example.com')).toBe(true)
    expect(validateApiHost('http://localhost:3000')).toBe(true)
    expect(validateApiHost('')).toBe(true)
    expect(validateApiHost('ftp://example.com')).toBe(false)
    expect(validateApiHost('not-a-url')).toBe(false)
  })
})
