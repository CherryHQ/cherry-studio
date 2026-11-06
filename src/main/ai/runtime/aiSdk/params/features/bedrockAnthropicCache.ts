/**
 * Bedrock prompt caching for Claude.
 *
 * `@ai-sdk/amazon-bedrock` ignores the `anthropic` cache markers that `anthropicCacheFeature` writes
 * and only reads `providerOptions.bedrock.cachePoint` on whole messages, so each marker is moved
 * onto the message that holds it.
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
 */

import type { LanguageModelV3CallOptions, LanguageModelV3Message } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { stripBedrockDottedVendorPrefix, VENDOR_PATTERNS } from '@cherrystudio/provider-registry'
import { resolveAnthropicCacheSettings } from '@shared/ai/anthropicCache'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import { getLowerBaseModelName, getRawModelId } from '@shared/utils/model'

import type { RequestFeature } from '../feature'

type CacheMarker = { ttl?: string }

function getAnthropicMarker(holder: unknown): CacheMarker | undefined {
  const anthropic = (holder as { providerOptions?: { anthropic?: Record<string, unknown> } } | undefined)
    ?.providerOptions?.anthropic
  return (anthropic?.cacheControl ?? anthropic?.cache_control) as CacheMarker | undefined
}

// Reads the same holders `clampCacheMarkers` counts, so its four-breakpoint budget carries over.
function collectMessageMarkers(message: LanguageModelV3Message): CacheMarker[] {
  const markers: CacheMarker[] = []
  const add = (holder: unknown): boolean => {
    const marker = getAnthropicMarker(holder)
    if (marker) markers.push(marker)
    return marker !== undefined
  }
  if (typeof message.content === 'string') {
    add(message)
    return markers
  }
  message.content.forEach((part, j) => {
    if (part.type === 'tool-approval-response' || add(part)) return
    if (message.role === 'tool' && part.type === 'tool-result') {
      if ('providerOptions' in part.output) {
        if (add(part.output)) return
      } else if (part.output.type === 'content') {
        const item = part.output.value.find((value) => value.providerOptions != null)
        if (item && add(item)) return
      }
    }
    if (j === message.content.length - 1) add(message)
  })
  return markers
}

export function transformBedrockCacheParams(params: LanguageModelV3CallOptions): LanguageModelV3CallOptions {
  if (!Array.isArray(params.prompt)) return params
  let changed = false
  const prompt = params.prompt.map((message) => {
    const markers = collectMessageMarkers(message)
    if (markers.length === 0) return message
    changed = true
    // Longer lifetimes must precede shorter ones, so a message holding both keeps the 5m lifetime.
    const cachePoint = markers.every((marker) => marker.ttl === '1h')
      ? { type: 'default', ttl: '1h' }
      : { type: 'default' }
    return {
      ...message,
      providerOptions: {
        ...message.providerOptions,
        bedrock: { ...message.providerOptions?.bedrock, cachePoint }
      }
    }
  })
  return changed ? { ...params, prompt } : params
}

/** Claude only: Bedrock rejects cache checkpoints on models without prompt caching (e.g. Llama, Mistral). */
export function isBedrockClaudeModel(model: Model): boolean {
  return VENDOR_PATTERNS.anthropic.test(stripBedrockDottedVendorPrefix(getLowerBaseModelName(getRawModelId(model))))
}

const bedrockAnthropicCacheMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  transformParams: async ({ params }) => transformBedrockCacheParams(params)
}

function createBedrockAnthropicCachePlugin() {
  return definePlugin({
    name: 'bedrock-anthropic-cache',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(bedrockAnthropicCacheMiddleware)
    }
  })
}

export const bedrockAnthropicCacheFeature: RequestFeature = {
  name: 'bedrock-anthropic-cache',
  applies: (scope) =>
    scope.aiSdkProviderId === 'bedrock' &&
    scope.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES &&
    resolveAnthropicCacheSettings(scope.provider).enabled &&
    isBedrockClaudeModel(scope.model),
  contributeModelAdapters: () => [createBedrockAnthropicCachePlugin()]
}
