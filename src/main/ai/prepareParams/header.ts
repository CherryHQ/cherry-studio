import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isClaude4SeriesModel, isClaude45ReasoningModel } from '@shared/utils/model'
import { isAwsBedrockProvider, isVertexProvider } from '@shared/utils/provider'
import type { Assistant } from '@types'

const INTERLEAVED_THINKING_HEADER = 'interleaved-thinking-2025-05-14'
const WEBSEARCH_HEADER = 'web-search-2025-03-05'

export function addAnthropicHeaders(assistant: Assistant, model: Model, provider?: Provider): string[] {
  const anthropicHeaders: string[] = []

  if (
    isClaude45ReasoningModel(model) &&
    assistant.settings?.toolUseMode === 'function' &&
    !(provider && (isVertexProvider(provider) || isAwsBedrockProvider(provider)))
  ) {
    anthropicHeaders.push(INTERLEAVED_THINKING_HEADER)
  }

  if (isClaude4SeriesModel(model)) {
    if (provider && isVertexProvider(provider) && assistant.enableWebSearch) {
      anthropicHeaders.push(WEBSEARCH_HEADER)
    }
  }

  return anthropicHeaders
}
