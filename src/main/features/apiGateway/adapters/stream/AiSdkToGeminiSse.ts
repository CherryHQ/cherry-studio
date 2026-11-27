/**
 * AI SDK to Gemini SSE Adapter
 *
 * Converts the AI SDK UI-message stream to Google Generative Language
 * (`generateContent`) responses. Unlike the Anthropic/OpenAI adapters there is
 * no block-open/close ceremony: each Gemini stream frame is a self-contained
 * partial `GenerateContentResponse` carrying the incremental `parts`, and the
 * client concatenates them. Parts are also accumulated so the non-streaming path
 * can return one complete response.
 *
 * @see https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent
 */

import type { FinishReason, ProviderMetadata, UIMessageChunk } from 'ai'
import * as z from 'zod'

import { loggerService } from '@logger'
import { parseDataUrl } from '@shared/utils/dataUrl'

import type { GatewayUsageMetadata, StreamAdapterOptions } from '../interfaces'
import { BaseStreamAdapter } from './BaseStreamAdapter'

const logger = loggerService.withContext('AiSdkToGeminiSse')

const safetyRatingSchema = z.object({
  category: z.string().nullish(),
  probability: z.string().nullish(),
  probabilityScore: z.number().nullish(),
  severity: z.string().nullish(),
  severityScore: z.number().nullish(),
  blocked: z.boolean().nullish()
})
const finishMetadataSchema = z.object({
  promptFeedback: z
    .object({ blockReason: z.string().nullish(), safetyRatings: z.array(safetyRatingSchema).nullish() })
    .nullish(),
  safetyRatings: z.array(safetyRatingSchema).nullish(),
  finishMessage: z.string().nullish(),
  continuationToken: z.string().nullish(),
  serviceTier: z.string().nullish()
})

/** A response `part` (subset of Gemini's Part used by the gateway). */
interface GeminiResponsePart {
  text?: string
  thought?: boolean
  /** Gemini 3 opaque reasoning signature the client must echo back next turn. */
  thoughtSignature?: string
  functionCall?: { name: string; args: unknown }
  inlineData?: { mimeType: string; data: string }
}

interface GeminiResponseContent {
  role: 'model'
  parts: GeminiResponsePart[]
}

interface GeminiUsageMetadata {
  promptTokenCount: number
  candidatesTokenCount: number
  totalTokenCount: number
  thoughtsTokenCount?: number
  cachedContentTokenCount?: number
  serviceTier?: string
}

interface GeminiCandidate {
  content: GeminiResponseContent
  finishReason?: string
  finishMessage?: string
  continuationToken?: string
  safetyRatings?: z.infer<typeof finishMetadataSchema>['safetyRatings']
  index: number
}

/** A single streamed frame / the complete non-streaming response. */
export interface GeminiGenerateContentResponse {
  candidates: GeminiCandidate[]
  usageMetadata?: GeminiUsageMetadata
  modelVersion?: string
  responseId?: string
  promptFeedback?: z.infer<typeof finishMetadataSchema>['promptFeedback']
}

/** Map an AI SDK finish reason to the Gemini `FinishReason` enum. */
function toGeminiFinishReason(reason: FinishReason | undefined): string {
  switch (reason) {
    case 'length':
      return 'MAX_TOKENS'
    case 'content-filter':
      return 'SAFETY'
    // Gemini reports STOP even when the turn ends on a function call.
    case 'stop':
    case 'tool-calls':
      return 'STOP'
    // An unrecognised/abnormal upstream termination must not be reported as a normal STOP (#24438).
    case 'other':
      return 'OTHER'
    default:
      return 'STOP'
  }
}

export class AiSdkToGeminiSse extends BaseStreamAdapter<GeminiGenerateContentResponse> {
  /** Accumulated parts, in emission order, for the non-streaming response. */
  private accumulatedParts: GeminiResponsePart[] = []
  private thoughtsTokens = 0
  private finishReason = 'STOP'
  private rawFinishReason?: string
  private finishMetadata: z.infer<typeof finishMetadataSchema> = {}

  constructor(options: StreamAdapterOptions) {
    super(options)
  }

  /** Gemini has no `message_start` frame; only mark the lazy-start flag. */
  protected emitMessageStart(): void {
    this.state.hasEmittedMessageStart = true
  }

  protected processChunk(chunk: UIMessageChunk): void {
    logger.silly('AiSdkToGeminiSse - Processing chunk', { type: chunk.type })
    switch (chunk.type) {
      case 'text-delta':
        this.appendText(chunk.delta || '', false, chunk.providerMetadata)
        break

      case 'reasoning-delta':
        this.appendText(chunk.delta || '', true, chunk.providerMetadata)
        break

      case 'tool-input-error':
      case 'tool-input-available': {
        // Gemini 3 requires the model's thought signature echoed back on the next
        // function-calling turn; the Google provider surfaces it on the tool call's
        // provider metadata, so carry it out on the emitted functionCall part.
        const signature = (chunk.providerMetadata?.google ?? chunk.providerMetadata?.vertex)?.thoughtSignature
        const thoughtSignature = typeof signature === 'string' ? signature : undefined
        this.appendFunctionCall(chunk.toolName, chunk.input, thoughtSignature)
        break
      }

      case 'file': {
        const data = parseDataUrl(chunk.url)
        if (!data?.isBase64) throw new Error('Generated Gemini file must contain base64 data')
        const signature = (chunk.providerMetadata?.google ?? chunk.providerMetadata?.vertex)?.thoughtSignature
        const part: GeminiResponsePart = {
          inlineData: { mimeType: chunk.mediaType, data: data.data },
          ...(typeof signature === 'string' && { thoughtSignature: signature })
        }
        this.accumulatedParts.push(part)
        this.emitParts([part])
        break
      }

      case 'finish':
        this.finishReason = toGeminiFinishReason(chunk.finishReason)
        this.applyUsageMetadata(chunk.messageMetadata as GatewayUsageMetadata | undefined)
        break

      case 'message-metadata':
        this.applyUsageMetadata(chunk.messageMetadata as GatewayUsageMetadata | undefined)
        break

      case 'error':
        throw new Error(chunk.errorText)

      default:
        // start / start-step / finish-step / text-start|end / reasoning-start|end /
        // tool-input-start|delta / tool-output-available / source / abort —
        // no Gemini response equivalent, ignore safely.
        break
    }
  }

  /** Accumulate a text/thought delta (merged into the trailing like-kind part) and stream it. */
  private appendText(text: string, thought: boolean, metadata?: ProviderMetadata): void {
    const signature = (metadata?.google ?? metadata?.vertex)?.thoughtSignature
    const thoughtSignature = typeof signature === 'string' ? signature : undefined
    if (!text && thoughtSignature === undefined) return
    const part: GeminiResponsePart = {
      text,
      ...(thought && { thought: true }),
      ...(thoughtSignature !== undefined && { thoughtSignature })
    }
    const last = this.accumulatedParts[this.accumulatedParts.length - 1]
    if (last && last.text !== undefined && (last.thought ?? false) === thought) {
      last.text = (last.text ?? '') + text
      if (thoughtSignature !== undefined) last.thoughtSignature = thoughtSignature
    } else {
      this.accumulatedParts.push({ ...part })
    }
    this.emitParts([part])
  }

  private appendFunctionCall(name: string, args: unknown, thoughtSignature?: string): void {
    const part: GeminiResponsePart = { functionCall: { name, args: args ?? {} } }
    if (thoughtSignature) part.thoughtSignature = thoughtSignature
    this.accumulatedParts.push(part)
    this.emitParts([part])
  }

  /** Emit one streaming frame carrying the given delta parts. */
  private emitParts(parts: GeminiResponsePart[]): void {
    this.emit({
      candidates: [{ content: { role: 'model', parts }, index: 0 }]
    })
  }

  /** Track cumulative usage from the `message-metadata` projection. */
  private applyUsageMetadata(metadata: GatewayUsageMetadata | undefined): void {
    if (!metadata) return
    const native = metadata.providerMetadata?.google ?? metadata.providerMetadata?.vertex
    if (native) {
      const parsed = finishMetadataSchema.safeParse(native)
      if (parsed.success) this.finishMetadata = parsed.data
      if (metadata.rawFinishReason) this.rawFinishReason = metadata.rawFinishReason
    }
    if (metadata.stats?.inputTokens !== undefined) this.state.inputTokens = metadata.stats.inputTokens
    if (metadata.stats?.outputTokens !== undefined) this.state.outputTokens = metadata.stats.outputTokens
    if (metadata.stats?.inputTokenDetails?.cacheReadTokens !== undefined) {
      this.state.cacheReadTokens = metadata.stats.inputTokenDetails.cacheReadTokens
    }
    const reasoningTokens = metadata.stats?.outputTokenDetails?.reasoningTokens
    if (reasoningTokens !== undefined) this.thoughtsTokens = reasoningTokens
  }

  private buildUsageMetadata(): GeminiUsageMetadata {
    // AI SDK's `outputTokens` counts all generated tokens including reasoning —
    // the breakdown lives in `outputTokenDetails` (every major provider maps
    // total = text + reasoning). Gemini reports candidates separately from
    // thoughts (total = prompt + candidates + thoughts), so emitting the
    // reasoning-inclusive total as candidatesTokenCount would double-count
    // thoughts inside the frame.
    const candidatesTokenCount = Math.max(0, this.state.outputTokens - this.thoughtsTokens)
    const usage: GeminiUsageMetadata = {
      promptTokenCount: this.state.inputTokens,
      candidatesTokenCount,
      totalTokenCount: this.state.inputTokens + this.state.outputTokens
    }
    if (this.thoughtsTokens > 0) usage.thoughtsTokenCount = this.thoughtsTokens
    // The projected `inputTokens` is Gemini's cache-inclusive prompt total
    // (`promptTokenCount`), so cache reads are a subset of it — report them on
    // their own field without touching the sum, mirroring the thoughtsTokenCount
    // convention of staying absent when zero.
    if (this.state.cacheReadTokens !== undefined && this.state.cacheReadTokens > 0) {
      usage.cachedContentTokenCount = this.state.cacheReadTokens
    }
    if (this.finishMetadata.serviceTier != null) usage.serviceTier = this.finishMetadata.serviceTier
    return usage
  }

  /** Emit the terminal frame carrying the native outcome and cumulative usage. */
  protected finalize(): void {
    this.emit(this.buildResponse([]))
  }

  buildNonStreamingResponse(): GeminiGenerateContentResponse {
    return this.buildResponse(this.accumulatedParts)
  }

  private buildResponse(parts: GeminiResponsePart[]): GeminiGenerateContentResponse {
    const { finishMessage, continuationToken, safetyRatings, promptFeedback } = this.finishMetadata
    return {
      candidates: [
        {
          content: { role: 'model', parts },
          finishReason: this.rawFinishReason ?? this.finishReason,
          index: 0,
          ...(finishMessage != null && { finishMessage }),
          ...(continuationToken != null && { continuationToken }),
          ...(safetyRatings != null && { safetyRatings })
        }
      ],
      usageMetadata: this.buildUsageMetadata(),
      modelVersion: this.state.model,
      responseId: this.state.messageId,
      ...(promptFeedback != null && { promptFeedback })
    }
  }
}

export default AiSdkToGeminiSse
