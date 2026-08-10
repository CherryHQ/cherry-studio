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

import type { RequestFeature } from '../feature'
import { usesOpenAICompatibleWire } from '../nativeFileSupport'

interface MediaWireOptions {
  /** DashScope documents `input_audio.data` as a URL or Base64 Data URL; the
   *  OpenAI spec (and vLLM) want bare base64. */
  readonly audioAsDataUrl: boolean
}

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
function rewriteMediaPart(
  part: LanguageModelV3FilePart,
  options: MediaWireOptions
): LanguageModelV3TextPart | undefined {
  if (part.mediaType.startsWith('video/')) {
    const url = part.data instanceof URL ? part.data.toString() : `data:${part.mediaType};base64,${toBase64(part.data)}`
    return overriddenTextPart({ type: 'video_url', video_url: { url } })
  }
  if (part.mediaType.startsWith('audio/')) {
    // No bytes to inline — `input_audio` has no URL form, so leave it alone.
    if (part.data instanceof URL) return undefined
    const base64 = toBase64(part.data)
    return overriddenTextPart({
      type: 'input_audio',
      input_audio: {
        data: options.audioAsDataUrl ? `data:${part.mediaType};base64,${base64}` : base64,
        format: audioFormat(part.mediaType)
      }
    })
  }
  return undefined
}

export function createOpenAICompatibleMediaMiddleware(options: MediaWireOptions): LanguageModelMiddleware {
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
          const rewritten = rewriteMediaPart(part, options)
          if (!rewritten) return part
          touched = true
          return rewritten
        })
        if (!touched) return message
        changed = true
        // A lone text part is collapsed into a plain string message by the
        // converter, which would drop the metadata carrying the media object.
        if (content.length === 1) content.unshift({ type: 'text', text: '' })
        return { ...message, content }
      })
      return changed ? { ...params, prompt } : params
    }
  }
}

const createOpenAICompatibleMediaPlugin = (options: MediaWireOptions) =>
  definePlugin({
    name: 'openai-compatible-media',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(createOpenAICompatibleMediaMiddleware(options))
    }
  })

/** Send audio/video as `input_audio` / `video_url` on the openai-compatible wire. */
export const openaiCompatibleMediaFeature: RequestFeature = {
  name: 'openai-compatible-media',
  applies: (scope) => usesOpenAICompatibleWire(scope.sdkConfig.providerId, scope.endpointType),
  contributeModelAdapters: (scope) => [
    createOpenAICompatibleMediaPlugin({ audioAsDataUrl: scope.sdkConfig.providerId === 'dashscope' })
  ]
}
