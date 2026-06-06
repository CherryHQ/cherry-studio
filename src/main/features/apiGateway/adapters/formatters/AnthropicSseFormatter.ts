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
   * Format the stream termination marker.
   *
   * Anthropic streams have no `[DONE]` sentinel: they end with the `message_stop`
   * event (emitted by the adapter's finalize step) followed by the server closing
   * the connection. Emitting OpenAI's `data: [DONE]` here would append an invalid
   * frame that strict Anthropic SDK clients fail to parse, so return nothing.
   */
  formatDone(): string {
    return ''
  }
}

export default AnthropicSseFormatter
