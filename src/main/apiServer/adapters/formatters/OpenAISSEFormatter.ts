/**
 * OpenAI Compatible SSE Formatter
 *
 * Formats OpenAI-compatible chat completion stream events for Server-Sent Events.
 * Supports extended features like reasoning_content used by DeepSeek and other providers.
 */

import type { ISSEFormatter } from '../interfaces'
import type { OpenAICompatibleChunk } from '../stream/AiSdkToOpenAISSE'

/**
 * Re-export the OpenAI-compatible chunk type for convenience
 */
export type { OpenAICompatibleChunk as ChatCompletionChunk } from '../stream/AiSdkToOpenAISSE'

/**
 * OpenAI Compatible SSE Formatter
 *
 * Formats events according to OpenAI's streaming API specification:
 * - data: {json}\n\n
 *
 * Supports extended fields like reasoning_content for OpenAI-compatible providers.
 *
 * @see https://platform.openai.com/docs/api-reference/chat/streaming
 */
export class OpenAISSEFormatter implements ISSEFormatter<OpenAICompatibleChunk> {
  /**
   * Format an OpenAI-compatible event for SSE streaming
   */
  formatEvent(event: OpenAICompatibleChunk): string {
    return `data: ${JSON.stringify(event)}\n\n`
  }

  /**
   * Format the stream termination marker
   */
  formatDone(): string {
    return 'data: [DONE]\n\n'
  }
}

export default OpenAISSEFormatter
