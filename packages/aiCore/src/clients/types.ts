import { generateObject, generateText, streamObject, streamText } from 'ai'

import type { ProviderSettingsMap } from '../providers/registry'

// ProviderSettings 是所有 Provider Settings 的联合类型
export type ProviderSettings = ProviderSettingsMap[keyof ProviderSettingsMap]

export type StreamTextParams = Omit<Parameters<typeof streamText>[0], 'model'>
export type GenerateTextParams = Omit<Parameters<typeof generateText>[0], 'model'>
export type StreamObjectParams = Omit<Parameters<typeof streamObject>[0], 'model'>
export type GenerateObjectParams = Omit<Parameters<typeof generateObject>[0], 'model'>

// 重新导出 ProviderSettingsMap 中的所有类型
export type {
  AmazonBedrockProviderSettings,
  AnthropicProviderSettings,
  AnthropicVertexProviderSettings,
  AzureOpenAIProviderSettings,
  CerebrasProviderSettings,
  CohereProviderSettings,
  DeepInfraProviderSettings,
  DeepSeekProviderSettings,
  FalProviderSettings,
  FireworksProviderSettings,
  GoogleGenerativeAIProviderSettings,
  GoogleVertexProviderSettings,
  GroqProviderSettings,
  MistralProviderSettings,
  OllamaProviderSettings,
  OpenAICompatibleProviderSettings,
  OpenAIProviderSettings,
  OpenRouterProviderSettings,
  PerplexityProviderSettings,
  ProviderId,
  ProviderSettingsMap,
  QwenProviderSettings,
  ReplicateProviderSettings,
  TogetherAIProviderSettings,
  VercelProviderSettings,
  XaiProviderSettings,
  ZhipuProviderSettings
} from '../providers/registry'
