import type { AzureOpenAIProvider, Provider, VertexProvider } from '@types'

export function isAnthropicProvider(provider: Provider): boolean {
  return provider.type === 'anthropic'
}

export function isOllamaProvider(provider: Provider): boolean {
  return provider.type === 'ollama'
}

export function isGeminiProvider(provider: Provider): boolean {
  return provider.type === 'gemini'
}

export function isAzureOpenAIProvider(provider: Provider): provider is AzureOpenAIProvider {
  return provider.type === 'azure-openai'
}

// FIXME: #13194
export function isVertexProvider(provider: Provider): provider is VertexProvider {
  return provider.type === 'vertexai'
}

export function isPerplexityProvider(provider: Provider): boolean {
  return provider.id === 'perplexity'
}

export function isCherryAIProvider(provider: Provider): boolean {
  return provider.id === 'cherryai'
}
