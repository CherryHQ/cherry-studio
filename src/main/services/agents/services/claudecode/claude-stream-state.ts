/**
 * Lightweight state container shared by the Claude → AiSDK transformer. Anthropic does not send
 * deterministic identifiers for intermediate content blocks, so we stitch one together by tracking
 * block indices and associated AiSDK ids. This class also keeps:
 *   • incremental text / reasoning buffers so we can emit only deltas while retaining the full
 *     aggregate for later tool-call emission;
 *   • a reverse lookup for tool calls so `tool_result` snapshots can recover their metadata;
 *   • pending usage + finish reason from `message_delta` events until the corresponding
 *     `message_stop` arrives.
 * Every Claude turn gets its own instance. `resetStep` should be invoked once the finish event has
 * been emitted to avoid leaking state into the next turn.
 */
import type { FinishReason, LanguageModelUsage, ProviderMetadata } from 'ai'

/**
 * Shared fields for every block that Claude can stream (text, reasoning, tool).
 */
type BaseBlockState = {
  id: string
  index: number
}

type TextBlockState = BaseBlockState & {
  kind: 'text'
  text: string
}

type ReasoningBlockState = BaseBlockState & {
  kind: 'reasoning'
  text: string
  redacted: boolean
}

type ToolBlockState = BaseBlockState & {
  kind: 'tool'
  toolCallId: string
  toolName: string
  inputBuffer: string
  providerMetadata?: ProviderMetadata
  resolvedInput?: unknown
}

export type BlockState = TextBlockState | ReasoningBlockState | ToolBlockState

type PendingUsageState = {
  usage?: LanguageModelUsage
  finishReason?: FinishReason
}

type PendingToolCall = {
  toolCallId: string
  toolName: string
  input: unknown
  providerMetadata?: ProviderMetadata
}

/**
 * Tracks the lifecycle of Claude streaming blocks (text, thinking, tool calls)
 * across individual websocket events. The transformer relies on this class to
 * stitch together deltas, manage pending tool inputs/results, and propagate
 * usage/finish metadata once Anthropic closes a message.
 */
export class ClaudeStreamState {
  private blocksByIndex = new Map<number, BlockState>()
  private toolIndexById = new Map<string, number>()
  private pendingUsage: PendingUsageState = {}
  private pendingToolCalls = new Map<string, PendingToolCall>()
  private stepActive = false

  /** Marks the beginning of a new AiSDK step. */
  beginStep(): void {
    this.stepActive = true
  }

  hasActiveStep(): boolean {
    return this.stepActive
  }

  /** Creates a text block placeholder so future deltas can accumulate into it. */
  openTextBlock(index: number, id: string): TextBlockState {
    const block: TextBlockState = {
      kind: 'text',
      id,
      index,
      text: ''
    }
    this.blocksByIndex.set(index, block)
    return block
  }

  /** Starts tracking an Anthropic "thinking" block, optionally flagged as redacted. */
  openReasoningBlock(index: number, id: string, redacted: boolean): ReasoningBlockState {
    const block: ReasoningBlockState = {
      kind: 'reasoning',
      id,
      index,
      redacted,
      text: ''
    }
    this.blocksByIndex.set(index, block)
    return block
  }

  /** Caches tool metadata so subsequent input deltas and results can find it. */
  openToolBlock(
    index: number,
    params: { toolCallId: string; toolName: string; providerMetadata?: ProviderMetadata }
  ): ToolBlockState {
    const block: ToolBlockState = {
      kind: 'tool',
      id: params.toolCallId,
      index,
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      inputBuffer: '',
      providerMetadata: params.providerMetadata
    }
    this.blocksByIndex.set(index, block)
    this.toolIndexById.set(params.toolCallId, index)
    return block
  }

  getBlock(index: number): BlockState | undefined {
    return this.blocksByIndex.get(index)
  }

  getToolBlockById(toolCallId: string): ToolBlockState | undefined {
    const index = this.toolIndexById.get(toolCallId)
    if (index === undefined) return undefined
    const block = this.blocksByIndex.get(index)
    if (!block || block.kind !== 'tool') return undefined
    return block
  }

  /** Appends streamed text to a text block, returning the updated state when present. */
  appendTextDelta(index: number, text: string): TextBlockState | undefined {
    const block = this.blocksByIndex.get(index)
    if (!block || block.kind !== 'text') return undefined
    block.text += text
    return block
  }

  /** Appends streamed "thinking" content to the tracked reasoning block. */
  appendReasoningDelta(index: number, text: string): ReasoningBlockState | undefined {
    const block = this.blocksByIndex.get(index)
    if (!block || block.kind !== 'reasoning') return undefined
    block.text += text
    return block
  }

  /** Concatenates incremental JSON payloads for tool input blocks. */
  appendToolInputDelta(index: number, jsonDelta: string): ToolBlockState | undefined {
    const block = this.blocksByIndex.get(index)
    if (!block || block.kind !== 'tool') return undefined
    block.inputBuffer += jsonDelta
    return block
  }

  /** Records a tool call to be consumed once its result arrives from the user. */
  registerToolCall(
    toolCallId: string,
    payload: { toolName: string; input: unknown; providerMetadata?: ProviderMetadata }
  ): void {
    this.pendingToolCalls.set(toolCallId, {
      toolCallId,
      toolName: payload.toolName,
      input: payload.input,
      providerMetadata: payload.providerMetadata
    })
  }

  /** Retrieves and clears the buffered tool call metadata for the given id. */
  consumePendingToolCall(toolCallId: string): PendingToolCall | undefined {
    const entry = this.pendingToolCalls.get(toolCallId)
    if (entry) {
      this.pendingToolCalls.delete(toolCallId)
    }
    return entry
  }

  /**
   * Persists the final input payload for a tool block once the provider signals
   * completion so that downstream tool results can reference the original call.
   */
  completeToolBlock(toolCallId: string, input: unknown, providerMetadata?: ProviderMetadata): void {
    this.registerToolCall(toolCallId, {
      toolName: this.getToolBlockById(toolCallId)?.toolName ?? 'unknown',
      input,
      providerMetadata
    })
    const block = this.getToolBlockById(toolCallId)
    if (block) {
      block.resolvedInput = input
    }
  }

  /** Removes a block from the active index map when Claude signals it is done. */
  closeBlock(index: number): BlockState | undefined {
    const block = this.blocksByIndex.get(index)
    if (!block) return undefined
    this.blocksByIndex.delete(index)
    if (block.kind === 'tool') {
      this.toolIndexById.delete(block.toolCallId)
    }
    return block
  }

  /** Stores interim usage metrics so they can be emitted with the `finish-step`. */
  setPendingUsage(usage?: LanguageModelUsage, finishReason?: FinishReason): void {
    if (usage) {
      this.pendingUsage.usage = usage
    }
    if (finishReason) {
      this.pendingUsage.finishReason = finishReason
    }
  }

  getPendingUsage(): PendingUsageState {
    return { ...this.pendingUsage }
  }

  /** Clears any accumulated usage values for the next streamed message. */
  resetPendingUsage(): void {
    this.pendingUsage = {}
  }

  /** Drops cached block metadata for the currently active message. */
  resetBlocks(): void {
    this.blocksByIndex.clear()
    this.toolIndexById.clear()
  }

  /** Resets the entire step lifecycle after emitting a terminal frame. */
  resetStep(): void {
    this.resetBlocks()
    this.resetPendingUsage()
    this.stepActive = false
  }
}

export type { PendingToolCall }
