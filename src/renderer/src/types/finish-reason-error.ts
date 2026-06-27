import { AISDKError, type FinishReason } from 'ai'

const name = 'AI_FinishReasonError'
const marker = `vercel.ai.error.${name}`
const symbol = Symbol.for(marker)

/**
 * Raised when a streamed response ends with a finish reason that is not a clean
 * completion. Clean completions are 'stop' (model finished) and 'tool-calls'
 * (model is calling tools); anything else — content moderation, a provider-reported
 * error, max-length truncation, or an otherwise unmapped reason — means the response
 * was cut short.
 *
 * `AiSdkToChunkAdapter` surfaces this as an error chunk so the UI can tell the user
 * why the response stopped instead of silently presenting it as a success. The
 * `finishReason` field is preserved by `serializeError` and rendered by
 * `ErrorDetailModal`; `errorClassifier` maps it to a diagnosis message. See #16072.
 */
export class FinishReasonError extends AISDKError {
  // @ts-ignore used in isInstance
  private readonly [symbol] = true

  /** Normalized AI SDK finish reason, e.g. 'content-filter' | 'length' | 'error' | 'other'. */
  readonly finishReason: FinishReason

  /** Raw provider finish reason when available, e.g. 'content_filter' | 'refusal'. */
  readonly rawFinishReason?: string

  constructor(finishReason: FinishReason, rawFinishReason?: string) {
    super({
      name,
      message: `Response ended with finish reason "${rawFinishReason ?? finishReason}"`
    })
    this.finishReason = finishReason
    this.rawFinishReason = rawFinishReason
  }

  static isInstance(error: unknown): error is FinishReasonError {
    return AISDKError.hasMarker(error, marker)
  }
}
