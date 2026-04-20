/**
 * Anthropic beta-header resolution.
 *
 * Returns the `anthropic-beta` flag names a request should include based on
 * `(assistant, model, provider)`. Consumed by:
 *   - `anthropicHeadersPlugin` — writes `params.headers['anthropic-beta']`
 *     comma-joined for Anthropic-direct requests.
 *   - `buildBedrockProviderOptions` in `utils/options.ts` — uses the array
 *     as `providerOptions.bedrock.anthropicBeta` (Bedrock has its own field).
 *
 * Moved out of the WIP `prepareParams/` dir since it's live infrastructure
 * used by live plugins. Ported from renderer origin/main `aiCore/prepareParams/header.ts`.
 */

import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isClaude4SeriesModel, isClaude45ReasoningModel } from '@shared/utils/model'
import { isAwsBedrockProvider, isVertexProvider } from '@shared/utils/provider'

const INTERLEAVED_THINKING_HEADER = 'interleaved-thinking-2025-05-14'
const WEBSEARCH_HEADER = 'web-search-2025-03-05'

export function addAnthropicHeaders(assistant: Assistant, model: Model, provider?: Provider): string[] {
  const headers: string[] = []

  // Claude 4.5 reasoning with native function-calling tool use — NOT on Vertex / Bedrock
  // (those providers handle interleaved thinking differently).
  if (
    isClaude45ReasoningModel(model) &&
    assistant.settings?.toolUseMode === 'function' &&
    !(provider && (isVertexProvider(provider) || isAwsBedrockProvider(provider)))
  ) {
    headers.push(INTERLEAVED_THINKING_HEADER)
  }

  // Claude 4 series on Vertex with web search enabled.
  if (isClaude4SeriesModel(model)) {
    if (provider && isVertexProvider(provider) && assistant.settings?.enableWebSearch) {
      headers.push(WEBSEARCH_HEADER)
    }
  }

  return headers
}
