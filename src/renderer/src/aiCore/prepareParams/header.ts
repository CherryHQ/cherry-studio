import { isClaude4SeriesModel, isClaude45ReasoningModel } from '@renderer/config/models'
import { isAwsBedrockProvider } from '@renderer/config/providers'
import { isVertexProvider } from '@renderer/hooks/useVertexAI'
import { getProviderByModel } from '@renderer/services/AssistantService'
import type { Assistant, Model } from '@renderer/types'
import { isToolUseModeFunction } from '@renderer/utils/assistant'

// https://docs.claude.com/en/docs/build-with-claude/extended-thinking#interleaved-thinking
const INTERLEAVED_THINKING_HEADER = 'interleaved-thinking-2025-05-14'
// https://docs.claude.com/en/docs/build-with-claude/context-windows#1m-token-context-window
const CONTEXT_100M_HEADER = 'context-1m-2025-08-07'

export function addAnthropicHeaders(assistant: Assistant, model: Model): string[] {
  const anthropicHeaders: string[] = []
  const provider = getProviderByModel(model)
  if (
    isClaude45ReasoningModel(model) &&
    isToolUseModeFunction(assistant) &&
    !(isVertexProvider(provider) && isAwsBedrockProvider(provider))
  ) {
    anthropicHeaders.push(INTERLEAVED_THINKING_HEADER)
  }
  if (isClaude4SeriesModel(model)) {
    anthropicHeaders.push(CONTEXT_100M_HEADER)
  }
  return anthropicHeaders
}
