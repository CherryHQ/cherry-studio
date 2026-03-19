/**
 * Cherry Studio 项目特定的 Provider Extensions
 * 用于支持运行时动态导入的 AI Providers
 */

import { type AmazonBedrockProviderSettings, createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { type AnthropicProviderSettings, createAnthropic } from '@ai-sdk/anthropic'
import { type CerebrasProviderSettings, createCerebras } from '@ai-sdk/cerebras'
import { createGateway, type GatewayProviderSettings } from '@ai-sdk/gateway'
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic/edge'
import { createVertex, type GoogleVertexProviderSettings } from '@ai-sdk/google-vertex/edge'
import { createHuggingFace, type HuggingFaceProviderSettings } from '@ai-sdk/huggingface'
import { createMistral, type MistralProviderSettings } from '@ai-sdk/mistral'
import { createPerplexity, type PerplexityProviderSettings } from '@ai-sdk/perplexity'
import type { ProviderV2, ProviderV3 } from '@ai-sdk/provider'
import type { ExtensionStorage } from '@cherrystudio/ai-core/provider'
import { ProviderExtension, type ProviderExtensionConfig } from '@cherrystudio/ai-core/provider'
import {
  createGitHubCopilotOpenAICompatible,
  type GitHubCopilotProviderSettings
} from '@opeoginni/github-copilot-openai-compatible'
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
  create: createVertex
} as const satisfies ProviderExtensionConfig<
  GoogleVertexProviderSettings,
  ExtensionStorage,
  ProviderV3,
  'google-vertex'
>)

/**
 * Google Vertex AI Anthropic Extension
 */
export const GoogleVertexAnthropicExtension = ProviderExtension.create({
  name: 'google-vertex-anthropic',
  aliases: ['vertexai-anthropic'] as const,
  supportsImageGeneration: true,
  create: createVertexAnthropic
} as const satisfies ProviderExtensionConfig<
  GoogleVertexProviderSettings,
  ExtensionStorage,
  ProviderV3,
  'google-vertex-anthropic'
>)

/**
 * Azure AI Anthropic Extension
 */
export const AzureAnthropicExtension = ProviderExtension.create({
  name: 'azure-anthropic',
  supportsImageGeneration: false,
  create: createAnthropic
} as const satisfies ProviderExtensionConfig<
  AnthropicProviderSettings,
  ExtensionStorage,
  ProviderV3,
  'azure-anthropic'
>)

/**
 * GitHub Copilot Extension
 */
export const GitHubCopilotExtension = ProviderExtension.create({
  name: 'github-copilot-openai-compatible',
  aliases: ['copilot', 'github-copilot'] as const,
  supportsImageGeneration: false,
  create: (options?: GitHubCopilotProviderSettings) => {
    const provider = createGitHubCopilotOpenAICompatible(options) as unknown as ProviderV2
    return wrapProvider({ provider, languageModelMiddleware: [] })
  }
} as const satisfies ProviderExtensionConfig<
  GitHubCopilotProviderSettings,
  ExtensionStorage,
  ProviderV3,
  'github-copilot-openai-compatible'
>)

/**
 * Amazon Bedrock Extension
 */
export const BedrockExtension = ProviderExtension.create({
  name: 'bedrock',
  aliases: ['aws-bedrock'] as const,
  supportsImageGeneration: true,
  create: createAmazonBedrock
} as const satisfies ProviderExtensionConfig<AmazonBedrockProviderSettings, ExtensionStorage, ProviderV3, 'bedrock'>)

/**
 * Perplexity Extension
 */
export const PerplexityExtension = ProviderExtension.create({
  name: 'perplexity',
  supportsImageGeneration: false,
  create: createPerplexity
} as const satisfies ProviderExtensionConfig<PerplexityProviderSettings, ExtensionStorage, ProviderV3, 'perplexity'>)

/**
 * Mistral Extension
 */
export const MistralExtension = ProviderExtension.create({
  name: 'mistral',
  supportsImageGeneration: false,
  create: createMistral
} as const satisfies ProviderExtensionConfig<MistralProviderSettings, ExtensionStorage, ProviderV3, 'mistral'>)

/**
 * HuggingFace Extension
 */
export const HuggingFaceExtension = ProviderExtension.create({
  name: 'huggingface',
  aliases: ['hf', 'hugging-face'] as const,
  supportsImageGeneration: true,
  create: createHuggingFace
} as const satisfies ProviderExtensionConfig<HuggingFaceProviderSettings, ExtensionStorage, ProviderV3, 'huggingface'>)

/**
 * Vercel AI Gateway Extension
 */
export const GatewayExtension = ProviderExtension.create({
  name: 'gateway',
  aliases: ['ai-gateway'] as const,
  supportsImageGeneration: true,
  create: createGateway
} as const satisfies ProviderExtensionConfig<GatewayProviderSettings, ExtensionStorage, ProviderV3, 'gateway'>)

/**
 * Cerebras Extension
 */
export const CerebrasExtension = ProviderExtension.create({
  name: 'cerebras',
  supportsImageGeneration: false,
  create: createCerebras
} as const satisfies ProviderExtensionConfig<CerebrasProviderSettings, ExtensionStorage, ProviderV3, 'cerebras'>)

/**
 * Ollama Extension
 */
export const OllamaExtension = ProviderExtension.create({
  name: 'ollama',
  supportsImageGeneration: false,
  create: (options?: OllamaProviderSettings) => createOllama(options)
} as const satisfies ProviderExtensionConfig<OllamaProviderSettings, ExtensionStorage, ProviderV3, 'ollama'>)

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
