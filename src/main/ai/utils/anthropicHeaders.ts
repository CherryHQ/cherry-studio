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

import { getAnthropicBetaPolicy } from '@cherrystudio/provider-registry'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { getRawModelId } from '@shared/utils/model'
import { isAwsBedrockProvider, isVertexProvider } from '@shared/utils/provider'

const INTERLEAVED_THINKING_HEADER = 'interleaved-thinking-2025-05-14'
const WEBSEARCH_HEADER = 'web-search-2025-03-05'

/** `serverWebSearch` is the finalized route decision (`webToolRoutes.webSearch === 'server'`), not the raw setting. */
export function addAnthropicHeaders(model: Model, provider?: Provider, serverWebSearch = false): string[] {
  const headers: string[] = []

  const host =
    provider && isVertexProvider(provider)
      ? 'vertex'
      : provider && isAwsBedrockProvider(provider)
        ? 'bedrock'
        : 'direct'
  const policy = getAnthropicBetaPolicy(getRawModelId(model), host)
  if (policy.interleavedThinking) headers.push(INTERLEAVED_THINKING_HEADER)
  if (policy.webSearch && serverWebSearch) headers.push(WEBSEARCH_HEADER)
  return headers
}
