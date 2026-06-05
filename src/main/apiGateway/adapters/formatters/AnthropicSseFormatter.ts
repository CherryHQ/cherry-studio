/**
 * Anthropic SSE Formatter
 *
 * Formats Anthropic message stream events for Server-Sent Events.
 */

import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages'

import type { ISseFormatter } from '../interfaces'

/**
 * Anthropic SSE Formatter
 *
 * Formats events according to Anthropic's streaming API specification:
 * - event: {type}\n
 * - data: {json}\n\n
 *
 * @see https://docs.anthropic.com/en/api/messages-streaming
 */
export class AnthropicSseFormatter implements ISseFormatter<RawMessageStreamEvent> {
  /**
   * Format an Anthropic event for SSE streaming
   */
  formatEvent(event: RawMessageStreamEvent): string {
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  }

  /**
   * Format the stream termination marker
   */
  formatDone(): string {
    return 'data: [DONE]\n\n'
  }
}

export default AnthropicSseFormatter
