import type { LanguageModelV3StreamPart, LanguageModelV3Usage } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import { isPlainObject } from 'es-toolkit'

import { definePlugin } from '@cherrystudio/ai-core'
import { isFlatV3Usage, normalizeFlatV3Usage } from '@main/ai/utils/usageNormalize'
import { resolveAnthropicCacheSettings, usesGatewayAutoCaching } from '@shared/ai/anthropicCache'
import type { Provider } from '@shared/data/types/provider'

import type { RequestFeature } from '../feature'

export {
  ensureNestedV3Usage,
  isFlatV3Usage as isFlatUsage,
  normalizeFlatV3Usage,
  normalizeFlatV3Usage as normalizeGatewayUsage
} from '@main/ai/utils/usageNormalize'

/**
 * Reads the Anthropic cache buckets out of raw usage. The gateway reports them only
 * there — never as the sibling usage fields an adapter maps.
 */
function withRawAnthropicCacheUsage(usage: LanguageModelV3Usage): LanguageModelV3Usage {
  if (!isPlainObject(usage) || !isPlainObject(usage.raw)) return usage

  const { raw } = usage
  const toCount = (value: unknown) => (typeof value === 'number' ? value : undefined)
  const rawRead = toCount(raw.cache_read_input_tokens)
  const rawWrite = toCount(raw.cache_creation_input_tokens)
  if (rawRead === undefined && rawWrite === undefined) return usage

  const inputTokens = isFlatV3Usage(usage) ? normalizeFlatV3Usage(usage).inputTokens : usage.inputTokens
  // Raw buckets win when present; the flat-derived bucket is the fallback so a partial raw
  // payload (e.g. a write without a read) never erases what the flat shape already knew.
  const cacheRead = rawRead ?? inputTokens?.cacheRead
  const cacheWrite = rawWrite ?? inputTokens?.cacheWrite
  const total = inputTokens?.total

  if (typeof total !== 'number') {
    // Without a prompt total there is no sum invariant to reconcile: surface the buckets
    // and keep the reported noCache.
    return { ...usage, inputTokens: { ...inputTokens, cacheRead, cacheWrite } }
  }
  if ((cacheRead ?? 0) + (cacheWrite ?? 0) > total) {
    // The raw buckets contradict the prompt total; trusting them would overstate usage.
    // Drop the raw augmentation and keep the provider-reported split.
    return usage
  }
  // Cache reads and writes displace uncached input: reconcile noCache so the buckets keep
  // summing to the prompt total instead of leaving the flat remainder in place. An omitted
  // read bucket reconciles as zero, so a write-only payload cannot leave the write tokens
  // counted on top of an unreconciled noCache in local cost analytics.
  const noCache = Math.max(0, total - (cacheRead ?? 0) - (cacheWrite ?? 0))
  return { ...usage, inputTokens: { ...inputTokens, noCache, cacheRead, cacheWrite } }
}

const gatewayUsageNormalizeMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate()
    const usage = isFlatV3Usage(result.usage) ? normalizeFlatV3Usage(result.usage) : result.usage
    return { ...result, usage: withRawAnthropicCacheUsage(usage) }
  },
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream()
    const normalized = stream.pipeThrough(
      new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
        transform(chunk, controller) {
          if (chunk.type === 'finish') {
            const usage = isFlatV3Usage(chunk.usage) ? normalizeFlatV3Usage(chunk.usage) : chunk.usage
            controller.enqueue({ ...chunk, usage: withRawAnthropicCacheUsage(usage) })
            return
          }
          controller.enqueue(chunk)
        }
      })
    )
    return { stream: normalized, ...rest }
  }
}

/**
 * Vercel AI Gateway on Anthropic: `caching: 'auto'` is what makes the gateway place the
 * `cache_control` breakpoints, so the request needs no marker of its own.
 */
function gatewayAnthropicCacheMiddleware(provider: Provider): LanguageModelMiddleware {
  const { ttl } = resolveAnthropicCacheSettings(provider)

  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const { providerOptions } = params
      const gateway = isPlainObject(providerOptions?.gateway) ? providerOptions.gateway : {}

      return {
        ...params,
        providerOptions: {
          ...providerOptions,
          gateway: {
            ...gateway,
            // Intentionally overwrite any user-provided `caching` value: this feature
            // exists to enable prompt caching for the gateway when the user turns it
            // on in provider settings. Per-request disabling is not supported.
            caching: 'auto',
            // Anthropic reads a lifetime hint only from the Messages surface, which the
            // gateway's language-model route does not expose.
            ...(ttl === '1h' && !gateway.cache_ttl ? { cache_ttl: ttl } : {})
          }
        }
      }
    }
  }
}

function createGatewayUsageNormalizePlugin() {
  return definePlugin({
    name: 'gateway-usage-normalize',
    // Shape adapters belong directly against the provider. `post` makes this middleware
    // innermost, so it unwinds before the normal-phase usage-capture middleware: the
    // persisted usage record and the application both observe the normalized shape with
    // the raw Anthropic cache buckets already reconciled. Reconciliation anywhere later
    // in the chain would leave the captured record without the cache-write bucket.
    enforce: 'post',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(gatewayUsageNormalizeMiddleware)
    }
  })
}

/**
 * The gateway discards the `anthropic` provider options that `anthropicCacheFeature` writes
 * onto prompt parts; enabling its own caching is the only way those breakpoints survive.
 */
function createGatewayAnthropicCachePlugin(provider: Provider) {
  return definePlugin({
    name: 'gateway-anthropic-cache',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(gatewayAnthropicCacheMiddleware(provider))
    }
  })
}

export const gatewayUsageNormalizeFeature: RequestFeature = {
  name: 'gateway-usage-normalize',
  // Flat usage can surface on any provider path; `isFlatV3Usage` is the gate.
  applies: () => true,
  contributeModelAdapters: () => [createGatewayUsageNormalizePlugin()]
}

export const gatewayAnthropicCacheFeature: RequestFeature = {
  name: 'gateway-anthropic-cache',
  applies: (scope) => usesGatewayAutoCaching(scope.provider) && resolveAnthropicCacheSettings(scope.provider).enabled,
  contributeModelAdapters: (scope) => [createGatewayAnthropicCachePlugin(scope.provider)]
}
