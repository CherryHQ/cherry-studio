import { getProviderById } from '@renderer/services/ProviderService'
import { isSystemProvider, type Model, type Usage } from '@renderer/types'
import type { LanguageModelUsage } from 'ai'

/** Token usage from streaming (OpenAI format) or non-streaming (AI SDK format) */
type TokenUsage = Usage | LanguageModelUsage

interface TokenUsageParams {
  usage: TokenUsage | undefined
  model: Model | undefined
}

/**
 * Type guard to check if usage is in AI SDK format (LanguageModelUsage)
 * AI SDK format uses inputTokens/outputTokens, OpenAI format uses prompt_tokens/completion_tokens
 */
function isAiSdkUsage(usage: TokenUsage): usage is LanguageModelUsage {
  return 'inputTokens' in usage
}

/**
 * Get a trackable identifier for a provider
 * - System providers: use provider.id directly (e.g., 'openai', 'anthropic')
 * - Custom providers: extract hostname from apiHost (e.g., 'https://api.example.com/v1' -> 'api.example.com')
 * - Fallback: provider.name or provider.id or 'unknown'
 */
function getProviderTrackId(id: string): string {
  const provider = getProviderById(id)

  if (!provider) {
    return 'unknown'
  }

  if (isSystemProvider(provider)) {
    return provider.id
  }

  // Custom provider: extract hostname from apiHost
  if (provider.apiHost) {
    try {
      return new URL(provider.apiHost).hostname
    } catch {
      // URL parsing failed, fall through to name/id fallback
    }
  }

  return provider.name || provider.id || 'unknown'
}

/**
 * Track token usage for analytics
 * Handles both OpenAI format (prompt_tokens) and AI SDK format (inputTokens)
 */
export function trackTokenUsage({ usage, model }: TokenUsageParams): void {
  if (!usage || !model?.provider || !model?.id) return

  const [inputTokens, outputTokens] = isAiSdkUsage(usage)
    ? [usage.inputTokens ?? 0, usage.outputTokens ?? 0]
    : [usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0]

  if (inputTokens > 0 || outputTokens > 0) {
    window.api.analytics.trackTokenUsage({
      provider: getProviderTrackId(model.provider),
      model: model.id,
      input_tokens: inputTokens,
      output_tokens: outputTokens
    })
  }
}
