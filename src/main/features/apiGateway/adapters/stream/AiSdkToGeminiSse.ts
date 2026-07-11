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

import { loggerService } from '@logger'
import type { FinishReason, UIMessageChunk } from 'ai'

import type { GatewayUsageMetadata, StreamAdapterOptions } from '../interfaces'
import { BaseStreamAdapter } from './BaseStreamAdapter'

const logger = loggerService.withContext('AiSdkToGeminiSse')

/** A response `part` (subset of Gemini's Part used by the gateway). */
interface GeminiResponsePart {
  text?: string
  thought?: boolean
  functionCall?: { name: string; args: unknown }
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
}

interface GeminiCandidate {
  content: GeminiResponseContent
  finishReason?: string
  index: number
}

/** A single streamed frame / the complete non-streaming response. */
export interface GeminiGenerateContentResponse {
  candidates: GeminiCandidate[]
  usageMetadata?: GeminiUsageMetadata
  modelVersion?: string
  responseId?: string
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
    default:
      return 'STOP'
  }
}

export class AiSdkToGeminiSse extends BaseStreamAdapter<GeminiGenerateContentResponse> {
  /** Accumulated parts, in emission order, for the non-streaming response. */
  private accumulatedParts: GeminiResponsePart[] = []
  private thoughtsTokens = 0
  private finishReason = 'STOP'

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
        this.appendText(chunk.delta || '', false)
        break

      case 'reasoning-delta':
        this.appendText(chunk.delta || '', true)
        break

      case 'tool-input-available':
        this.appendFunctionCall(chunk.toolName, chunk.input)
        break

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
        // tool-input-start|delta / tool-output-available / source / file / abort —
        // no Gemini response equivalent, ignore safely.
        break
    }
  }

  /** Accumulate a text/thought delta (merged into the trailing like-kind part) and stream it. */
  private appendText(text: string, thought: boolean): void {
    if (!text) return
    const last = this.accumulatedParts[this.accumulatedParts.length - 1]
    if (last && last.functionCall === undefined && (last.thought ?? false) === thought) {
      last.text = (last.text ?? '') + text
    } else {
      this.accumulatedParts.push(thought ? { text, thought: true } : { text })
    }
    this.emitParts([thought ? { text, thought: true } : { text }])
  }

  private appendFunctionCall(name: string, args: unknown): void {
    const part: GeminiResponsePart = { functionCall: { name, args: args ?? {} } }
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
    if (metadata.promptTokens !== undefined) this.state.inputTokens = metadata.promptTokens
    if (metadata.completionTokens !== undefined) this.state.outputTokens = metadata.completionTokens
    if (metadata.thoughtsTokens !== undefined) this.thoughtsTokens = metadata.thoughtsTokens
  }

  private buildUsageMetadata(): GeminiUsageMetadata {
    const usage: GeminiUsageMetadata = {
      promptTokenCount: this.state.inputTokens,
      candidatesTokenCount: this.state.outputTokens,
      totalTokenCount: this.state.inputTokens + this.state.outputTokens
    }
    if (this.thoughtsTokens > 0) usage.thoughtsTokenCount = this.thoughtsTokens
    return usage
  }

  /** Emit the terminal frame carrying `finishReason` + `usageMetadata`. */
  protected finalize(): void {
    this.emit({
      candidates: [{ content: { role: 'model', parts: [] }, finishReason: this.finishReason, index: 0 }],
      usageMetadata: this.buildUsageMetadata(),
      modelVersion: this.state.model
    })
  }

  buildNonStreamingResponse(): GeminiGenerateContentResponse {
    return {
      candidates: [
        {
          content: { role: 'model', parts: this.accumulatedParts },
          finishReason: this.finishReason,
          index: 0
        }
      ],
      usageMetadata: this.buildUsageMetadata(),
      modelVersion: this.state.model
    }
  }
}

export default AiSdkToGeminiSse
