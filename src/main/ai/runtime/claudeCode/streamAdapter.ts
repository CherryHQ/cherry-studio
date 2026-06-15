import type {
  JSONObject,
  JSONValue,
  LanguageModelV3,
  LanguageModelV3FinishReason,
  LanguageModelV3Usage
} from '@ai-sdk/provider'
import { generateId } from '@ai-sdk/provider-utils'
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKStatusMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
  SDKThinkingTokensMessage,
  SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMCPToolUseBlock,
  BetaRawContentBlockDeltaEvent,
  BetaRawContentBlockStartEvent,
  BetaRawContentBlockStopEvent,
  BetaRawMessageDeltaEvent,
  BetaServerToolUseBlock,
  BetaToolUseBlock
} from '@anthropic-ai/sdk/resources/beta/messages'
import { loggerService } from '@logger'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { CherryUIMessageChunk, CherryUIMessageMetadata } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

import type { McpToolDisplayMetadata } from './types'

const logger = loggerService.withContext('ClaudeCodeStreamAdapter')

const MIN_TRUNCATION_LENGTH = 512
const UNKNOWN_TOOL_NAME = 'unknown-tool'
const MAX_TOOL_INPUT_SIZE = 1_048_576
const MAX_TOOL_INPUT_WARN = 102_400
const MAX_DELTA_CALC_SIZE = 10_000

// ── Internal types ──────────────────────────────────────────────────

type BetaUsage = SDKResultMessage['usage']
type SDKParentToolUseId = SDKAssistantMessage['parent_tool_use_id']
type SDKTaskSystemMessage =
  | SDKTaskNotificationMessage
  | SDKTaskProgressMessage
  | SDKTaskStartedMessage
  | SDKTaskUpdatedMessage
type SDKTaskStatus = SDKTaskNotificationMessage['status'] | SDKTaskUpdatedMessage['patch']['status'] | undefined
type ClaudeToolUseBlock = BetaToolUseBlock | BetaServerToolUseBlock | BetaMCPToolUseBlock
type ClaudeToolResultBlock = Extract<BetaContentBlock | BetaContentBlockParam, { tool_use_id: string }>

type ToolStreamState = {
  name: string
  lastSerializedInput?: string
  inputStarted: boolean
  inputClosed: boolean
  callEmitted: boolean
  parentToolCallId?: string | null
  sdkBlockType?: string
  serverName?: string
  serverId?: string
  toolType?: 'mcp' | 'provider'
  displayName?: string
  description?: string
}

type StreamSink = {
  enqueue(part: CherryUIMessageChunk): void
}

type StreamContext = {
  sink: StreamSink
  options: Parameters<LanguageModelV3['doStream']>[0]
  toolStates: Map<string, ToolStreamState>
  activeTaskTools: Map<string, { startTime: number }>
  toolBlocksByIndex: Map<number, string>
  toolInputAccumulators: Map<string, string>
  toolResultsEmitted: Set<string>
  textBlocksByIndex: Map<number, string>
  reasoningBlocksByIndex: Map<number, string>
  currentReasoningPartId: string | undefined
  textPartId: string | undefined
  accumulatedText: string
  streamedTextLength: number
  usage: LanguageModelV3Usage
  hasReceivedStreamEvents: boolean
  hasStreamedJson: boolean
  textStreamedViaContentBlock: boolean
}

export type ClaudeCodeStreamAdapterOptions = {
  modelId: string
  streamOptions: Parameters<LanguageModelV3['doStream']>[0]
  sink: StreamSink
  onSessionId?: (sessionId: string) => void
  mcpToolMetadata?: Record<string, McpToolDisplayMetadata>
}

export type ClaudeCodeStreamAdapterResult =
  | { type: 'continue' }
  | { type: 'result'; sessionId: string; message: SDKResultMessage }

function isClaudeCodeTruncationError(error: unknown, bufferedText: string): boolean {
  const err = error as { name?: string; message?: string } | null
  const isSyntaxError =
    error instanceof SyntaxError || (typeof err?.name === 'string' && err.name.toLowerCase() === 'syntaxerror')

  if (!isSyntaxError || !bufferedText) return false

  const message = typeof err?.message === 'string' ? err.message.toLowerCase() : ''
  const truncationIndicators = [
    'unexpected end of json input',
    'unexpected end of input',
    'unexpected end of string',
    'unexpected eof',
    'end of file',
    'unterminated string',
    'unterminated string constant'
  ]

  if (!truncationIndicators.some((i) => message.includes(i))) return false
  return bufferedText.length >= MIN_TRUNCATION_LENGTH
}

function isSubagentToolName(toolName: string): boolean {
  return toolName === 'Task' || toolName === 'Agent'
}

function createEmptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: undefined, reasoning: undefined },
    raw: undefined
  }
}

export function convertClaudeCodeUsage(usage: BetaUsage): LanguageModelV3Usage {
  const inputTokens = usage.input_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0

  return {
    inputTokens: {
      total: inputTokens + cacheWrite + cacheRead,
      noCache: inputTokens,
      cacheRead,
      cacheWrite
    },
    outputTokens: { total: outputTokens, text: undefined, reasoning: undefined },
    raw: JSON.parse(JSON.stringify(usage)) as JSONObject
  }
}

function mapClaudeCodeFinishReason(subtype?: string, stopReason?: string | null): LanguageModelV3FinishReason {
  if (stopReason != null) {
    switch (stopReason) {
      case 'end_turn':
        return { unified: 'stop', raw: 'end_turn' }
      case 'max_tokens':
        return { unified: 'length', raw: 'max_tokens' }
      case 'stop_sequence':
        return { unified: 'stop', raw: 'stop_sequence' }
      case 'tool_use':
        return { unified: 'tool-calls', raw: 'tool_use' }
    }
  }

  const raw = stopReason ?? subtype
  switch (subtype) {
    case 'success':
      return { unified: 'stop', raw }
    case 'error_max_turns':
      return { unified: 'length', raw }
    case 'error_during_execution':
      return { unified: 'error', raw }
    case undefined:
      return { unified: 'stop', raw }
    default:
      return { unified: 'other', raw }
  }
}

function mapTaskStatus(status: SDKTaskStatus): AgentTaskEventPartData['status'] | undefined {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'running':
    case 'paused':
      return 'in_progress'
    case 'completed':
      return 'completed'
    case 'failed':
    case 'killed':
    case 'stopped':
      return 'error'
    default:
      return undefined
  }
}

export class ClaudeCodeStreamAdapter {
  private readonly ctx: StreamContext
  private readonly modelId: string
  private readonly onSessionId?: (sessionId: string) => void
  private readonly mcpToolMetadata: Record<string, McpToolDisplayMetadata>

  constructor(options: ClaudeCodeStreamAdapterOptions) {
    this.modelId = options.modelId
    this.onSessionId = options.onSessionId
    this.mcpToolMetadata = options.mcpToolMetadata ?? {}
    this.ctx = {
      sink: options.sink,
      options: options.streamOptions,
      toolStates: new Map(),
      activeTaskTools: new Map(),
      toolBlocksByIndex: new Map(),
      toolInputAccumulators: new Map(),
      toolResultsEmitted: new Set(),
      textBlocksByIndex: new Map(),
      reasoningBlocksByIndex: new Map(),
      currentReasoningPartId: undefined,
      textPartId: undefined,
      accumulatedText: '',
      streamedTextLength: 0,
      usage: createEmptyUsage(),
      hasReceivedStreamEvents: false,
      hasStreamedJson: false,
      textStreamedViaContentBlock: false
    }
  }

  handleMessage(message: SDKMessage): ClaudeCodeStreamAdapterResult {
    switch (message.type) {
      case 'stream_event':
        this.handleStreamEvent(message, this.ctx)
        return { type: 'continue' }
      case 'assistant':
        this.handleAssistantMessage(message, this.ctx)
        return { type: 'continue' }
      case 'user':
        this.handleUserMessage(message, this.ctx)
        return { type: 'continue' }
      case 'result':
        this.handleResultMessage(message, this.ctx)
        return { type: 'result', sessionId: message.session_id, message }
      case 'system':
        this.handleSystemMessage(message, this.ctx)
        return { type: 'continue' }
    }
    return { type: 'continue' }
  }

  finalizeOpenParts(): void {
    this.finalizeToolCalls(this.ctx)
  }

  handleTruncationError(error: unknown): boolean {
    if (!isClaudeCodeTruncationError(error, this.ctx.accumulatedText)) return false

    logger.warn(
      `Detected truncated stream response, returning ${this.ctx.accumulatedText.length} chars of buffered text`
    )
    if (this.ctx.textPartId) {
      this.ctx.sink.enqueue({ type: 'text-end', id: this.ctx.textPartId })
    } else if (this.ctx.accumulatedText && !this.ctx.textStreamedViaContentBlock) {
      const fallbackTextId = generateId()
      this.ctx.sink.enqueue({ type: 'text-start', id: fallbackTextId })
      this.ctx.sink.enqueue({ type: 'text-delta', id: fallbackTextId, delta: this.ctx.accumulatedText })
      this.ctx.sink.enqueue({ type: 'text-end', id: fallbackTextId })
    }

    this.finalizeToolCalls(this.ctx)
    this.ctx.sink.enqueue({
      type: 'finish',
      finishReason: 'length',
      messageMetadata: this.buildMessageMetadata(this.ctx.usage)
    })
    return true
  }

  private handleStreamEvent(message: SDKPartialAssistantMessage, ctx: StreamContext): void {
    const { event } = message
    switch (event.type) {
      case 'content_block_start':
        this.handleContentBlockStart(event, message.parent_tool_use_id, ctx)
        break
      case 'content_block_delta':
        this.handleContentBlockDelta(event, ctx)
        break
      case 'content_block_stop':
        this.handleContentBlockStop(event, ctx)
        break
      case 'message_delta':
        this.handleMessageDelta(event, ctx)
        break
      case 'message_start':
      case 'message_stop':
        break
    }
  }

  private handleContentBlockStart(
    event: BetaRawContentBlockStartEvent,
    sdkParentToolUseId: SDKParentToolUseId,
    ctx: StreamContext
  ): void {
    ctx.hasReceivedStreamEvents = true
    const block = event.content_block

    switch (block.type) {
      case 'tool_use':
      case 'server_tool_use':
      case 'mcp_tool_use':
        this.handleToolUseBlockStart(block, event.index, sdkParentToolUseId, ctx)
        return
      case 'mcp_tool_result':
      case 'web_search_tool_result':
      case 'web_fetch_tool_result':
      case 'code_execution_tool_result':
      case 'bash_code_execution_tool_result':
      case 'text_editor_code_execution_tool_result':
      case 'tool_search_tool_result':
        this.handleToolResult(block, sdkParentToolUseId, ctx)
        return
      case 'text':
        this.handleTextBlockStart(event, sdkParentToolUseId, ctx)
        return
      case 'thinking':
        this.handleThinkingBlockStart(event, sdkParentToolUseId, ctx)
        return
    }
  }

  private handleToolUseBlockStart(
    toolBlock: ClaudeToolUseBlock,
    blockIndex: number,
    sdkParentToolUseId: SDKParentToolUseId,
    ctx: StreamContext
  ): void {
    const toolId = toolBlock.id
    const toolName = toolBlock.name
    const toolMetadata = this.getToolUseMetadata(toolBlock)

    this.closeActiveTextPart(ctx)

    ctx.toolBlocksByIndex.set(blockIndex, toolId)
    ctx.toolInputAccumulators.set(toolId, '')

    let state = ctx.toolStates.get(toolId)
    if (!state) {
      const currentParentId = isSubagentToolName(toolName)
        ? null
        : (sdkParentToolUseId ?? this.getFallbackParentId(ctx))
      state = {
        name: toolName,
        inputStarted: false,
        inputClosed: false,
        callEmitted: false,
        parentToolCallId: currentParentId,
        ...toolMetadata
      }
      ctx.toolStates.set(toolId, state)
    }
    this.mergeToolMetadata(state, toolMetadata)
    this.mergeToolDisplayMetadata(state)

    if (!state.inputStarted) {
      ctx.sink.enqueue({
        type: 'tool-input-start',
        toolCallId: toolId,
        toolName,
        providerExecuted: true,
        dynamic: true,
        title: this.getToolTitle(state),
        providerMetadata: this.buildToolProviderMetadata(state)
      })
      if (isSubagentToolName(toolName)) ctx.activeTaskTools.set(toolId, { startTime: Date.now() })
      state.inputStarted = true
    }
  }

  private handleTextBlockStart(
    event: BetaRawContentBlockStartEvent,
    sdkParentToolUseId: SDKParentToolUseId,
    ctx: StreamContext
  ): void {
    const partId = generateId()
    ctx.textBlocksByIndex.set(event.index, partId)
    ctx.textPartId = partId
    ctx.sink.enqueue({
      type: 'text-start',
      id: partId,
      providerMetadata: this.buildParentProviderMetadata(sdkParentToolUseId)
    })
    ctx.textStreamedViaContentBlock = true
  }

  private handleThinkingBlockStart(
    event: BetaRawContentBlockStartEvent,
    sdkParentToolUseId: SDKParentToolUseId,
    ctx: StreamContext
  ): void {
    this.closeActiveTextPart(ctx)

    const reasoningPartId = generateId()
    ctx.reasoningBlocksByIndex.set(event.index, reasoningPartId)
    ctx.currentReasoningPartId = reasoningPartId
    ctx.sink.enqueue({
      type: 'reasoning-start',
      id: reasoningPartId,
      providerMetadata: this.buildParentProviderMetadata(sdkParentToolUseId)
    })
  }

  private handleContentBlockDelta(event: BetaRawContentBlockDeltaEvent, ctx: StreamContext): void {
    ctx.hasReceivedStreamEvents = true
    switch (event.delta.type) {
      case 'text_delta':
        this.handleTextDelta(event.delta.text, ctx)
        break
      case 'input_json_delta':
        this.handleInputJsonDelta(event.delta.partial_json, event.index, ctx)
        break
      case 'thinking_delta':
        this.handleThinkingDelta(event.delta.thinking, event.index, ctx)
        break
      case 'signature_delta':
      case 'citations_delta':
        break
    }
  }

  private handleTextDelta(text: string, ctx: StreamContext): void {
    if (!text) return

    if (ctx.options.responseFormat?.type === 'json') {
      ctx.accumulatedText += text
      ctx.streamedTextLength += text.length
      return
    }

    if (!ctx.textPartId) {
      ctx.textPartId = generateId()
      ctx.sink.enqueue({ type: 'text-start', id: ctx.textPartId })
    }
    ctx.sink.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: text })
    ctx.accumulatedText += text
    ctx.streamedTextLength += text.length
  }

  private handleInputJsonDelta(partialJson: string, blockIndex: number, ctx: StreamContext): void {
    if (!partialJson) return

    if (ctx.options.responseFormat?.type === 'json') {
      if (!ctx.textPartId) {
        ctx.textPartId = generateId()
        ctx.sink.enqueue({ type: 'text-start', id: ctx.textPartId })
      }
      ctx.sink.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: partialJson })
      ctx.accumulatedText += partialJson
      ctx.streamedTextLength += partialJson.length
      ctx.hasStreamedJson = true
      return
    }

    const toolId = ctx.toolBlocksByIndex.get(blockIndex)
    if (toolId) {
      const accumulated = (ctx.toolInputAccumulators.get(toolId) ?? '') + partialJson
      ctx.toolInputAccumulators.set(toolId, accumulated)
      ctx.sink.enqueue({ type: 'tool-input-delta', toolCallId: toolId, inputTextDelta: partialJson })
    }
  }

  private handleThinkingDelta(thinking: string, blockIndex: number, ctx: StreamContext): void {
    if (!thinking) return
    const reasoningPartId = ctx.reasoningBlocksByIndex.get(blockIndex) ?? ctx.currentReasoningPartId
    if (reasoningPartId) {
      ctx.sink.enqueue({ type: 'reasoning-delta', id: reasoningPartId, delta: thinking })
    }
  }

  private handleContentBlockStop(event: BetaRawContentBlockStopEvent, ctx: StreamContext): void {
    ctx.hasReceivedStreamEvents = true
    const blockIndex = event.index

    const toolId = ctx.toolBlocksByIndex.get(blockIndex)
    if (toolId) {
      this.handleToolBlockStop(toolId, blockIndex, ctx)
      return
    }

    const textId = ctx.textBlocksByIndex.get(blockIndex)
    if (textId) {
      ctx.sink.enqueue({ type: 'text-end', id: textId })
      ctx.textBlocksByIndex.delete(blockIndex)
      if (ctx.textPartId === textId) ctx.textPartId = undefined
      return
    }

    const reasoningPartId = ctx.reasoningBlocksByIndex.get(blockIndex)
    if (reasoningPartId) {
      ctx.sink.enqueue({ type: 'reasoning-end', id: reasoningPartId })
      ctx.reasoningBlocksByIndex.delete(blockIndex)
      if (ctx.currentReasoningPartId === reasoningPartId) ctx.currentReasoningPartId = undefined
    }
  }

  private handleToolBlockStop(toolId: string, blockIndex: number, ctx: StreamContext): void {
    const state = ctx.toolStates.get(toolId)
    if (state && !state.inputClosed) {
      const accumulatedInput = ctx.toolInputAccumulators.get(toolId) ?? ''
      state.inputClosed = true
      const effectiveInput = accumulatedInput || state.lastSerializedInput || ''
      state.lastSerializedInput = effectiveInput

      if (!state.callEmitted) {
        this.emitToolInputAvailable(toolId, state, ctx)
      }
    }
    ctx.toolBlocksByIndex.delete(blockIndex)
    ctx.toolInputAccumulators.delete(toolId)
  }

  private handleMessageDelta(_event: BetaRawMessageDeltaEvent, ctx: StreamContext): void {
    ctx.hasReceivedStreamEvents = true
  }

  private handleAssistantMessage(message: SDKAssistantMessage, ctx: StreamContext): void {
    if (!message.message?.content) return

    const sdkParentToolUseId = message.parent_tool_use_id
    const content = message.message.content
    const tools = this.extractToolUses(content)
    const results = this.extractToolResults(content)

    if (ctx.textPartId && (tools.length > 0 || results.length > 0)) {
      this.closeActiveTextPart(ctx)
    }

    for (const tool of tools) {
      this.handleAssistantToolUse(tool, sdkParentToolUseId, ctx)
    }

    for (const result of results) {
      this.handleToolResult(result, sdkParentToolUseId, ctx)
    }

    const text = content.map((c: BetaContentBlock) => (c.type === 'text' ? c.text : '')).join('')

    if (text) {
      this.handleAssistantText(text, sdkParentToolUseId, ctx)
    }
  }

  private handleAssistantToolUse(
    tool: ClaudeToolUseBlock,
    sdkParentToolUseId: SDKParentToolUseId,
    ctx: StreamContext
  ): void {
    const toolId = tool.id
    let state = ctx.toolStates.get(toolId)
    if (!state) {
      const currentParentId = isSubagentToolName(tool.name)
        ? null
        : (sdkParentToolUseId ?? this.getFallbackParentId(ctx))
      state = {
        name: tool.name,
        inputStarted: false,
        inputClosed: false,
        callEmitted: false,
        parentToolCallId: currentParentId,
        ...this.getToolUseMetadata(tool)
      }
      ctx.toolStates.set(toolId, state)
    } else if (!state.parentToolCallId && sdkParentToolUseId && !isSubagentToolName(tool.name)) {
      state.parentToolCallId = sdkParentToolUseId
    }
    state.name = tool.name
    this.mergeToolMetadata(state, this.getToolUseMetadata(tool))
    this.mergeToolDisplayMetadata(state)

    if (!state.inputStarted) {
      ctx.sink.enqueue({
        type: 'tool-input-start',
        toolCallId: toolId,
        toolName: tool.name,
        providerExecuted: true,
        dynamic: true,
        title: this.getToolTitle(state),
        providerMetadata: this.buildToolProviderMetadata(state)
      })
      if (isSubagentToolName(tool.name)) ctx.activeTaskTools.set(toolId, { startTime: Date.now() })
      state.inputStarted = true
    }

    const serializedInput = this.serializeToolInput(tool.input)
    if (serializedInput) {
      let deltaPayload = ''
      if (state.lastSerializedInput === undefined) {
        if (serializedInput.length <= MAX_DELTA_CALC_SIZE) deltaPayload = serializedInput
      } else if (
        serializedInput.length <= MAX_DELTA_CALC_SIZE &&
        state.lastSerializedInput.length <= MAX_DELTA_CALC_SIZE &&
        serializedInput.startsWith(state.lastSerializedInput)
      ) {
        deltaPayload = serializedInput.slice(state.lastSerializedInput.length)
      } else if (serializedInput !== state.lastSerializedInput) {
        deltaPayload = ''
      }
      if (deltaPayload) {
        ctx.sink.enqueue({ type: 'tool-input-delta', toolCallId: toolId, inputTextDelta: deltaPayload })
      }
      state.lastSerializedInput = serializedInput
    }
  }

  private handleAssistantText(text: string, sdkParentToolUseId: SDKParentToolUseId, ctx: StreamContext): void {
    const providerMetadata = this.buildParentProviderMetadata(sdkParentToolUseId)
    if (ctx.hasReceivedStreamEvents) {
      const newTextStart = ctx.streamedTextLength
      const deltaText = text.length > newTextStart ? text.slice(newTextStart) : ''
      ctx.accumulatedText = text

      if (ctx.options.responseFormat?.type !== 'json' && deltaText) {
        if (!ctx.textPartId) {
          ctx.textPartId = generateId()
          ctx.sink.enqueue({ type: 'text-start', id: ctx.textPartId, providerMetadata })
        }
        ctx.sink.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: deltaText })
      }
      ctx.streamedTextLength = text.length
    } else {
      ctx.accumulatedText += text
      if (ctx.options.responseFormat?.type !== 'json') {
        if (!ctx.textPartId) {
          ctx.textPartId = generateId()
          ctx.sink.enqueue({ type: 'text-start', id: ctx.textPartId, providerMetadata })
        }
        ctx.sink.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: text })
      }
    }
  }

  private handleUserMessage(message: SDKUserMessage, ctx: StreamContext): void {
    if (!message.message?.content) return

    if (ctx.textPartId) {
      this.closeActiveTextPart(ctx)
      ctx.accumulatedText = ''
      ctx.streamedTextLength = 0
    }

    const sdkParentToolUseId = message.parent_tool_use_id
    const content = message.message.content

    for (const result of this.extractToolResults(content)) {
      this.handleToolResult(result, sdkParentToolUseId, ctx)
    }
  }

  private handleToolResult(
    result: ClaudeToolResultBlock,
    sdkParentToolUseId: SDKParentToolUseId,
    ctx: StreamContext
  ): void {
    if (ctx.toolResultsEmitted.has(result.tool_use_id)) return

    let state = ctx.toolStates.get(result.tool_use_id)
    const toolName = state?.name ?? this.getToolNameFromResultType(result.type) ?? UNKNOWN_TOOL_NAME

    if (!state) {
      const resolvedParentId = isSubagentToolName(toolName)
        ? null
        : (sdkParentToolUseId ?? this.getFallbackParentId(ctx))
      state = {
        name: toolName,
        inputStarted: false,
        inputClosed: false,
        callEmitted: false,
        parentToolCallId: resolvedParentId
      }
      ctx.toolStates.set(result.tool_use_id, state)
    }
    state.name = toolName

    const normalizedResult = this.normalizeToolResult(result.content)
    const rawResult =
      typeof result.content === 'string'
        ? result.content
        : (() => {
            try {
              return JSON.stringify(result.content)
            } catch {
              return String(result.content)
            }
          })()

    this.emitToolCall(result.tool_use_id, state, ctx)
    if (isSubagentToolName(toolName)) ctx.activeTaskTools.delete(result.tool_use_id)

    const providerMetadata = this.buildToolProviderMetadata(state, {
      rawResult
    })
    const isError = this.isToolResultError(result)
    if (isError) {
      ctx.sink.enqueue({
        type: 'tool-output-error',
        toolCallId: result.tool_use_id,
        errorText: rawResult,
        dynamic: true,
        providerExecuted: true,
        providerMetadata
      })
    } else {
      ctx.sink.enqueue({
        type: 'tool-output-available',
        toolCallId: result.tool_use_id,
        output: this.buildToolOutput(normalizedResult, state),
        dynamic: true,
        providerExecuted: true,
        providerMetadata
      })
    }
    ctx.toolResultsEmitted.add(result.tool_use_id)
  }

  private handleResultMessage(message: SDKResultMessage, ctx: StreamContext): void {
    logger.info(
      `Stream completed - Session: ${message.session_id}, Cost: $${message.total_cost_usd?.toFixed(4) ?? 'N/A'}, Duration: ${message.duration_ms ?? 'N/A'}ms`
    )

    ctx.usage = convertClaudeCodeUsage(message.usage)
    const finishReason = mapClaudeCodeFinishReason(message.subtype, message.stop_reason)
    this.setSessionId(message.session_id)

    if (message.subtype !== 'success') {
      const errorMsg = message.errors.join('; ') || `Claude Code error: ${message.subtype}`
      throw Object.assign(new Error(errorMsg), { exitCode: 1, subtype: message.subtype })
    }

    const structuredOutput = message.structured_output
    const alreadyStreamedJson =
      ctx.hasStreamedJson && ctx.options.responseFormat?.type === 'json' && ctx.hasReceivedStreamEvents

    if (alreadyStreamedJson) {
      if (ctx.textPartId) ctx.sink.enqueue({ type: 'text-end', id: ctx.textPartId })
    } else if (structuredOutput !== undefined) {
      const jsonTextId = generateId()
      const jsonText = JSON.stringify(structuredOutput)
      ctx.sink.enqueue({ type: 'text-start', id: jsonTextId })
      ctx.sink.enqueue({ type: 'text-delta', id: jsonTextId, delta: jsonText })
      ctx.sink.enqueue({ type: 'text-end', id: jsonTextId })
    } else if (ctx.textPartId) {
      ctx.sink.enqueue({ type: 'text-end', id: ctx.textPartId })
    } else if (ctx.accumulatedText && !ctx.textStreamedViaContentBlock) {
      const fallbackTextId = generateId()
      ctx.sink.enqueue({ type: 'text-start', id: fallbackTextId })
      ctx.sink.enqueue({ type: 'text-delta', id: fallbackTextId, delta: ctx.accumulatedText })
      ctx.sink.enqueue({ type: 'text-end', id: fallbackTextId })
    }

    this.finalizeToolCalls(ctx)

    ctx.sink.enqueue({
      type: 'finish',
      finishReason: finishReason.unified,
      messageMetadata: this.buildMessageMetadata(ctx.usage)
    })
  }

  private handleSystemMessage(message: Extract<SDKMessage, { type: 'system' }>, ctx: StreamContext): void {
    switch (message.subtype) {
      case 'init':
        this.handleInitSystemMessage(message, ctx)
        return
      case 'task_started':
      case 'task_progress':
      case 'task_updated':
      case 'task_notification':
        this.handleTaskSystemMessage(message, ctx)
        return
      case 'status':
        this.handleStatusSystemMessage(message)
        return
      case 'compact_boundary':
        this.handleCompactBoundarySystemMessage()
        return
      case 'thinking_tokens':
        this.handleThinkingTokensSystemMessage(message, ctx)
        return
      case 'api_retry':
      case 'hook_started':
      case 'hook_progress':
      case 'hook_response':
      case 'session_state_changed':
      case 'permission_denied':
      case 'memory_recall':
      case 'local_command_output':
      case 'elicitation_complete':
      case 'commands_changed':
      case 'files_persisted':
      case 'mirror_error':
      case 'notification':
      case 'plugin_install':
        // TODO: Implement handling for these system message subtypes as needed. For now, they are acknowledged at debug level in the logger to avoid being silently ignored.
        logger.debug(`Received system message subtype: ${message.subtype}`, { message })
        return
    }
  }

  private handleInitSystemMessage(message: Extract<SDKMessage, { subtype: 'init' }>, ctx: StreamContext): void {
    this.logMcpConnectionIssues(message.mcp_servers)
    this.setSessionId(message.session_id)
    logger.info(`Stream session initialized: ${message.session_id}`)
    ctx.sink.enqueue({ type: 'message-metadata', messageMetadata: { modelId: this.modelId } })
  }

  private handleTaskSystemMessage(message: SDKTaskSystemMessage, ctx: StreamContext): void {
    const eventData = this.toTaskEventPartData(message)

    ctx.sink.enqueue({
      type: 'data-agent-task-event',
      id: `task-${eventData.taskId}-${eventData.event}-${message.uuid}`,
      data: eventData
    })
  }

  private handleStatusSystemMessage(message: SDKStatusMessage): void {
    // Defensive fallback for future non-driver consumers. ClaudeCodeRuntimeDriver intercepts
    // compaction status before this adapter and emits the runtime state itself.
    if (message.status === 'compacting') return
    if (message.compact_result === 'failed' || message.compact_error) {
      logger.warn('Claude compaction failed', { sessionId: message.session_id, error: message.compact_error })
    }
  }

  private handleCompactBoundarySystemMessage(): void {
    // Defensive fallback for future non-driver consumers. The current driver path intercepts
    // compact_boundary before this adapter, so no assistant stream chunk is emitted here.
  }

  private handleThinkingTokensSystemMessage(message: SDKThinkingTokensMessage, ctx: StreamContext): void {
    ctx.sink.enqueue({
      type: 'message-metadata',
      messageMetadata: {
        thoughtsTokens: message.estimated_tokens
      }
    })
  }

  private toTaskEventPartData(message: SDKTaskSystemMessage): AgentTaskEventPartData {
    const base = {
      taskId: message.task_id,
      toolUseId: 'tool_use_id' in message ? message.tool_use_id : undefined
    }

    switch (message.subtype) {
      case 'task_started':
        return {
          ...base,
          event: 'started',
          status: 'in_progress',
          title: message.description,
          activeText: message.description,
          description: message.description,
          subagentType: message.subagent_type,
          taskType: message.task_type,
          workflowName: message.workflow_name,
          prompt: message.prompt,
          skipTranscript: message.skip_transcript === true
        }
      case 'task_progress':
        return {
          ...base,
          event: 'progress',
          status: 'in_progress',
          title: message.summary ?? message.description,
          activeText: message.description,
          description: message.description,
          summary: message.summary,
          subagentType: message.subagent_type,
          lastToolName: message.last_tool_name,
          usage: this.getTaskUsage(message.usage)
        }
      case 'task_updated': {
        const status = mapTaskStatus(message.patch.status)
        return {
          ...base,
          event: 'updated',
          status,
          title: message.patch.description,
          activeText: status === 'in_progress' ? message.patch.description : undefined,
          description: message.patch.description,
          error: message.patch.error
        }
      }
      case 'task_notification':
        return {
          ...base,
          event: 'notification',
          status: mapTaskStatus(message.status),
          title: message.summary,
          summary: message.summary,
          outputFile: message.output_file,
          skipTranscript: message.skip_transcript === true,
          usage: this.getTaskUsage(message.usage)
        }
    }
  }

  private getTaskUsage(
    value: SDKTaskNotificationMessage['usage'] | SDKTaskProgressMessage['usage'] | undefined
  ): AgentTaskEventPartData['usage'] | undefined {
    if (!value) return undefined
    return {
      totalTokens: value.total_tokens,
      toolUses: value.tool_uses,
      durationMs: value.duration_ms
    }
  }

  private extractToolUses(content: BetaContentBlock[]): ClaudeToolUseBlock[] {
    const tools: ClaudeToolUseBlock[] = []
    for (const block of content) {
      switch (block.type) {
        case 'tool_use':
        case 'server_tool_use':
        case 'mcp_tool_use':
          tools.push(block)
          break
      }
    }
    return tools
  }

  private extractToolResults(
    content: string | Array<BetaContentBlock | BetaContentBlockParam>
  ): ClaudeToolResultBlock[] {
    if (!Array.isArray(content)) return []
    const results: ClaudeToolResultBlock[] = []
    for (const block of content) {
      switch (block.type) {
        case 'tool_result':
        case 'mcp_tool_result':
        case 'web_search_tool_result':
        case 'web_fetch_tool_result':
        case 'code_execution_tool_result':
        case 'bash_code_execution_tool_result':
        case 'text_editor_code_execution_tool_result':
        case 'tool_search_tool_result':
          results.push(block)
          break
      }
    }
    return results
  }

  private serializeToolInput(input: unknown): string {
    if (typeof input === 'string') return this.checkInputSize(input)
    if (input === undefined) return ''
    try {
      return this.checkInputSize(JSON.stringify(input))
    } catch {
      return this.checkInputSize(String(input))
    }
  }

  private checkInputSize(str: string): string {
    if (str.length > MAX_TOOL_INPUT_SIZE) {
      throw new Error(`Tool input exceeds maximum size of ${MAX_TOOL_INPUT_SIZE} bytes (got ${str.length} bytes).`)
    }
    if (str.length > MAX_TOOL_INPUT_WARN) {
      logger.warn(`Large tool input detected: ${str.length} bytes. Performance may be impacted.`)
    }
    return str
  }

  private normalizeToolResult(result: unknown): NonNullable<JSONValue> {
    if (typeof result === 'string') {
      try {
        return JSON.parse(result)
      } catch {
        return result
      }
    }
    if (Array.isArray(result) && result.length > 0) {
      const textBlocks = result
        .filter((b): b is { type: 'text'; text: string } => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)

      if (textBlocks.length !== result.length) return JSON.parse(JSON.stringify(result))
      const combined = textBlocks.join('\n')
      try {
        return JSON.parse(combined)
      } catch {
        return combined
      }
    }
    return typeof result === 'object' && result !== null ? JSON.parse(JSON.stringify(result)) : String(result ?? '')
  }
  private deserializeToolInput(input: string | undefined): unknown {
    if (!input) return {}
    try {
      return JSON.parse(input)
    } catch {
      return input
    }
  }

  private getToolUseMetadata(
    tool: Pick<ClaudeToolUseBlock, 'name' | 'type'> & { server_name?: string }
  ): Pick<ToolStreamState, 'sdkBlockType' | 'serverName' | 'serverId' | 'toolType'> {
    if (tool.type === 'mcp_tool_use') {
      const serverName = typeof tool.server_name === 'string' ? tool.server_name : undefined
      return {
        sdkBlockType: tool.type,
        serverName,
        serverId: serverName,
        toolType: 'mcp'
      }
    }
    const parsed = parseFunctionCallToolName(tool.name)
    if (parsed) {
      return {
        sdkBlockType: tool.type,
        serverName: parsed.serverPart,
        serverId: parsed.serverPart,
        toolType: 'mcp'
      }
    }
    return {
      sdkBlockType: tool.type,
      toolType: 'provider'
    }
  }

  private mergeToolMetadata(
    state: ToolStreamState,
    metadata: Pick<ToolStreamState, 'sdkBlockType' | 'serverName' | 'serverId' | 'toolType'>
  ): void {
    state.sdkBlockType = metadata.sdkBlockType ?? state.sdkBlockType
    state.serverName = metadata.serverName ?? state.serverName
    state.serverId = metadata.serverId ?? state.serverId
    state.toolType = metadata.toolType ?? state.toolType
  }

  private resolveMcpToolDisplayMetadata(state: ToolStreamState): McpToolDisplayMetadata | undefined {
    if (state.toolType !== 'mcp' && !parseFunctionCallToolName(state.name)) return undefined
    return (
      this.mcpToolMetadata[state.name] ??
      (state.serverId ? this.mcpToolMetadata[`mcp__${state.serverId}__${state.name}`] : undefined) ??
      (state.serverName ? this.mcpToolMetadata[`mcp__${state.serverName}__${state.name}`] : undefined)
    )
  }

  private mergeToolDisplayMetadata(state: ToolStreamState): void {
    const parsed = parseFunctionCallToolName(state.name)
    if (parsed) {
      state.toolType = 'mcp'
      state.serverName = state.serverName ?? parsed.serverPart
      state.serverId = state.serverId ?? parsed.serverPart
      state.displayName = state.displayName ?? parsed.toolPart
    }

    const metadata = this.resolveMcpToolDisplayMetadata(state)
    if (!metadata) return

    state.toolType = 'mcp'
    state.serverName = metadata.serverName
    state.serverId = metadata.serverId
    state.displayName = metadata.name
    state.description = metadata.description
  }

  private getToolTitle(state: ToolStreamState): string | undefined {
    const toolName = state.displayName ?? state.name
    return state.toolType === 'mcp' && state.serverName ? `${state.serverName}: ${toolName}` : undefined
  }

  private buildParentProviderMetadata(sdkParentToolUseId: SDKParentToolUseId): Record<string, JSONObject> | undefined {
    if (!sdkParentToolUseId) return undefined
    return {
      'claude-code': {
        parentToolCallId: sdkParentToolUseId
      },
      cherry: {
        transport: 'claude-agent'
      }
    }
  }

  private buildToolProviderMetadata(
    state: ToolStreamState,
    extra: Record<string, JSONValue | undefined> = {}
  ): Record<string, JSONObject> {
    const claudeCode: JSONObject = {
      parentToolCallId: state.parentToolCallId ?? null,
      ...(state.sdkBlockType ? { sdkBlockType: state.sdkBlockType } : {}),
      ...(state.serverName ? { serverName: state.serverName } : {}),
      ...(state.serverId ? { serverId: state.serverId } : {})
    }
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) claudeCode[key] = value
    }

    return {
      'claude-code': claudeCode,
      cherry: {
        transport: 'claude-agent',
        tool: {
          type: state.toolType ?? 'provider',
          ...(state.displayName ? { name: state.displayName } : {}),
          ...(state.description ? { description: state.description } : {}),
          ...(state.serverName ? { serverName: state.serverName } : {}),
          ...(state.serverId ? { serverId: state.serverId } : {})
        }
      }
    }
  }

  private buildToolOutput(result: NonNullable<JSONValue>, state: ToolStreamState): NonNullable<JSONValue> {
    if (state.toolType !== 'mcp') return result
    return {
      content: result,
      metadata: {
        type: 'mcp',
        ...(state.displayName ? { name: state.displayName } : {}),
        ...(state.description ? { description: state.description } : {}),
        serverName: state.serverName ?? 'MCP',
        serverId: state.serverId ?? state.serverName ?? 'unknown'
      }
    }
  }

  private getToolNameFromResultType(type: string): string | undefined {
    switch (type) {
      case 'mcp_tool_result':
        return 'mcp_tool'
      case 'web_search_tool_result':
        return 'web_search'
      case 'web_fetch_tool_result':
        return 'web_fetch'
      case 'code_execution_tool_result':
        return 'code_execution'
      case 'bash_code_execution_tool_result':
        return 'bash_code_execution'
      case 'text_editor_code_execution_tool_result':
        return 'text_editor_code_execution'
      case 'tool_search_tool_result':
        return 'tool_search'
      default:
        return undefined
    }
  }

  private isToolResultError(result: ClaudeToolResultBlock): boolean {
    if ('is_error' in result && result.is_error === true) return true
    const content = result.content
    if (
      typeof content === 'object' &&
      content !== null &&
      !Array.isArray(content) &&
      typeof content.type === 'string'
    ) {
      return content.type.endsWith('_error')
    }
    return false
  }

  private logMcpConnectionIssues(
    mcpServers: Array<{ name?: string; status?: string; error?: string }> | undefined
  ): void {
    if (!Array.isArray(mcpServers) || mcpServers.length === 0) return

    const needsAttention = mcpServers.filter((s) => {
      const status = typeof s.status === 'string' ? s.status.toLowerCase() : ''
      return status === 'failed' || status === 'needs-auth'
    })
    if (needsAttention.length === 0) return

    const details = needsAttention
      .map((s) => {
        const name = typeof s.name === 'string' && s.name.trim() ? s.name : '<unknown>'
        const status = typeof s.status === 'string' && s.status.trim() ? s.status : 'unknown'
        const error = typeof s.error === 'string' && s.error.trim() ? ` (${s.error})` : ''
        return `${name}:${status}${error}`
      })
      .join(', ')
    logger.warn(`MCP servers not connected: ${details}`)
  }

  private getFallbackParentId(ctx: StreamContext): string | null {
    if (ctx.activeTaskTools.size === 1) {
      return ctx.activeTaskTools.keys().next().value ?? null
    }
    return null
  }

  private closeActiveTextPart(ctx: StreamContext): void {
    if (!ctx.textPartId) return
    const closedTextId = ctx.textPartId
    ctx.sink.enqueue({ type: 'text-end', id: closedTextId })
    ctx.textPartId = undefined
    for (const [idx, blockTextId] of ctx.textBlocksByIndex) {
      if (blockTextId === closedTextId) {
        ctx.textBlocksByIndex.delete(idx)
        break
      }
    }
  }

  private emitToolCall(toolId: string, state: ToolStreamState, ctx: StreamContext): void {
    if (state.callEmitted) return
    this.emitToolInputAvailable(toolId, state, ctx)
  }

  private emitToolInputAvailable(toolId: string, state: ToolStreamState, ctx: StreamContext): void {
    if (state.callEmitted) return
    const serializedInput = state.lastSerializedInput ?? ''
    ctx.sink.enqueue({
      type: 'tool-input-available',
      toolCallId: toolId,
      toolName: state.name,
      input: this.deserializeToolInput(serializedInput),
      providerExecuted: true,
      dynamic: true,
      title: this.getToolTitle(state),
      providerMetadata: this.buildToolProviderMetadata(state, { rawInput: serializedInput })
    })
    state.inputStarted = true
    state.inputClosed = true
    state.callEmitted = true
  }

  private finalizeToolCalls(ctx: StreamContext): void {
    for (const [toolId, state] of ctx.toolStates) {
      this.emitToolCall(toolId, state, ctx)
    }
    ctx.toolStates.clear()
  }

  private setSessionId(sessionId: string): void {
    this.onSessionId?.(sessionId)
  }

  private buildMessageMetadata(usage: LanguageModelV3Usage): CherryUIMessageMetadata {
    const promptTokens = usage.inputTokens.total ?? 0
    const completionTokens = usage.outputTokens.total ?? 0
    const thoughtsTokens = usage.outputTokens.reasoning
    return {
      modelId: this.modelId,
      totalTokens: promptTokens + completionTokens,
      promptTokens,
      completionTokens,
      ...(thoughtsTokens !== undefined ? { thoughtsTokens } : {})
    }
  }
}
