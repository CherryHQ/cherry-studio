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
 * Ported from renderer origin/main `aiCore/prepareParams/header.ts`.
 */

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isClaude4SeriesModel, isClaude45ReasoningModel } from '@shared/utils/model'
import { isAwsBedrockProvider, isVertexProvider } from '@shared/utils/provider'

const INTERLEAVED_THINKING_HEADER = 'interleaved-thinking-2025-05-14'
const WEBSEARCH_HEADER = 'web-search-2025-03-05'

/** `serverWebSearch` is the finalized route decision (`webToolRoutes.webSearch === 'server'`), not the raw setting. */
export function addAnthropicHeaders(model: Model, provider?: Provider, serverWebSearch = false): string[] {
  const headers: string[] = []

  // Claude 4.5 reasoning with native function-calling tool use — NOT on Vertex / Bedrock
  // (those providers handle interleaved thinking differently).
  if (
    isClaude45ReasoningModel(model) &&
    !(provider && (isVertexProvider(provider) || isAwsBedrockProvider(provider)))
  ) {
    headers.push(INTERLEAVED_THINKING_HEADER)
  }

  // Claude 4 series on Vertex when the request actually routes web search to the server side.
  if (isClaude4SeriesModel(model)) {
    if (provider && isVertexProvider(provider) && serverWebSearch) {
      headers.push(WEBSEARCH_HEADER)
    }
  }

  return headers
}
