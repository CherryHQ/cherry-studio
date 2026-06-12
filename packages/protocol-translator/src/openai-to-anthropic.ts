/**
 * OpenAI Chat Completions API → Anthropic Messages API translation.
 *
 * Converts OpenAI-format responses (streaming and non-streaming) back to
 * Anthropic-compatible format. Used for the response path in protocol
 * translation — when an Agent expects Anthropic SSE events but the upstream
 * model speaks OpenAI.
 */

import type {
  AnthropicContentBlock,
  AnthropicTextBlock,
  AnthropicToolUseBlock,
  OpenAIContentPart,
  OpenAIMessage,
  OpenAITextContent,
  OpenAIToolCall,
  TranslationContext
} from './types'

// ── Response Conversion (Non-Streaming) ────────────────────────────────────

/** Simplified Anthropic message response */
export interface AnthropicResponse {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: AnthropicContentBlock[]
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

/**
 * Convert an OpenAI chat completion choice to Anthropic content blocks.
 */
export function openAIChoiceToContent(
  message: OpenAIMessage,
  context?: TranslationContext
): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = []

  // Text content
  if (message.content) {
    if (typeof message.content === 'string') {
      blocks.push({ type: 'text', text: message.content } as AnthropicTextBlock)
    } else if (Array.isArray(message.content)) {
      for (const part of message.content as OpenAIContentPart[]) {
        if (part.type === 'text') {
          blocks.push({ type: 'text', text: (part as OpenAITextContent).text })
        }
      }
    }
  }

  // Tool calls → Anthropic tool_use blocks
  if (message.tool_calls) {
    for (const tc of message.tool_calls) {
      blocks.push(convertOpenAIToolCallToAnthropic(tc, context))
    }
  }

  return blocks
}

function convertOpenAIToolCallToAnthropic(
  toolCall: OpenAIToolCall,
  context?: TranslationContext
): AnthropicToolUseBlock {
  let input: Record<string, unknown> = {}
  try {
    input = JSON.parse(toolCall.function.arguments)
  } catch {
    input = { _raw: toolCall.function.arguments }
  }

  if (context) {
    context.openaiToolCallMap.set(toolCall.id, toolCall.function.name)
  }

  return {
    type: 'tool_use',
    id: toolCall.id,
    name: toolCall.function.name,
    input
  }
}

/**
 * Map OpenAI finish reason to Anthropic stop reason.
 */
export function mapOpenAIStopReason(
  finishReason: string | null
): AnthropicResponse['stop_reason'] {
  switch (finishReason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    case 'stop':
      return 'end_turn'
    case 'content_filter':
      return 'end_turn'
    default:
      return null
  }
}

// ── SSE Event Translation ──────────────────────────────────────────────────

/**
 * Anthropic SSE event types (subset used in streaming responses).
 */
export type AnthropicSSEEvent =
  | { type: 'message_start'; message: { id: string; model: string; role: 'assistant' } }
  | { type: 'content_block_start'; index: number; content_block: { type: 'text'; text: '' } }
  | { type: 'content_block_start'; index: number; content_block: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: 'input_json_delta'; partial_json: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string | null; stop_sequence: string | null }; usage: { output_tokens: number } }
  | { type: 'message_stop' }
  | { type: 'error'; error: { type: string; message: string } }

/**
 * OpenAI streaming delta → Anthropic SSE events translator.
 *
 * Maintains state across chunks to emit correctly structured Anthropic events.
 */
export class OpenAIDeltaToAnthropicSSE {
  private messageId: string
  private model: string
  private blockIndex = 0
  private currentBlockIndex = -1
  private currentBlockType: 'text' | 'tool_use' | null = null
  private currentToolId = ''
  private currentToolName = ''
  private currentToolInput = ''
  private hasStarted = false
  private outputTokens = 0

  constructor(messageId?: string, model?: string) {
    this.messageId = messageId ?? `msg_${Date.now()}`
    this.model = model ?? 'unknown'
  }

  /**
   * Process an OpenAI streaming delta and return zero or more Anthropic SSE events.
   */
  processDelta(delta: {
    content?: string | null
    tool_calls?: Array<{
      index?: number
      id?: string
      type?: 'function'
      function?: { name?: string; arguments?: string }
    }> | null
  }): AnthropicSSEEvent[] {
    const events: AnthropicSSEEvent[] = []

    // Lazy message_start
    if (!this.hasStarted) {
      events.push({
        type: 'message_start',
        message: { id: this.messageId, model: this.model, role: 'assistant' }
      })
      this.hasStarted = true
    }

    // Text content
    if (delta.content) {
      if (this.currentBlockType !== 'text') {
        this.closeCurrentBlock(events)
        this.currentBlockType = 'text'
        this.currentBlockIndex = this.blockIndex++
        events.push({
          type: 'content_block_start',
          index: this.currentBlockIndex,
          content_block: { type: 'text', text: '' }
        })
      }
      events.push({
        type: 'content_block_delta',
        index: this.currentBlockIndex,
        delta: { type: 'text_delta', text: delta.content }
      })
    }

    // Tool calls
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.id) {
          // New tool call
          this.closeCurrentBlock(events)
          this.currentBlockType = 'tool_use'
          this.currentBlockIndex = this.blockIndex++
          this.currentToolId = tc.id
          this.currentToolName = tc.function?.name ?? ''
          this.currentToolInput = ''

          events.push({
            type: 'content_block_start',
            index: this.currentBlockIndex,
            content_block: {
              type: 'tool_use',
              id: tc.id,
              name: tc.function?.name ?? '',
              input: {}
            }
          })
        }

        if (tc.function?.arguments) {
          this.currentToolInput += tc.function.arguments
          events.push({
            type: 'content_block_delta',
            index: this.currentBlockIndex,
            delta: { type: 'input_json_delta', partial_json: tc.function.arguments }
          })
        }
      }
    }

    return events
  }

  /**
   * Finalize the stream, emitting closing events.
   */
  finalize(
    finishReason?: string | null,
    outputTokens?: number
  ): AnthropicSSEEvent[] {
    const events: AnthropicSSEEvent[] = []

    if (!this.hasStarted) {
      // Empty response
      return events
    }

    this.closeCurrentBlock(events)
    this.outputTokens = outputTokens ?? 0

    events.push({
      type: 'message_delta',
      delta: {
        stop_reason: mapOpenAIStopReason(finishReason ?? null),
        stop_sequence: null
      },
      usage: { output_tokens: this.outputTokens }
    })

    events.push({ type: 'message_stop' })

    return events
  }

  private closeCurrentBlock(events: AnthropicSSEEvent[]): void {
    if (this.currentBlockType !== null) {
      events.push({ type: 'content_block_stop', index: this.currentBlockIndex })
      this.currentBlockType = null
    }
  }
}
