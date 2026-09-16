import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'

import type { RequestFeature } from '../feature'

interface FlatGatewayUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

function isFlatUsage(usage: unknown): usage is FlatGatewayUsage {
  if (!usage || typeof usage !== 'object') return false
  const u = usage as Record<string, unknown>
  // V3-nested usage has `inputTokens` as an object; flat has it as a number.
  // Also handle the case where the field is absent (still treat as flat-shaped
  // upstream — V3 nested would carry the empty object).
  return typeof u.inputTokens !== 'object' || u.inputTokens === null
}

export function normalizeGatewayUsage(flat: FlatGatewayUsage): LanguageModelV3Usage {
  // `inputTokens` is the OpenAI-compatible prompt total, which already contains
  // `cachedInputTokens`. Deriving the non-cached remainder keeps cost computation
  // from pricing the cached part twice: it falls back to the total when
  // `noCache` is missing and then adds the cache-read bucket on top.
  const cachedInput = flat.cachedInputTokens
  const noCache =
    flat.inputTokens !== undefined && cachedInput !== undefined
      ? Math.max(0, flat.inputTokens - cachedInput)
      : undefined

  return {
    inputTokens: {
      total: flat.inputTokens,
      noCache,
      cacheRead: cachedInput,
      cacheWrite: undefined
    },
    outputTokens: {
      total: flat.outputTokens,
      text: undefined,
      reasoning: flat.reasoningTokens
    }
  }
}

const gatewayUsageNormalizeMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate()
    return isFlatUsage(result.usage) ? { ...result, usage: normalizeGatewayUsage(result.usage) } : result
  },
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream()
    const normalized = stream.pipeThrough(
      new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
        transform(chunk, controller) {
          if (chunk.type === 'finish' && isFlatUsage(chunk.usage)) {
            controller.enqueue({ ...chunk, usage: normalizeGatewayUsage(chunk.usage) })
            return
          }
          controller.enqueue(chunk)
        }
      })
    )
    return { stream: normalized, ...rest }
  }
}

function createGatewayUsageNormalizePlugin() {
  return definePlugin({
    name: 'gateway-usage-normalize',
    // Shape adapters belong directly against the provider. `post` makes this
    // middleware innermost, so usage capture and the application both observe
    // the normalized AI SDK v6 shape.
    enforce: 'post',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(gatewayUsageNormalizeMiddleware)
    }
  })
}

export const gatewayUsageNormalizeFeature: RequestFeature = {
  name: 'gateway-usage-normalize',
  applies: (scope) => scope.sdkConfig.providerId === 'gateway',
  contributeModelAdapters: () => [createGatewayUsageNormalizePlugin()]
}
