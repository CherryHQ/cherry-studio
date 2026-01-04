/**
 * AI SDK to OpenAI Responses API SSE Adapter
 *
 * Converts AI SDK's fullStream (TextStreamPart) events to OpenAI Responses API SSE format.
 * This adapter emits semantic events like:
 * - response.created
 * - response.in_progress
 * - response.output_item.added
 * - response.content_part.added
 * - response.output_text.delta
 * - response.output_text.done
 * - response.completed
 *
 * @see https://platform.openai.com/docs/api-reference/responses-streaming
 */

import type OpenAI from '@cherrystudio/openai'
import { loggerService } from '@logger'
import type { FinishReason, LanguageModelUsage, TextStreamPart, ToolSet } from 'ai'

import type { StreamAdapterOptions } from '../interfaces'
import { BaseStreamAdapter } from './BaseStreamAdapter'

const logger = loggerService.withContext('AiSdkToOpenAIResponsesSSE')

/**
 * Use SDK types for events
 */
type Response = OpenAI.Responses.Response
type ResponseStreamEvent = OpenAI.Responses.ResponseStreamEvent
type ResponseUsage = OpenAI.Responses.ResponseUsage
type ResponseOutputMessage = OpenAI.Responses.ResponseOutputMessage
type ResponseOutputText = OpenAI.Responses.ResponseOutputText

/**
 * Minimal response fields required for streaming.
 * Uses Pick to select only necessary fields from the full Response type.
 */
type StreamingResponseFields = Pick<Response, 'id' | 'object' | 'created_at' | 'status' | 'model' | 'output'>

/**
 * Partial response type for streaming that includes optional usage.
 * During streaming, we only emit a subset of fields.
 */
type PartialStreamingResponse = StreamingResponseFields & {
  usage?: Partial<ResponseUsage>
}

/**
 * Minimal usage type for streaming responses.
 * The SDK's ResponseUsage requires input_tokens_details and output_tokens_details,
 * but during streaming we may only have the basic token counts.
 */
type StreamingUsage = Pick<ResponseUsage, 'input_tokens' | 'output_tokens' | 'total_tokens'>

/**
 * OpenAI Responses finish reasons
 */
type ResponsesFinishReason = 'stop' | 'max_output_tokens' | 'content_filter' | 'tool_calls' | 'cancelled' | null

/**
 * Tool call state for tracking
 */
interface ToolCallState {
  index: number
  callId: string
  name: string
  arguments: string
}

/**
 * Adapter that converts AI SDK fullStream events to OpenAI Responses API SSE events
 */
export class AiSdkToOpenAIResponsesSSE extends BaseStreamAdapter<ResponseStreamEvent> {
  private createdAt: number
  private sequenceNumber = 0
  private toolCalls: Map<string, ToolCallState> = new Map()
  private currentToolCallIndex = 0
  private finishReason: ResponsesFinishReason = null
  private textContent = ''
  private outputItemId: string
  private contentPartIndex = 0

  constructor(options: StreamAdapterOptions) {
    super(options)
    this.createdAt = Math.floor(Date.now() / 1000)
    this.outputItemId = `msg_${this.state.messageId}`
  }

  /**
   * Get next sequence number
   */
  private nextSequence(): number {
    return this.sequenceNumber++
  }

  /**
   * Build base response object for streaming events.
   * Returns a partial response with only the fields needed for streaming.
   * Cast to Response for SDK compatibility - streaming events intentionally
   * omit fields that are not available until completion.
   */
  private buildBaseResponse(status: 'in_progress' | 'completed' | 'failed' = 'in_progress'): PartialStreamingResponse {
    return {
      id: `resp_${this.state.messageId}`,
      object: 'response',
      created_at: this.createdAt,
      status,
      model: this.state.model,
      output: [],
      usage: this.buildUsage()
    }
  }

  /**
   * Build usage object for streaming responses.
   * Uses StreamingUsage which only includes basic token counts,
   * omitting the detailed breakdowns (input_tokens_details, output_tokens_details)
   * that are not available during streaming.
   */
  private buildUsage(): StreamingUsage {
    return {
      input_tokens: this.state.inputTokens,
      output_tokens: this.state.outputTokens,
      total_tokens: this.state.inputTokens + this.state.outputTokens
    }
  }

  /**
   * Build base response and cast to Response for event emission.
   * This is safe because streaming consumers expect partial data.
   */
  private buildResponseForEvent(status: 'in_progress' | 'completed' | 'failed' = 'in_progress'): Response {
    return this.buildBaseResponse(status) as Response
  }

  /**
   * Emit the initial message start events
   */
  protected emitMessageStart(): void {
    if (this.state.hasEmittedMessageStart) return
    this.state.hasEmittedMessageStart = true

    // Emit response.created
    const createdEvent: ResponseStreamEvent = {
      type: 'response.created',
      response: this.buildResponseForEvent('in_progress'),
      sequence_number: this.nextSequence()
    }
    this.emit(createdEvent)

    // Emit response.in_progress
    const inProgressEvent: ResponseStreamEvent = {
      type: 'response.in_progress',
      response: this.buildResponseForEvent('in_progress'),
      sequence_number: this.nextSequence()
    }
    this.emit(inProgressEvent)

    // Emit output_item.added for the message
    const outputItemAddedEvent: ResponseStreamEvent = {
      type: 'response.output_item.added',
      output_index: 0,
      item: this.buildOutputMessage(),
      sequence_number: this.nextSequence()
    }
    this.emit(outputItemAddedEvent)

    // Emit content_part.added for text
    const contentPartAddedEvent: ResponseStreamEvent = {
      type: 'response.content_part.added',
      item_id: this.outputItemId,
      output_index: 0,
      content_index: this.contentPartIndex,
      part: {
        type: 'output_text',
        text: '',
        annotations: []
      },
      sequence_number: this.nextSequence()
    }
    this.emit(contentPartAddedEvent)
  }

  /**
   * Build output message object
   */
  private buildOutputMessage(): ResponseOutputMessage {
    return {
      type: 'message',
      id: this.outputItemId,
      status: 'in_progress',
      role: 'assistant',
      content: []
    }
  }

  /**
   * Process a single AI SDK chunk and emit corresponding Responses API events
   */
  protected processChunk(chunk: TextStreamPart<ToolSet>): void {
    logger.silly('AiSdkToOpenAIResponsesSSE - Processing chunk:', { chunk: JSON.stringify(chunk) })

    switch (chunk.type) {
      case 'text-delta':
        this.emitTextDelta(chunk.text || '')
        break

      case 'tool-call':
        this.handleToolCall({
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: chunk.input
        })
        break

      case 'finish-step':
        if (chunk.finishReason === 'tool-calls') {
          this.finishReason = 'tool_calls'
        }
        break

      case 'finish':
        this.handleFinish(chunk)
        break

      case 'error':
        throw chunk.error

      default:
        break
    }
  }

  /**
   * Emit text delta event
   */
  private emitTextDelta(delta: string): void {
    if (!delta) return

    this.textContent += delta

    const event: ResponseStreamEvent = {
      type: 'response.output_text.delta',
      item_id: this.outputItemId,
      output_index: 0,
      content_index: this.contentPartIndex,
      delta,
      logprobs: [],
      sequence_number: this.nextSequence()
    }
    this.emit(event)
  }

  /**
   * Handle tool call
   */
  private handleToolCall(params: { toolCallId: string; toolName: string; args: unknown }): void {
    const { toolCallId, toolName, args } = params

    if (this.toolCalls.has(toolCallId)) {
      return
    }

    const index = this.currentToolCallIndex++
    const argsString = JSON.stringify(args)

    this.toolCalls.set(toolCallId, {
      index,
      callId: toolCallId,
      name: toolName,
      arguments: argsString
    })

    this.finishReason = 'tool_calls'
  }

  /**
   * Handle finish event
   */
  private handleFinish(chunk: { type: 'finish'; finishReason?: FinishReason; totalUsage?: LanguageModelUsage }): void {
    if (chunk.totalUsage) {
      this.state.inputTokens = chunk.totalUsage.inputTokens || 0
      this.state.outputTokens = chunk.totalUsage.outputTokens || 0
    }

    if (!this.finishReason) {
      switch (chunk.finishReason) {
        case 'stop':
          this.finishReason = 'stop'
          break
        case 'length':
          this.finishReason = 'max_output_tokens'
          break
        case 'tool-calls':
          this.finishReason = 'tool_calls'
          break
        case 'content-filter':
          this.finishReason = 'content_filter'
          break
        default:
          this.finishReason = 'stop'
      }
    }

    this.state.stopReason = this.finishReason
  }

  /**
   * Finalize the stream and emit closing events
   */
  protected finalize(): void {
    // Emit output_text.done
    const textDoneEvent: ResponseStreamEvent = {
      type: 'response.output_text.done',
      item_id: this.outputItemId,
      output_index: 0,
      content_index: this.contentPartIndex,
      text: this.textContent,
      logprobs: [],
      sequence_number: this.nextSequence()
    }
    this.emit(textDoneEvent)

    // Emit content_part.done
    const contentPartDoneEvent: ResponseStreamEvent = {
      type: 'response.content_part.done',
      item_id: this.outputItemId,
      output_index: 0,
      content_index: this.contentPartIndex,
      part: {
        type: 'output_text',
        text: this.textContent,
        annotations: []
      },
      sequence_number: this.nextSequence()
    }
    this.emit(contentPartDoneEvent)

    // Emit output_item.done
    const outputItemDoneEvent: ResponseStreamEvent = {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        type: 'message',
        id: this.outputItemId,
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: this.textContent,
            annotations: []
          } as ResponseOutputText
        ]
      },
      sequence_number: this.nextSequence()
    }
    this.emit(outputItemDoneEvent)

    // Emit response.completed
    const completedEvent: ResponseStreamEvent = {
      type: 'response.completed',
      response: {
        ...this.buildResponseForEvent('completed'),
        output: [
          {
            type: 'message',
            id: this.outputItemId,
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: this.textContent,
                annotations: []
              } as ResponseOutputText
            ]
          }
        ]
      },
      sequence_number: this.nextSequence()
    }
    this.emit(completedEvent)
  }

  /**
   * Build a complete Response object for non-streaming responses.
   * Returns a partial response cast to Response type.
   */
  buildNonStreamingResponse(): Response {
    const outputText: ResponseOutputText = {
      type: 'output_text',
      text: this.textContent,
      annotations: []
    }

    const outputMessage: ResponseOutputMessage = {
      type: 'message',
      id: this.outputItemId,
      status: 'completed',
      role: 'assistant',
      content: [outputText]
    }

    const partialResponse: PartialStreamingResponse = {
      id: `resp_${this.state.messageId}`,
      object: 'response',
      created_at: this.createdAt,
      status: 'completed',
      model: this.state.model,
      output: [outputMessage],
      usage: this.buildUsage()
    }

    return partialResponse as Response
  }
}

export default AiSdkToOpenAIResponsesSSE
