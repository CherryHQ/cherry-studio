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
 * `AiStreamManager` raises this on the otherwise-successful stream path so the failure
 * is broadcast as an error instead of a silent success. `serializeError` preserves the
 * `finishReason` field, and the renderer's `errorClassifier` maps it to a diagnosis
 * message. See #16072.
 *
 * Note: only the normalized `finishReason` is available at this layer — the raw provider
 * reason is dropped by AI SDK's `toUIMessageStream` before it reaches the stream manager.
 */
export class FinishReasonError extends AISDKError {
  // @ts-ignore used in isInstance
  private readonly [symbol] = true

  /** Normalized AI SDK finish reason, e.g. 'content-filter' | 'length' | 'error' | 'other'. */
  readonly finishReason: FinishReason

  constructor(finishReason: FinishReason) {
    super({ name, message: `Response ended with finish reason "${finishReason}"` })
    this.finishReason = finishReason
  }

  static isInstance(error: unknown): error is FinishReasonError {
    return AISDKError.hasMarker(error, marker)
  }
}
