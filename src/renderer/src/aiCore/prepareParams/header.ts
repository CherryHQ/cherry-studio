import { isClaude4SeriesModel, isClaude45ReasoningModel } from '@renderer/config/models'
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Assistant, Model } from '@renderer/types'
import { isToolUseModeFunction } from '@renderer/utils/assistant'
import { isAwsBedrockProvider, isVertexProvider } from '@renderer/utils/provider'

// https://docs.claude.com/en/docs/build-with-claude/extended-thinking#interleaved-thinking
const INTERLEAVED_THINKING_HEADER = 'interleaved-thinking-2025-05-14'
// https://docs.claude.com/en/docs/build-with-claude/context-windows#1m-token-context-window
// const CONTEXT_100M_HEADER = 'context-1m-2025-08-07'
// https://docs.cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude/web-search
const WEBSEARCH_HEADER = 'web-search-2025-03-05'

export function addAnthropicHeaders(assistant: Assistant, model: Model): string[] {
  const anthropicHeaders: string[] = []
  const provider = getProviderByModel(model)
  if (
    isClaude45ReasoningModel(model) &&
    isToolUseModeFunction(assistant) &&
    !(isVertexProvider(provider) || isAwsBedrockProvider(provider))
  ) {
    anthropicHeaders.push(INTERLEAVED_THINKING_HEADER)
  }
  if (isClaude4SeriesModel(model)) {
    if (isVertexProvider(provider) && assistant.enableWebSearch) {
      anthropicHeaders.push(WEBSEARCH_HEADER)
    }
    // We may add it by user preference in assistant.settings instead of always adding it.
    // See #11540, #11397
    // anthropicHeaders.push(CONTEXT_100M_HEADER)
  }
  return anthropicHeaders
}
