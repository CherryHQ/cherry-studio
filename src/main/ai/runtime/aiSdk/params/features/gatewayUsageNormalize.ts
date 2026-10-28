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
  const cacheRead = toCount(raw.cache_read_input_tokens)
  const cacheWrite = toCount(raw.cache_creation_input_tokens)
  if (cacheRead === undefined && cacheWrite === undefined) return usage

  const inputTokens = isFlatV3Usage(usage) ? normalizeFlatV3Usage(usage).inputTokens : usage.inputTokens
  return { ...usage, inputTokens: { ...inputTokens, cacheRead, cacheWrite } }
}

const gatewayUsageNormalizeMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate()
    return isFlatV3Usage(result.usage) ? { ...result, usage: normalizeFlatV3Usage(result.usage) } : result
  },
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream()
    const normalized = stream.pipeThrough(
      new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
        transform(chunk, controller) {
          if (chunk.type === 'finish' && isFlatV3Usage(chunk.usage)) {
            controller.enqueue({ ...chunk, usage: normalizeFlatV3Usage(chunk.usage) })
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
    },
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      return { ...result, usage: withRawAnthropicCacheUsage(result.usage) }
    },
    wrapStream: async ({ doStream }) => {
      const { stream, ...rest } = await doStream()
      const normalized = stream.pipeThrough(
        new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
          transform(chunk, controller) {
            if (chunk.type === 'finish') {
              controller.enqueue({ ...chunk, usage: withRawAnthropicCacheUsage(chunk.usage) })
              return
            }
            controller.enqueue(chunk)
          }
        })
      )
      return { stream: normalized, ...rest }
    }
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
