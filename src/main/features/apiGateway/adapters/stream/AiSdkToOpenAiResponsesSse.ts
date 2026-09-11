/**
 * AI SDK to OpenAI Responses API SSE Adapter
 *
 * Converts AI SDK's fullStream (TextStreamPart) events to OpenAI Responses API SSE format.
 * This adapter emits semantic events like:
 * - response.created
 * - response.in_progress
 * - response.output_item.added
 * - response.reasoning_summary_text.delta
 * - response.content_part.added
 * - response.output_text.delta
 * - response.output_text.done
 * - response.completed
 *
 * Output items are indexed in emission order rather than at fixed positions: a `reasoning`
 * item has to precede the `message` it belongs to, so the message item's own index is only
 * allocated once its first text delta arrives (or at finalize, for a text-less turn).
 *
 * @see https://platform.openai.com/docs/api-reference/responses-streaming
 */

import type { FinishReason, UIMessageChunk } from 'ai'

import type OpenAI from '@cherrystudio/openai'
import { loggerService } from '@logger'

import type { GatewayUsageMetadata, StreamAdapterOptions } from '../interfaces'
import { BaseStreamAdapter } from './BaseStreamAdapter'

const logger = loggerService.withContext('AiSdkToOpenAiResponsesSse')

/**
 * Use SDK types for events
 */
type Response = OpenAI.Responses.Response
type ResponseStreamEvent = OpenAI.Responses.ResponseStreamEvent
type ResponseUsage = OpenAI.Responses.ResponseUsage
type ResponseOutputMessage = OpenAI.Responses.ResponseOutputMessage
type ResponseFunctionToolCall = OpenAI.Responses.ResponseFunctionToolCall
type ResponseOutputItem = OpenAI.Responses.ResponseOutputItem
type ResponseReasoningItem = OpenAI.Responses.ResponseReasoningItem

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
  /** Position in the response `output[]`, allocated when the call is emitted. */
  outputIndex: number
  /** The function_call output item's id (`fc_<callId>`). */
  itemId: string
  callId: string
  name: string
  arguments: string
}

/** An open `reasoning` output item, accumulating its summary text. */
interface ReasoningState {
  itemId: string
  outputIndex: number
  text: string
}

/**
 * Adapter that converts AI SDK fullStream events to OpenAI Responses API SSE events
 */
export class AiSdkToOpenAiResponsesSse extends BaseStreamAdapter<ResponseStreamEvent> {
  private createdAt: number
  private sequenceNumber = 0
  private toolCalls: Map<string, ToolCallState> = new Map()
  private finishReason: ResponsesFinishReason = null
  private textContent = ''
  private outputItemId: string
  private contentPartIndex = 0
  /** Next free `output[]` position; items claim one as they start. */
  private nextOutputIndex = 0
  /** Completed output items keyed by their `output_index`. */
  private outputItems: Map<number, ResponseOutputItem> = new Map()
  /** Allocated on the message item's first text delta, or at finalize. */
  private messageOutputIndex: number | null = null
  private reasoning: ReasoningState | null = null
  private reasoningCount = 0

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

  /** Completed output items in `output[]` order. */
  private buildOutputItems(): ResponseOutputItem[] {
    return [...this.outputItems.entries()].sort(([a], [b]) => a - b).map(([, item]) => item)
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
  }

  /**
   * Open the assistant `message` output item, closing any reasoning that preceded it.
   * Deferred until the first text delta so a `reasoning` item can take an earlier
   * `output_index` — clients rebuild history from that order.
   */
  private ensureMessageItem(): void {
    if (this.messageOutputIndex !== null) return
    this.closeReasoningItem()
    this.messageOutputIndex = this.nextOutputIndex++

    this.emit({
      type: 'response.output_item.added',
      output_index: this.messageOutputIndex,
      item: this.buildOutputMessage(),
      sequence_number: this.nextSequence()
    })

    this.emit({
      type: 'response.content_part.added',
      item_id: this.outputItemId,
      output_index: this.messageOutputIndex,
      content_index: this.contentPartIndex,
      part: {
        type: 'output_text',
        text: '',
        annotations: []
      },
      sequence_number: this.nextSequence()
    })
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
  protected processChunk(chunk: UIMessageChunk): void {
    // Log only the chunk type — full payloads can carry prompt/tool/reasoning content.
    logger.silly('AiSdkToOpenAiResponsesSse - Processing chunk', { type: chunk.type })

    switch (chunk.type) {
      case 'text-delta':
        this.emitTextDelta(chunk.delta || '')
        break

      // Reasoning rides in its own `reasoning` output item. `reasoning-start` is ignored:
      // the item opens on the first non-empty delta, so a reasoning-less turn emits none.
      case 'reasoning-delta':
        this.emitReasoningDelta(chunk.delta || '')
        break

      case 'reasoning-end':
        this.closeReasoningItem()
        break

      case 'tool-input-available':
        this.handleToolCall({
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: chunk.input
        })
        break

      case 'finish':
        this.handleFinish(chunk)
        break

      case 'message-metadata':
        this.applyUsageMetadata(chunk.messageMetadata as GatewayUsageMetadata | undefined)
        break

      case 'error':
        throw new Error(chunk.errorText)

      default:
        // start / start-step / finish-step / text-start|end / reasoning-start /
        // tool-input-start|delta / tool-output-available / source-url / file / abort —
        // no Responses-API semantic event here.
        break
    }
  }

  /** Track cumulative usage from the `message-metadata` projection. */
  private applyUsageMetadata(metadata: GatewayUsageMetadata | undefined): void {
    if (!metadata) return
    if (metadata.stats?.inputTokens !== undefined) this.state.inputTokens = metadata.stats.inputTokens
    if (metadata.stats?.outputTokens !== undefined) this.state.outputTokens = metadata.stats.outputTokens
  }

  /**
   * Emit text delta event
   */
  private emitTextDelta(delta: string): void {
    if (!delta) return

    this.ensureMessageItem()
    this.textContent += delta

    const event: ResponseStreamEvent = {
      type: 'response.output_text.delta',
      item_id: this.outputItemId,
      output_index: this.messageOutputIndex ?? 0,
      content_index: this.contentPartIndex,
      delta,
      logprobs: [],
      sequence_number: this.nextSequence()
    }
    this.emit(event)
  }

  /**
   * Append to the open `reasoning` item, opening one on the first delta.
   *
   * The chain rides in `summary` (what clients render and echo back) and is mirrored into
   * `content` as `reasoning_text` — the model gives us raw reasoning, not a summary, but
   * `summary` is the field every Responses client reads.
   */
  private emitReasoningDelta(delta: string): void {
    if (!delta) return

    if (!this.reasoning) {
      const outputIndex = this.nextOutputIndex++
      this.reasoning = { itemId: `rs_${this.state.messageId}_${this.reasoningCount++}`, outputIndex, text: '' }

      this.emit({
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: { type: 'reasoning', id: this.reasoning.itemId, summary: [], status: 'in_progress' },
        sequence_number: this.nextSequence()
      })
      this.emit({
        type: 'response.reasoning_summary_part.added',
        item_id: this.reasoning.itemId,
        output_index: outputIndex,
        summary_index: 0,
        part: { type: 'summary_text', text: '' },
        sequence_number: this.nextSequence()
      })
    }

    this.reasoning.text += delta
    this.emit({
      type: 'response.reasoning_summary_text.delta',
      item_id: this.reasoning.itemId,
      output_index: this.reasoning.outputIndex,
      summary_index: 0,
      delta,
      sequence_number: this.nextSequence()
    })
  }

  /** Close the open reasoning item, if any. Idempotent — several paths may reach it. */
  private closeReasoningItem(): void {
    if (!this.reasoning) return
    const { itemId, outputIndex, text } = this.reasoning
    this.reasoning = null

    this.emit({
      type: 'response.reasoning_summary_text.done',
      item_id: itemId,
      output_index: outputIndex,
      summary_index: 0,
      text,
      sequence_number: this.nextSequence()
    })
    this.emit({
      type: 'response.reasoning_summary_part.done',
      item_id: itemId,
      output_index: outputIndex,
      summary_index: 0,
      part: { type: 'summary_text', text },
      sequence_number: this.nextSequence()
    })

    const item: ResponseReasoningItem = {
      type: 'reasoning',
      id: itemId,
      summary: [{ type: 'summary_text', text }],
      content: [{ type: 'reasoning_text', text }],
      status: 'completed'
    }
    this.outputItems.set(outputIndex, item)
    this.emit({
      type: 'response.output_item.done',
      output_index: outputIndex,
      item,
      sequence_number: this.nextSequence()
    })
  }

  /**
   * Handle a tool call. Client tools resolve in a single `tool-input-available`
   * chunk (full args, no incremental deltas), so the function_call output item's
   * whole lifecycle is emitted at once: `output_item.added` →
   * `function_call_arguments.delta` → `function_call_arguments.done` →
   * `output_item.done`. The items are also surfaced in the terminal
   * `response.completed` output[] and in the non-streaming response.
   */
  private handleToolCall(params: { toolCallId: string; toolName: string; args: unknown }): void {
    const { toolCallId, toolName, args } = params

    if (this.toolCalls.has(toolCallId)) {
      return
    }

    // The reasoning that led to this call belongs before it in `output[]`.
    this.closeReasoningItem()
    const outputIndex = this.nextOutputIndex++
    const itemId = `fc_${toolCallId}`
    // Default arg-less calls to `{}` — `JSON.stringify(undefined)` is `undefined`,
    // which would emit an invalid (empty) arguments string.
    const argsString = JSON.stringify(args ?? {})

    this.toolCalls.set(toolCallId, {
      outputIndex,
      itemId,
      callId: toolCallId,
      name: toolName,
      arguments: argsString
    })

    const inProgressItem: ResponseFunctionToolCall = {
      type: 'function_call',
      id: itemId,
      call_id: toolCallId,
      name: toolName,
      arguments: '',
      status: 'in_progress'
    }

    this.emit({
      type: 'response.output_item.added',
      output_index: outputIndex,
      item: inProgressItem,
      sequence_number: this.nextSequence()
    })

    this.emit({
      type: 'response.function_call_arguments.delta',
      item_id: itemId,
      output_index: outputIndex,
      delta: argsString,
      sequence_number: this.nextSequence()
    })

    this.emit({
      type: 'response.function_call_arguments.done',
      item_id: itemId,
      output_index: outputIndex,
      name: toolName,
      arguments: argsString,
      sequence_number: this.nextSequence()
    })

    const completedItem: ResponseFunctionToolCall = { ...inProgressItem, arguments: argsString, status: 'completed' }
    this.outputItems.set(outputIndex, completedItem)
    this.emit({
      type: 'response.output_item.done',
      output_index: outputIndex,
      item: completedItem,
      sequence_number: this.nextSequence()
    })

    this.finishReason = 'tool_calls'
  }

  /**
   * Handle finish event
   */
  private handleFinish(chunk: { finishReason?: FinishReason; messageMetadata?: unknown }): void {
    this.applyUsageMetadata(chunk.messageMetadata as GatewayUsageMetadata | undefined)

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
    // Explicit, not via `ensureMessageItem`: reasoning that opened AFTER the message item
    // (a later step, or a stream that ended before `reasoning-end`) would otherwise stay
    // open and never reach `output[]`.
    this.closeReasoningItem()
    // A turn that never produced text still closes out a (empty) message item, so the
    // response shape is unchanged for clients that expect one.
    this.ensureMessageItem()
    const outputIndex = this.messageOutputIndex ?? 0

    // Emit output_text.done
    const textDoneEvent: ResponseStreamEvent = {
      type: 'response.output_text.done',
      item_id: this.outputItemId,
      output_index: outputIndex,
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
      output_index: outputIndex,
      content_index: this.contentPartIndex,
      part: {
        type: 'output_text',
        text: this.textContent,
        annotations: []
      },
      sequence_number: this.nextSequence()
    }
    this.emit(contentPartDoneEvent)

    const completedMessage: ResponseOutputMessage = {
      type: 'message',
      id: this.outputItemId,
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: this.textContent,
          annotations: []
        }
      ]
    }
    this.outputItems.set(outputIndex, completedMessage)

    // Emit output_item.done
    const outputItemDoneEvent: ResponseStreamEvent = {
      type: 'response.output_item.done',
      output_index: outputIndex,
      item: completedMessage,
      sequence_number: this.nextSequence()
    }
    this.emit(outputItemDoneEvent)

    // Emit response.completed
    const completedEvent: ResponseStreamEvent = {
      type: 'response.completed',
      response: {
        ...this.buildResponseForEvent('completed'),
        output: this.buildOutputItems()
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
    const partialResponse: PartialStreamingResponse = {
      id: `resp_${this.state.messageId}`,
      object: 'response',
      created_at: this.createdAt,
      status: 'completed',
      model: this.state.model,
      // `finalizeEvents()` runs before this on the non-streaming path, so every item
      // (reasoning, function calls, message) has already landed in `outputItems`.
      output: this.buildOutputItems(),
      usage: this.buildUsage()
    }

    return partialResponse as Response
  }
}

export default AiSdkToOpenAiResponsesSse
