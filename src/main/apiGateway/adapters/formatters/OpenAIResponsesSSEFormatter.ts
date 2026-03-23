/**
 * OpenAI Responses API SSE Formatter
 *
 * Formats OpenAI Responses API stream events for Server-Sent Events.
 * Responses API uses named events with semantic types:
 * - event: {type}\n
 * - data: {json}\n\n
 *
 * @see https://platform.openai.com/docs/api-reference/responses-streaming
 */

import type OpenAI from '@cherrystudio/openai'

import type { ISSEFormatter } from '../interfaces'

/**
 * Use SDK type for ResponseStreamEvent
 */
type ResponseStreamEvent = OpenAI.Responses.ResponseStreamEvent

/**
 * OpenAI Responses API SSE Formatter
 *
 * Unlike Chat Completions API which uses only `data:` lines,
 * Responses API uses named events with `event:` and `data:` lines.
 */
export class OpenAIResponsesSSEFormatter implements ISSEFormatter<ResponseStreamEvent> {
  /**
   * Format a Responses API event for SSE streaming
   *
   * @example
   * event: response.created
   * data: {"type":"response.created","response":{...}}
   *
   * event: response.output_text.delta
   * data: {"type":"response.output_text.delta","delta":"Hello"}
   */
  formatEvent(event: ResponseStreamEvent): string {
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  }

  /**
   * Format the stream termination marker
   */
  formatDone(): string {
    return 'data: [DONE]\n\n'
  }
}

export default OpenAIResponsesSSEFormatter
