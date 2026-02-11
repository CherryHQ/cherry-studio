import type { Model, Usage } from '@renderer/types'
import type { LanguageModelUsage } from 'ai'

/** Token usage from streaming (OpenAI format) or non-streaming (AI SDK format) */
type TokenUsage = Usage | LanguageModelUsage

interface TokenUsageParams {
  usage: TokenUsage | undefined
  model: Model | undefined
}

/**
 * Track token usage for analytics
 * Handles both OpenAI format (prompt_tokens) and AI SDK format (inputTokens)
 */
export function trackTokenUsage({ usage, model }: TokenUsageParams): void {
  if (!usage || !model?.provider || !model?.id) return

  let inputTokens: number
  let outputTokens: number

  // AI SDK format uses inputTokens, OpenAI format uses prompt_tokens
  if ('inputTokens' in usage) {
    inputTokens = usage.inputTokens ?? 0
    outputTokens = usage.outputTokens ?? 0
  } else {
    inputTokens = usage.prompt_tokens ?? 0
    outputTokens = usage.completion_tokens ?? 0
  }

  if (inputTokens > 0 || outputTokens > 0) {
    window.api.analytics.trackTokenUsage({
      provider: model.provider,
      model: model.id,
      input_tokens: inputTokens,
      output_tokens: outputTokens
    })
  }
}
