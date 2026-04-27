/**
 * Google Vertex AI Anthropic Provider
 *
 * Custom provider wrapper that disables native structured output for Claude models.
 * This is necessary because Vertex AI rejects the `structured-outputs-2025-11-13` beta header
 * that @ai-sdk/anthropic adds by default for claude-opus-4-6 / claude-sonnet-4-6 /
 * claude-*-4-5 / claude-opus-4-1 models. See issue #14645.
 */
import { AnthropicMessagesLanguageModel } from '@ai-sdk/anthropic/internal'
import {
  createVertexAnthropic,
  type GoogleVertexAnthropicProvider,
  type GoogleVertexAnthropicProviderSettings
} from '@ai-sdk/google-vertex/anthropic/edge'
import type { LanguageModelV3 } from '@ai-sdk/provider'

export function createGoogleVertexAnthropic(
  settings?: GoogleVertexAnthropicProviderSettings
): GoogleVertexAnthropicProvider {
  const baseURL = settings?.baseURL || ''
  const baseProvider = createVertexAnthropic(settings)

  return {
    ...baseProvider,
    languageModel: (modelId: string): LanguageModelV3 => {
      return new AnthropicMessagesLanguageModel(modelId, {
        provider: 'google-vertex-anthropic',
        baseURL,
        headers: (settings?.headers as Record<string, string>) || {},
        supportedUrls: () => ({ 'image/*': [/^https?:\/\/.*$/] }),
        // Vertex AI rejects the `structured-outputs-2025-11-13` beta header that
        // @ai-sdk/anthropic adds by default for certain Claude models.
        // Disable native structured output to fall back to function-tool-based
        // structured outputs, which Vertex AI accepts. See issue #14645.
        supportsNativeStructuredOutput: false
      })
    }
  } as GoogleVertexAnthropicProvider
}
