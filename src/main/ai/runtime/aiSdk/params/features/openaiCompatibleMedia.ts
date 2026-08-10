/**
 * Audio/video user input on the OpenAI-compatible wire.
 *
 * `@ai-sdk/openai-compatible`'s converter emits `input_audio` for wav/mp3 only
 * and throws `UnsupportedFunctionalityError` on every other audio type and on
 * every video part — so ogg/flac/aac kill the whole request and video never
 * reaches the model. The vendors on this wire (Kimi, Qwen, MiniMax, doubao,
 * vLLM …) all accept `video_url` plus a wider `input_audio.format`.
 *
 * The converter spreads a part's `providerOptions.openaiCompatible` over the
 * content object it emits, last — so rewriting a media file part into a text
 * part whose metadata carries the vendor shape fully overrides that base, and
 * the converter never sees a media type it rejects. `text: undefined` is
 * dropped by `JSON.stringify`, leaving exactly `{type:'video_url', video_url:…}`
 * on the wire. Same trick as `skipGeminiThoughtSignature`.
 */

import type { JSONValue, LanguageModelV3FilePart, LanguageModelV3TextPart } from '@ai-sdk/provider'
import { convertToBase64 } from '@ai-sdk/provider-utils'
import { definePlugin } from '@cherrystudio/ai-core'
import { parseDataUrl } from '@shared/utils/dataUrl'
import type { LanguageModelMiddleware } from 'ai'

import { resolveGatewayRoute } from '../../../../provider/gatewayRouting'
import type { RequestFeature } from '../feature'
import { usesOpenAICompatibleWire } from '../nativeFileSupport'

/**
 * The one value that has to escape its type: `undefined` deletes the converter's
 * base `text` field from the body (`JSON.stringify` drops it), and `undefined` is
 * outside `JSONValue` by definition. It never reaches the wire — that is the point.
 */
const DELETED = undefined as unknown as JSONValue

/** Emit a text part the converter will rewrite into `metadata` verbatim. */
function overriddenTextPart(metadata: Record<string, JSONValue>): LanguageModelV3TextPart {
  return {
    type: 'text',
    text: '',
    providerOptions: { openaiCompatible: { text: DELETED, ...metadata } }
  }
}

/**
 * Bare base64 for the wire. AI SDK splits a `data:` URL into `{data, mediaType}`
 * before the prompt reaches a middleware, but tolerate one that slipped through
 * rather than emitting a doubly-prefixed URL.
 */
function toBase64(data: string | Uint8Array): string {
  if (typeof data === 'string') {
    const parsed = parseDataUrl(data)
    if (parsed?.isBase64) return parsed.data
  }
  return convertToBase64(data)
}

/** `audio/mpeg` → `mp3`, `audio/x-wav` → `wav`, else the bare subtype. */
function audioFormat(mediaType: string): string {
  const subtype = mediaType.slice('audio/'.length).replace(/^x-/, '').toLowerCase()
  return subtype === 'mpeg' ? 'mp3' : subtype
}

/** Rewrite one media file part, or `undefined` to leave it to the converter. */
function rewriteMediaPart(part: LanguageModelV3FilePart): LanguageModelV3TextPart | undefined {
  if (part.mediaType.startsWith('video/')) {
    const url = part.data instanceof URL ? part.data.toString() : `data:${part.mediaType};base64,${toBase64(part.data)}`
    return overriddenTextPart({ type: 'video_url', video_url: { url } })
  }
  if (part.mediaType.startsWith('audio/')) {
    // `input_audio` carries bytes only. A URL-backed part is left to the converter,
    // which rejects it — unreachable today, since routing inlines or drops first.
    if (part.data instanceof URL) return undefined
    // Bare base64, per the OpenAI spec. DashScope's docs show a `data:;base64,…`
    // data URL instead; that divergence is untested, so it is not special-cased.
    return overriddenTextPart({
      type: 'input_audio',
      input_audio: { data: toBase64(part.data), format: audioFormat(part.mediaType) }
    })
  }
  return undefined
}

export function createOpenAICompatibleMediaMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    transformParams: async ({ params }) => {
      if (!Array.isArray(params.prompt)) return params
      let changed = false
      const prompt = params.prompt.map((message) => {
        // Media file parts only ever reach the provider on user messages.
        if (message.role !== 'user') return message
        let touched = false
        const content = message.content.map((part) => {
          if (part.type !== 'file') return part
          const rewritten = rewriteMediaPart(part)
          if (!rewritten) return part
          touched = true
          return rewritten
        })
        if (!touched) return message
        changed = true
        // A lone text part is collapsed into a plain string message by the
        // converter, which would drop the metadata carrying the media object.
        // A space rather than '': some vendors reject empty text content parts.
        if (content.length === 1) content.unshift({ type: 'text', text: ' ' })
        return { ...message, content }
      })
      return changed ? { ...params, prompt } : params
    }
  }
}

const createOpenAICompatibleMediaPlugin = () =>
  definePlugin({
    name: 'openai-compatible-media',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createOpenAICompatibleMediaMiddleware())
    }
  })

/**
 * Rewriting is destructive — a converter that ignores `providerOptions.openaiCompatible`
 * would forward an empty text part and silently lose the file. So the model class has to
 * be certain, not merely likely: multi-backend gateways (AiHubMix, DMXAPI) dispatch it by
 * model id, which the resolved `endpointType` only reflects when the model row pins no
 * endpoint of its own.
 */
function servedByOpenAICompatibleModel(scope: Parameters<NonNullable<RequestFeature['applies']>>[0]): boolean {
  const route = resolveGatewayRoute(scope.provider, scope.model)
  if (route && route.endpointType !== scope.endpointType) return false
  return usesOpenAICompatibleWire(scope.sdkConfig.providerId, scope.endpointType)
}

/** Send audio/video as `input_audio` / `video_url` on the openai-compatible wire. */
export const openaiCompatibleMediaFeature: RequestFeature = {
  name: 'openai-compatible-media',
  applies: servedByOpenAICompatibleModel,
  contributeModelAdapters: () => [createOpenAICompatibleMediaPlugin()]
}
