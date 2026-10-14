/**
 * Gemini SSE Formatter
 *
 * Formats Google Generative Language stream frames for Server-Sent Events
 * (`streamGenerateContent?alt=sse`): each frame is `data: {json}\n\n`.
 *
 * @see https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent
 */

import type { ISseFormatter } from '../interfaces'
import type { GeminiGenerateContentResponse } from '../stream/AiSdkToGeminiSse'

export class GeminiSseFormatter implements ISseFormatter<GeminiGenerateContentResponse> {
  formatEvent(event: GeminiGenerateContentResponse): string {
    return `data: ${JSON.stringify(event)}\n\n`
  }

  /**
   * Gemini SSE streams have no `[DONE]` sentinel: they end with the final
   * `finishReason`-bearing frame followed by the server closing the connection.
   */
  formatDone(): string {
    return ''
  }
}

export default GeminiSseFormatter
