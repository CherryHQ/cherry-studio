/**
 * Cherry Studio 项目特定的 Provider Extensions
 * 用于支持运行时动态导入的 AI Providers
 */

import type { ProviderV2 } from '@ai-sdk/provider'
import { ProviderExtension, type ProviderExtensionConfig } from '@cherrystudio/ai-core/provider'
import { wrapProvider } from 'ai'
import type { OllamaProviderSettings } from 'ollama-ai-provider-v2'
import { createOllama } from 'ollama-ai-provider-v2'

/**
 * Google Vertex AI Extension
 */
export const GoogleVertexExtension = ProviderExtension.create({
  name: 'google-vertex',
  aliases: ['vertexai'] as const,
  supportsImageGeneration: true,
  import: () => import('@ai-sdk/google-vertex/edge'),
  creatorFunctionName: 'createVertex'
} as const satisfies ProviderExtensionConfig<any, any, any, 'google-vertex'>)

/**
 * Google Vertex AI Anthropic Extension
 */
export const GoogleVertexAnthropicExtension = ProviderExtension.create({
  name: 'google-vertex-anthropic',
  aliases: ['vertexai-anthropic'] as const,
  supportsImageGeneration: true,
  import: () => import('@ai-sdk/google-vertex/anthropic/edge'),
  creatorFunctionName: 'createVertexAnthropic'
} as const satisfies ProviderExtensionConfig<any, any, any, 'google-vertex-anthropic'>)

/**
 * Azure AI Anthropic Extension
 */
export const AzureAnthropicExtension = ProviderExtension.create({
  name: 'azure-anthropic',
  aliases: ['azure-anthropic'] as const,
  supportsImageGeneration: false,
  import: () => import('@ai-sdk/anthropic'),
  creatorFunctionName: 'createAnthropic'
} as const satisfies ProviderExtensionConfig<any, any, any, 'azure-anthropic'>)

/**
 * GitHub Copilot Extension
 */
export const GitHubCopilotExtension = ProviderExtension.create({
  name: 'github-copilot-openai-compatible',
  aliases: ['copilot', 'github-copilot'] as const,
  supportsImageGeneration: false,
  import: () => import('@opeoginni/github-copilot-openai-compatible'),
  creatorFunctionName: 'createGitHubCopilotOpenAICompatible'
} as const satisfies ProviderExtensionConfig<any, any, any, 'github-copilot-openai-compatible'>)

/**
 * Amazon Bedrock Extension
 */
export const BedrockExtension = ProviderExtension.create({
  name: 'bedrock',
  aliases: ['aws-bedrock'] as const,
  supportsImageGeneration: true,
  import: () => import('@ai-sdk/amazon-bedrock'),
  creatorFunctionName: 'createAmazonBedrock'
} as const satisfies ProviderExtensionConfig<any, any, any, 'bedrock'>)

/**
 * Perplexity Extension
 */
export const PerplexityExtension = ProviderExtension.create({
  name: 'perplexity',
  supportsImageGeneration: false,
  import: () => import('@ai-sdk/perplexity'),
  creatorFunctionName: 'createPerplexity'
} as const satisfies ProviderExtensionConfig<any, any, any, 'perplexity'>)

/**
 * Mistral Extension
 */
export const MistralExtension = ProviderExtension.create({
  name: 'mistral',
  aliases: ['mistral'] as const,
  supportsImageGeneration: false,
  import: () => import('@ai-sdk/mistral'),
  creatorFunctionName: 'createMistral'
} as const satisfies ProviderExtensionConfig<any, any, any, 'mistral'>)

/**
 * HuggingFace Extension
 */
export const HuggingFaceExtension = ProviderExtension.create({
  name: 'huggingface',
  aliases: ['hf', 'hugging-face'] as const,
  supportsImageGeneration: true,
  import: () => import('@ai-sdk/huggingface'),
  creatorFunctionName: 'createHuggingFace'
} as const satisfies ProviderExtensionConfig<any, any, any, 'huggingface'>)

/**
 * Vercel AI Gateway Extension
 */
export const GatewayExtension = ProviderExtension.create({
  name: 'gateway',
  aliases: ['ai-gateway'] as const,
  supportsImageGeneration: true,
  import: () => import('@ai-sdk/gateway'),
  creatorFunctionName: 'createGateway'
} as const satisfies ProviderExtensionConfig<any, any, any, 'gateway'>)

/**
 * Cerebras Extension
 */
export const CerebrasExtension = ProviderExtension.create({
  name: 'cerebras',
  supportsImageGeneration: false,
  import: () => import('@ai-sdk/cerebras'),
  creatorFunctionName: 'createCerebras'
} as const satisfies ProviderExtensionConfig<any, any, any, 'cerebras'>)

/**
 * Ollama Extension
 */
export const OllamaExtension = ProviderExtension.create({
  name: 'ollama',
  supportsImageGeneration: false,
  create: (options?: OllamaProviderSettings) => {
    const provider = createOllama(options) as ProviderV2
    return wrapProvider({ provider, languageModelMiddleware: [] })
  }
} as const satisfies ProviderExtensionConfig<OllamaProviderSettings, any, any, 'ollama'>)

/**
 * 所有项目特定的 Extensions
 */
export const extensions = [
  GoogleVertexExtension,
  GoogleVertexAnthropicExtension,
  AzureAnthropicExtension,
  GitHubCopilotExtension,
  BedrockExtension,
  PerplexityExtension,
  MistralExtension,
  HuggingFaceExtension,
  GatewayExtension,
  CerebrasExtension,
  OllamaExtension
] as const
