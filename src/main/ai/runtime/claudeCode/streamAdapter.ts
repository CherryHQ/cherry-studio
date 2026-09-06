import type {
  JSONObject,
  JSONValue,
  LanguageModelV3,
  LanguageModelV3FinishReason,
  LanguageModelV3Usage
} from '@ai-sdk/provider'
import { generateId } from '@ai-sdk/provider-utils'
import type {
  SDKAPIRetryMessage,
  SDKAssistantMessage,
  SDKCompactBoundaryMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKSessionStateChangedMessage,
  SDKStatusMessage,
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
  SDKTaskUpdatedMessage,
  SDKThinkingTokensMessage,
  SDKToolProgressMessage,
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
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { loggerService } from '@logger'
import { extractSystemReminderBodies, SystemReminderTextFilter } from '@main/ai/steerReminder'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentSessionBackgroundTask } from '@shared/ai/agentSessionBackgroundTasks'
import type { AgentSessionCompactionAnchorData } from '@shared/ai/agentSessionCompaction'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { CherryUIMessageChunk, CherryUIMessageMetadata, MessageStats } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'
import { isMcpContentBlock } from '@shared/utils/mcp'

import type { AgentRuntimeEvent } from '../types'
import type { McpToolDisplayMetadata } from './types'

const logger = loggerService.withContext('ClaudeCodeStreamAdapter')

/**
 * A failed `SDKResultMessage` surfaced as a throw. Carries the result's typed fields so consumers
 * narrow with `instanceof` and read structure — never by parsing the message prose (the SDK
 * provides no error class of its own for result failures).
 */
export class ClaudeCodeResultError extends Error {
  readonly exitCode = 1
  constructor(
    message: string,
    readonly subtype: SDKResultMessage['subtype'],
    /** The result's diagnostic strings — match against these, not the joined `message`. */
    readonly errors: readonly string[],
    readonly terminalReason?: SDKResultMessage['terminal_reason'],
    readonly apiErrorStatus?: number | null
  ) {
    super(message)
    this.name = 'ClaudeCodeResultError'
  }
}

function createClaudeCodeResultError(message: SDKResultMessage): ClaudeCodeResultError | undefined {
  const apiErrorStatus = message.subtype === 'success' ? message.api_error_status : undefined
  const isErrorResult =
    message.subtype !== 'success' ||
    message.is_error ||
    message.terminal_reason === 'api_error' ||
    apiErrorStatus != null
  if (!isErrorResult) return undefined

  const errors = message.subtype === 'success' ? (message.result ? [message.result] : []) : message.errors
  const errorMessage = errors.join('; ') || `Claude Code error: ${message.terminal_reason ?? message.subtype}`
  return new ClaudeCodeResultError(errorMessage, message.subtype, errors, message.terminal_reason, apiErrorStatus)
}

const MIN_TRUNCATION_LENGTH = 512
const UNKNOWN_TOOL_NAME = 'unknown-tool'
const MAX_TOOL_INPUT_SIZE = 1_048_576
const MAX_TOOL_INPUT_WARN = 102_400
const MAX_DELTA_CALC_SIZE = 10_000

// ── Internal types ──────────────────────────────────────────────────

type BetaUsage = SDKResultMessage['usage']
type SdkParentToolUseId = SDKAssistantMessage['parent_tool_use_id']
type SdkTaskSystemMessage =
  | SDKTaskNotificationMessage
  | SDKTaskProgressMessage
  | SDKTaskStartedMessage
  | SDKTaskUpdatedMessage
type SdkRuntimeSystemMessage = Extract<SDKMessage, { type: 'system' }>
type SdkTaskStatus = SDKTaskNotificationMessage['status'] | SDKTaskUpdatedMessage['patch']['status'] | undefined
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
  sink: StreamSink & { redirect(sink: StreamSink): void }
  systemReminderBodies: Set<string>
  options: Parameters<LanguageModelV3['doStream']>[0]
  toolStates: Map<string, ToolStreamState>
  activeTaskTools: Map<string, { startTime: number }>
  toolBlocksByIndex: Map<number, string>
  toolInputAccumulators: Map<string, string>
  toolResultsEmitted: Set<string>
  /** Tool calls the CLI auto-denied (`system/permission_denied`), reported as denied rather than failed. */
  deniedToolUseIds: Set<string>
  /** Set when the SDK flags an assistant message as interrupt-truncated (`aborted`). */
  sawAbortedMessage: boolean
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

/**
 * Session-scoped status the adapter reports outside the turn's message stream. Unlike `sink`, this
 * has no turn dependency — background work outlives the turn that spawned it, so its signals must
 * still be deliverable once that turn's stream is gone.
 */
export type ClaudeCodeStreamStatusEvent = Extract<
  AgentRuntimeEvent,
  {
    type:
      | 'supported-commands'
      | 'background-tasks'
      | 'background-work-state'
      | 'compaction-start'
      | 'compaction-complete'
      | 'compaction-error'
      | 'api-retry'
      | 'background-task-event'
      | 'background-flow-chunk'
      | 'autonomous-turn-state'
  }
>

type StatusSink = {
  emit(event: ClaudeCodeStreamStatusEvent): void
}

type FlowContext = {
  rootToolCallId: string
  stream: StreamContext
}

export type ClaudeCodeStreamAdapterOptions = {
  modelId: string
  /** Cherry session id — for logs only; `onSessionId` reports the runtime's own id. */
  sessionId: string
  streamOptions: Parameters<LanguageModelV3['doStream']>[0]
  sink: StreamSink
  statusSink: StatusSink
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

function getToolParentId(
  toolName: string,
  sdkParentToolUseId: SdkParentToolUseId,
  fallbackParentToolCallId: string | null
): string | null {
  if (sdkParentToolUseId) return sdkParentToolUseId
  return isSubagentToolName(toolName) ? null : fallbackParentToolCallId
}

function getLaunchedBackgroundTaskId(result: unknown): string | undefined {
  if (!isRecord(result) || (result.status !== 'async_launched' && result.status !== 'remote_launched')) {
    return undefined
  }
  const id = result.taskId ?? result.agentId
  return typeof id === 'string' && id ? id : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function summarizeSdkContentBlock(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { type: typeof value }

  const summary: Record<string, unknown> = {
    type: typeof value.type === 'string' ? value.type : 'unknown'
  }
  for (const key of ['id', 'name', 'tool_use_id', 'server_name', 'server_tool_use_id'] as const) {
    if (typeof value[key] === 'string') summary[key] = value[key]
  }
  if (typeof value.is_error === 'boolean') summary.is_error = value.is_error
  return summary
}

/**
 * Keep the SDK wire log useful for parent/child correlation without persisting user text, prompts,
 * tool inputs or streamed deltas. In particular, Workflow debugging needs every envelope and stable
 * id, not the potentially sensitive payload carried by that envelope.
 */
function summarizeSdkMessage(message: SDKMessage): Record<string, unknown> {
  const raw = message as unknown as Record<string, unknown>
  const summary: Record<string, unknown> = {
    type: message.type,
    uuid: raw.uuid,
    sdkSessionId: raw.session_id
  }

  for (const key of [
    'subtype',
    'parent_tool_use_id',
    'tool_use_id',
    'tool_name',
    'task_id',
    'task_type',
    'workflow_name',
    'agent_id',
    'subagent_type',
    'state',
    'status'
  ] as const) {
    const value = raw[key]
    if (typeof value === 'string' || value === null) summary[key] = value
  }

  if (message.type === 'stream_event') {
    const event = message.event as unknown as Record<string, unknown>
    summary.streamEvent = {
      type: event.type,
      index: event.index,
      contentBlock: summarizeSdkContentBlock(event.content_block),
      deltaType: isRecord(event.delta) ? event.delta.type : undefined
    }
  } else if (message.type === 'assistant' || message.type === 'user') {
    const sdkMessage = raw.message
    const content = isRecord(sdkMessage) && Array.isArray(sdkMessage.content) ? sdkMessage.content : []
    summary.contentBlocks = content.map(summarizeSdkContentBlock)
  } else if (message.type === 'system' && Array.isArray(raw.tasks)) {
    summary.tasks = raw.tasks.map((task) => {
      if (!isRecord(task)) return { type: typeof task }
      return {
        taskId: task.task_id,
        taskType: task.task_type
      }
    })
  }

  return summary
}

function stringifyJsonValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getContentArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (isRecord(value) && Array.isArray(value.content)) return value.content
  return undefined
}

function getTextContent(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return (getContentArray(value) ?? []).flatMap((block) => {
    if (!isRecord(block)) return []
    if (block.type === 'text' && typeof block.text === 'string') return [block.text]
    return getTextContent(block.content)
  })
}

function normalizeMcpContentBlock(block: unknown): JSONObject {
  if (isMcpContentBlock(block)) return block as JSONObject

  if (!isRecord(block)) {
    return { type: 'text', text: stringifyJsonValue(block) }
  }

  if (block.type === 'image') {
    const source = block.source
    if (isRecord(source) && source.type === 'base64' && typeof source.data === 'string') {
      return {
        type: 'image',
        data: source.data,
        mimeType: typeof source.media_type === 'string' ? source.media_type : 'image/png'
      }
    }
  }

  return { type: 'text', text: stringifyJsonValue(block) }
}

function normalizeMcpToolContent(value: unknown): JSONValue[] {
  const content = getContentArray(value)
  if (content) return content.map(normalizeMcpContentBlock)

  return [{ type: 'text', text: stringifyJsonValue(value) }]
}

function hasMcpNonTextContent(value: unknown): boolean {
  const content = getContentArray(value)
  if (!content) return false

  return content.some((block) => {
    if (!isRecord(block)) return false
    if (block.type === 'image' || block.type === 'audio') return true
    return block.type === 'resource' && isRecord(block.resource) && typeof block.resource.blob === 'string'
  })
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

/** Drop `undefined`-valued keys; return `undefined` when nothing is left. */
function compactDetails<T extends Record<string, number | undefined>>(obj: T): { [K in keyof T]?: number } | undefined {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'number') out[key] = value
  }
  return Object.keys(out).length > 0 ? (out as { [K in keyof T]?: number }) : undefined
}

/**
 * Project a `LanguageModelV3Usage` into the live `MessageStats` token shape
 * carried by stream metadata (AI SDK v6 names). Top-level `inputTokens`
 * follows the v6 semantic of TOTAL input (cache reads and writes included) —
 * matching the SDK's own `asLanguageModelUsage` projection; the cache
 * breakdown lives in `inputTokenDetails`, and `totalTokens` is the all-in
 * figure. Persistent usage and cost come from per-invocation records instead.
 */
export function v3UsageToStats(usage: LanguageModelV3Usage): MessageStats {
  const inputTotal = usage.inputTokens.total ?? 0
  const outputTotal = usage.outputTokens.total ?? 0
  const inputTokenDetails = compactDetails({
    noCacheTokens: usage.inputTokens.noCache,
    cacheReadTokens: usage.inputTokens.cacheRead,
    cacheWriteTokens: usage.inputTokens.cacheWrite
  })
  const outputTokenDetails = compactDetails({
    textTokens: usage.outputTokens.text,
    reasoningTokens: usage.outputTokens.reasoning
  })
  return {
    inputTokens: inputTotal,
    outputTokens: outputTotal,
    totalTokens: inputTotal + outputTotal,
    ...(inputTokenDetails ? { inputTokenDetails } : {}),
    ...(outputTokenDetails ? { outputTokenDetails } : {})
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

function mapTaskStatus(status: SdkTaskStatus): AgentTaskEventPartData['status'] | undefined {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'running':
    case 'paused':
      return 'in_progress'
    case 'completed':
      return 'completed'
    case 'stopped':
      return 'stopped'
    case 'failed':
    case 'killed':
      return 'error'
    default:
      return undefined
  }
}

export class ClaudeCodeStreamAdapter {
  private ctx: StreamContext
  private readonly modelId: string
  private readonly sessionId: string
  private readonly sink: StreamSink
  private readonly statusSink: StatusSink
  private readonly streamOptions: ClaudeCodeStreamAdapterOptions['streamOptions']
  private readonly onSessionId?: (sessionId: string) => void
  private readonly mcpToolMetadata: Record<string, McpToolDisplayMetadata>
  /** Content belongs to a turn's message stream; outside one there is nowhere for it to land. */
  private turnActive = false
  /** The current turn was started by parentless SDK content rather than a host `send()`. */
  private autonomousTurn = false
  /** An empty task snapshot was seen; wait for the SDK's authoritative idle boundary to release it. */
  private backgroundWorkReleasePending = false
  /** The latest authoritative level, enriched only by explicit async-launch receipts from this driver. */
  private backgroundTasks: AgentSessionBackgroundTask[] = []
  private readonly backgroundTaskToolCallIds = new Map<string, string>()
  /** launch root tool-call id → the SendMessage call id that last resumed it. Instance-scoped
   *  (survives idle flow-context clears) and only-overwrite: resumed content arrives after the
   *  turn's result, so clearing would strip markers from the bulk of a continued round. */
  private readonly resumeMarkers = new Map<string, string>()
  /** Parented SDK streams get independent state so subagent text/tool deltas cannot pollute the
   *  main agent's counters. Their sink is detached from the turn when that turn completes. */
  private readonly flowContexts: FlowContext[] = []
  /** `system/init` can arrive before the first turn opens, so its metadata chunk waits for one. */
  private pendingInit?: Extract<SDKMessage, { subtype: 'init' }>
  private turnHasActivity = false

  constructor(options: ClaudeCodeStreamAdapterOptions) {
    this.modelId = options.modelId
    this.sessionId = options.sessionId
    this.sink = options.sink
    this.statusSink = options.statusSink
    this.streamOptions = options.streamOptions
    this.onSessionId = options.onSessionId
    this.mcpToolMetadata = options.mcpToolMetadata ?? {}
    this.ctx = this.createTurnContext()
  }

  /**
   * The single construction site for per-turn state. Annotating the return type makes TypeScript's
   * missing-property check the guarantee that a turn starts clean — resetting fields individually
   * would silently leak whichever one a later change forgets.
   */
  private createTurnContext(sink = this.sink): StreamContext {
    const systemReminderBodies = new Set<string>()
    return {
      sink: this.createSystemReminderFilteringSink(this.createActivityTrackingSink(sink), systemReminderBodies),
      systemReminderBodies,
      options: this.streamOptions,
      toolStates: new Map(),
      activeTaskTools: new Map(),
      toolBlocksByIndex: new Map(),
      toolInputAccumulators: new Map(),
      toolResultsEmitted: new Set(),
      deniedToolUseIds: new Set(),
      sawAbortedMessage: false,
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

  /** Filter at the SDK adapter boundary so live rendering and persisted snapshots consume the same text. */
  private createSystemReminderFilteringSink(
    sink: StreamSink,
    reminderBodies: ReadonlySet<string>
  ): StreamContext['sink'] {
    let destination = sink
    const textFilters = new Map<string, SystemReminderTextFilter>()
    return {
      redirect: (nextSink) => {
        destination = nextSink
      },
      enqueue: (chunk) => {
        if (chunk.type === 'text-start') {
          textFilters.set(chunk.id, new SystemReminderTextFilter(reminderBodies))
        } else if (chunk.type === 'text-delta') {
          const filter = textFilters.get(chunk.id) ?? new SystemReminderTextFilter(reminderBodies)
          textFilters.set(chunk.id, filter)
          const delta = filter.write(chunk.delta)
          if (delta) destination.enqueue({ ...chunk, delta })
          return
        } else if (chunk.type === 'text-end') {
          const filter = textFilters.get(chunk.id)
          if (filter) {
            const delta = filter.flush()
            if (delta) destination.enqueue({ type: 'text-delta', id: chunk.id, delta })
            textFilters.delete(chunk.id)
          }
        }
        destination.enqueue(chunk)
      }
    }
  }

  private createActivityTrackingSink(sink: StreamSink): StreamSink {
    return {
      enqueue: (chunk) => {
        if (chunk.type !== 'message-metadata') this.turnHasActivity = true
        sink.enqueue(chunk)
      }
    }
  }

  /** Whether a turn is open. Turn-scoped session status (an API retry) is gated on this. */
  get isTurnActive(): boolean {
    return this.turnActive
  }

  get hasTurnActivity(): boolean {
    return this.turnHasActivity
  }

  /** Opens a turn on the session-scoped adapter, discarding the previous turn's state wholesale. */
  beginTurn(): void {
    this.turnHasActivity = false
    this.ctx = this.createTurnContext()
    this.turnActive = true
    this.autonomousTurn = false
    if (this.pendingInit) {
      const init = this.pendingInit
      this.pendingInit = undefined
      this.handleInitSystemMessage(init, this.ctx)
    }
  }

  handleMessage(message: SDKMessage): ClaudeCodeStreamAdapterResult {
    logger.silly('Received Claude Code SDK event', {
      sessionId: this.sessionId,
      event: summarizeSdkMessage(message)
    })
    const parentToolUseId = 'parent_tool_use_id' in message ? message.parent_tool_use_id : undefined
    if (
      parentToolUseId != null &&
      (message.type === 'stream_event' || message.type === 'assistant' || message.type === 'user')
    ) {
      const flow = this.getOrCreateFlowContext(parentToolUseId)
      this.handleContentMessage(message, flow.stream)
      return { type: 'continue' }
    }

    // System messages carry session-scoped status and dispatch at any time; everything else is turn
    // content, which has no stream to land in once the turn has ended.
    if (message.type !== 'system' && !this.turnActive) {
      if (message.type === 'result') {
        this.setSessionId(message.session_id)
        const resultError = createClaudeCodeResultError(message)
        if (resultError) throw resultError
        logger.warn('Received a result message with no active turn; dropping turn-complete', {
          sessionId: this.sessionId
        })
        return { type: 'continue' }
      }
      const isContent = message.type === 'stream_event' || message.type === 'assistant' || message.type === 'user'
      if (!isContent) {
        logger.debug('Dropping message received with no active turn', {
          sessionId: this.sessionId,
          type: message.type,
          parentToolUseId
        })
        return { type: 'continue' }
      }
      // Parentless content with no turn open is Claude waking the main agent after background work.
      // Translate that SDK protocol into the runtime-neutral receive-only contract.
      this.statusSink.emit({ type: 'autonomous-turn-state', state: 'started' })
      this.beginTurn()
      this.autonomousTurn = true
    }

    switch (message.type) {
      case 'tool_progress':
        this.handleToolProgressMessage(message)
        return { type: 'continue' }
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
        this.detachFlowContexts()
        this.turnActive = false
        if (this.autonomousTurn) {
          this.autonomousTurn = false
          this.statusSink.emit({ type: 'autonomous-turn-state', state: 'finished' })
        }
        return { type: 'result', sessionId: message.session_id, message }
      case 'system':
        this.handleSystemMessage(message, this.ctx)
        return { type: 'continue' }
    }
    return { type: 'continue' }
  }

  /** Close every active text part so filtering sinks flush buffered marker prefixes before errors escape. */
  finalizeOpenTextParts(): void {
    this.closeActiveTextPart(this.ctx)
    for (const flow of this.flowContexts) this.closeActiveTextPart(flow.stream)
  }

  handleTruncationError(error: unknown): boolean {
    if (!this.ctx.sawAbortedMessage && !isClaudeCodeTruncationError(error, this.ctx.accumulatedText)) return false
    this.turnActive = false

    logger.warn(
      `Detected truncated stream response, returning ${this.ctx.accumulatedText.length} chars of buffered text`
    )
    if (this.ctx.textPartId) {
      this.closeActiveTextPart(this.ctx)
    } else if (this.ctx.accumulatedText && !this.ctx.textStreamedViaContentBlock) {
      const fallbackTextId = generateId()
      this.ctx.sink.enqueue({ type: 'text-start', id: fallbackTextId })
      this.ctx.sink.enqueue({ type: 'text-delta', id: fallbackTextId, delta: this.ctx.accumulatedText })
      this.ctx.sink.enqueue({ type: 'text-end', id: fallbackTextId })
    }
    this.finalizeOpenTextParts()

    this.finalizeToolCalls(this.ctx)
    this.ctx.sink.enqueue({
      type: 'finish',
      finishReason: 'length',
      messageMetadata: this.buildMessageMetadata(this.ctx.usage)
    })
    this.detachFlowContexts()
    return true
  }

  private getOrCreateFlowContext(parentToolCallId: string): FlowContext {
    const existing = this.flowContexts.find(
      (flow) => flow.rootToolCallId === parentToolCallId || flow.stream.toolStates.has(parentToolCallId)
    )
    if (existing) return existing

    const flow: FlowContext = {
      rootToolCallId: parentToolCallId,
      stream: this.createTurnContext(this.turnActive ? this.sink : this.createFlowSink(parentToolCallId))
    }
    this.flowContexts.push(flow)
    return flow
  }

  private createFlowSink(rootToolCallId: string): StreamSink {
    return {
      enqueue: (chunk) => {
        this.statusSink.emit({ type: 'background-flow-chunk', rootToolCallId, chunk })
      }
    }
  }

  private detachFlowContexts(): void {
    for (const flow of this.flowContexts) {
      flow.stream.sink.redirect(this.createActivityTrackingSink(this.createFlowSink(flow.rootToolCallId)))
    }
  }

  private handleContentMessage(
    message: SDKPartialAssistantMessage | SDKAssistantMessage | SDKUserMessage,
    ctx: StreamContext
  ): void {
    switch (message.type) {
      case 'stream_event':
        this.handleStreamEvent(message, ctx)
        return
      case 'assistant':
        this.handleAssistantMessage(message, ctx)
        return
      case 'user':
        this.handleUserMessage(message, ctx)
        return
    }
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
    sdkParentToolUseId: SdkParentToolUseId,
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
    sdkParentToolUseId: SdkParentToolUseId,
    ctx: StreamContext
  ): void {
    const toolId = toolBlock.id
    // Anthropic-compatible relays may open a tool_use block before the name is known;
    // `handleToolUse` fills it in from the completed assistant message.
    const toolName = toolBlock.name ?? ''
    const toolMetadata = this.getToolUseMetadata(toolBlock)

    this.closeActiveTextPart(ctx)

    ctx.toolBlocksByIndex.set(blockIndex, toolId)
    ctx.toolInputAccumulators.set(toolId, '')

    let state = ctx.toolStates.get(toolId)
    if (!state) {
      const currentParentId = getToolParentId(toolName, sdkParentToolUseId, this.getFallbackParentId(ctx))
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
    sdkParentToolUseId: SdkParentToolUseId,
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
    sdkParentToolUseId: SdkParentToolUseId,
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

      // A nameless block is still waiting for the name the completed assistant message carries;
      // emitting now would freeze the call under an unusable name.
      if (!state.callEmitted && state.name) {
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
    // The SDK's own interrupt signal: set when the message was truncated before `stop_reason`
    // arrived. `isClaudeCodeTruncationError` can only infer this from a mid-token JSON parse
    // failure, so a clean truncation would otherwise go unnoticed.
    if (message.aborted) {
      ctx.sawAbortedMessage = true
      logger.warn('Assistant message was truncated by an interrupt')
    }

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
    sdkParentToolUseId: SdkParentToolUseId,
    ctx: StreamContext
  ): void {
    const toolId = tool.id
    let state = ctx.toolStates.get(toolId)
    // The name may be missing here too, in which case the streamed one (if any) stands.
    const toolName = tool.name ?? state?.name ?? ''
    if (!state) {
      const currentParentId = getToolParentId(toolName, sdkParentToolUseId, this.getFallbackParentId(ctx))
      state = {
        name: toolName,
        inputStarted: false,
        inputClosed: false,
        callEmitted: false,
        parentToolCallId: currentParentId,
        ...this.getToolUseMetadata(tool)
      }
      ctx.toolStates.set(toolId, state)
    } else if (!state.parentToolCallId && sdkParentToolUseId) {
      state.parentToolCallId = sdkParentToolUseId
    }
    state.name = toolName
    this.mergeToolMetadata(state, this.getToolUseMetadata(tool))
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

    // The content block closed before the name was known, so its emission was deferred to here.
    if (state.inputClosed && !state.callEmitted) {
      this.emitToolInputAvailable(toolId, state, ctx)
    }
  }

  private handleAssistantText(text: string, sdkParentToolUseId: SdkParentToolUseId, ctx: StreamContext): void {
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

    if (message.isSynthetic) {
      // Claude runtime `isMeta` reminders surface through the SDK as synthetic user messages.
      for (const text of getTextContent(message.message.content)) {
        for (const body of extractSystemReminderBodies(text)) ctx.systemReminderBodies.add(body)
      }
    }

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
    sdkParentToolUseId: SdkParentToolUseId,
    ctx: StreamContext
  ): void {
    if (ctx.toolResultsEmitted.has(result.tool_use_id)) return

    let state = ctx.toolStates.get(result.tool_use_id)
    const toolName = state?.name || this.getToolNameFromResultType(result.type) || UNKNOWN_TOOL_NAME

    if (!state) {
      const resolvedParentId = getToolParentId(toolName, sdkParentToolUseId, this.getFallbackParentId(ctx))
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
    const errorText =
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

    const providerMetadata = this.buildToolProviderMetadata(state)
    const isError = this.isToolResultError(result)
    const isLocalWorkflowLaunch =
      toolName === 'Workflow' && isRecord(normalizedResult) && normalizedResult.taskType === 'local_workflow'
    if (!isError && (isSubagentToolName(toolName) || isLocalWorkflowLaunch)) {
      const taskId = getLaunchedBackgroundTaskId(normalizedResult)
      if (taskId) this.registerBackgroundTaskToolCallId(taskId, result.tool_use_id)
    }
    // A SendMessage receipt that resumed a background agent carries the launch root id in its
    // own metadata (so the renderer can navigate without scanning) AND re-tags subsequent
    // content of that agent for round splitting. Only-overwrite, never clear. A receipt for a
    // still-running target has no resumedAgentId — its queued form only carries `pin.id`.
    if (!isError && isRecord(normalizedResult)) {
      const resumedAgentId =
        typeof normalizedResult.resumedAgentId === 'string'
          ? normalizedResult.resumedAgentId
          : isRecord(normalizedResult.pin) && typeof normalizedResult.pin.id === 'string'
            ? normalizedResult.pin.id
            : undefined
      if (resumedAgentId) {
        const launchToolCallId = this.backgroundTaskToolCallIds.get(resumedAgentId)
        if (launchToolCallId) {
          this.resumeMarkers.set(launchToolCallId, result.tool_use_id)
          const cherry = providerMetadata.cherry as Record<string, unknown>
          cherry.launchToolCallId = launchToolCallId
        }
      }
    }
    if (ctx.deniedToolUseIds.has(result.tool_use_id)) {
      // The chunk schema is strict — `toolCallId` is the only accepted field, so the rejection
      // text stays in the log written by `handlePermissionDeniedSystemMessage`.
      ctx.sink.enqueue({ type: 'tool-output-denied', toolCallId: result.tool_use_id })
    } else if (isError) {
      ctx.sink.enqueue({
        type: 'tool-output-error',
        toolCallId: result.tool_use_id,
        errorText,
        dynamic: true,
        providerExecuted: true,
        providerMetadata
      })
    } else {
      ctx.sink.enqueue({
        type: 'tool-output-available',
        toolCallId: result.tool_use_id,
        output: this.buildToolOutput(normalizedResult, state, result.content),
        dynamic: true,
        providerExecuted: true,
        providerMetadata
      })
    }
    ctx.toolResultsEmitted.add(result.tool_use_id)
  }

  private handleResultMessage(message: SDKResultMessage, ctx: StreamContext): void {
    const finalUsage = convertClaudeCodeUsage(message.usage)
    ctx.usage = {
      ...finalUsage,
      outputTokens: {
        ...finalUsage.outputTokens,
        reasoning: ctx.usage.outputTokens.reasoning
      }
    }
    this.setSessionId(message.session_id)

    const resultError = createClaudeCodeResultError(message)
    if (resultError) {
      this.finalizeOpenTextParts()
      // Error results still carry token totals useful to the live message. The driver only calls
      // `emitUsageMetadata` when `handleMessage` returns normally, so emit the final UI snapshot
      // BEFORE throwing. Per-invocation records are captured independently by the driver.
      ctx.sink.enqueue({
        type: 'message-metadata',
        messageMetadata: this.buildMessageMetadata(ctx.usage)
      })
      throw resultError
    }

    logger.info(
      `Stream completed - Session: ${message.session_id}, Cost: $${message.total_cost_usd?.toFixed(4) ?? 'N/A'}, Duration: ${message.duration_ms ?? 'N/A'}ms`
    )

    const finishReason = mapClaudeCodeFinishReason(message.subtype, message.stop_reason)
    const structuredOutput = message.subtype === 'success' ? message.structured_output : undefined
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

  private handleSystemMessage(message: SdkRuntimeSystemMessage, ctx: StreamContext): void {
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
        this.handleCompactBoundarySystemMessage(message)
        return
      case 'thinking_tokens':
        this.handleThinkingTokensSystemMessage(message, ctx)
        return
      case 'permission_denied':
        this.handlePermissionDeniedSystemMessage(message, ctx)
        return
      case 'background_tasks_changed':
        // Membership feeds presentation immediately, but an empty snapshot may precede the terminal
        // task bookend and an autonomous wake. Keep the connection alive until session idle, which
        // the SDK defines as occurring after held-back results and the background-agent loop drain.
        this.backgroundTasks = message.tasks.map((task) => ({
          id: task.task_id,
          type: task.task_type,
          description: task.description
        }))
        this.publishBackgroundTasks()
        if (message.tasks.length > 0) {
          this.backgroundWorkReleasePending = false
          this.statusSink.emit({ type: 'background-work-state', active: true })
        } else {
          this.backgroundWorkReleasePending = true
        }
        return
      case 'session_state_changed':
        this.handleSessionStateChangedSystemMessage(message)
        return
      case 'commands_changed':
        // Mid-session catalog push (skills discovered in a subdirectory, etc.); consumers replace
        // their cached list, since `supportedCommands()` is only read at init.
        this.statusSink.emit({ type: 'supported-commands', commands: message.commands })
        return
      case 'api_retry':
        this.handleApiRetrySystemMessage(message)
        return
      case 'hook_started':
      case 'hook_progress':
      case 'hook_response':
      case 'memory_recall':
      case 'local_command_output':
      case 'elicitation_complete':
      case 'files_persisted':
      case 'mirror_error':
      case 'notification':
      case 'plugin_install':
      case 'model_refusal_fallback':
      case 'model_refusal_no_fallback':
      case 'control_request_progress':
      case 'informational':
      case 'worker_shutting_down':
        // TODO: Implement handling for these system message subtypes as needed. For now, they are
        // acknowledged at debug level in the logger to avoid being silently ignored. The two
        // `model_refusal_*` ones are the most worth surfacing to the user: the model declined and the
        // CLI either fell back or gave up, which today reads as the answer simply going strange.
        logger.debug(`Received system message subtype: ${message.subtype}`, { message })
        return
      default: {
        // A subtype the SDK added since this switch was last reviewed. Failing the build is the
        // point — it is how a new signal gets a decision instead of vanishing. Deliberately not
        // thrown: the CLI may ship subtypes ahead of us, and a crashed stream is worse than a log.
        const _exhaustive: never = message
        void _exhaustive
        logger.debug('Received an unknown system message subtype', { message })
        return
      }
    }
  }

  private handlePermissionDeniedSystemMessage(
    message: Extract<SDKMessage, { subtype: 'permission_denied' }>,
    ctx: StreamContext
  ): void {
    // Auto-denials (deny rule, classifier, dontAsk) never reach `canUseTool`, and the tool_result
    // that follows only carries `is_error: true` — indistinguishable from a real tool failure.
    // Record the id so `handleToolResult` reports it as denied, and log the reason here since the
    // `tool-output-denied` chunk has no field to carry it.
    ctx.deniedToolUseIds.add(message.tool_use_id)
    logger.info(`Tool call auto-denied: ${message.tool_name}`, {
      toolUseId: message.tool_use_id,
      reasonType: message.decision_reason_type,
      reason: message.decision_reason ?? message.message
    })
  }

  private publishBackgroundTasks(): void {
    this.statusSink.emit({
      type: 'background-tasks',
      tasks: this.backgroundTasks.map((task) => {
        const toolCallId = this.backgroundTaskToolCallIds.get(task.id)
        return toolCallId ? { ...task, toolCallId } : task
      })
    })
  }

  private registerBackgroundTaskToolCallId(taskId: string, toolCallId: string): void {
    // First registration wins: resume edges carry the resuming call's id, not the launch root.
    if (this.backgroundTaskToolCallIds.has(taskId)) return
    // A fresh adapter (app restart) has no in-memory mapping: the persisted launch task event is
    // authoritative and must win over a resume edge that arrives before the launch receipt context.
    let launchToolCallId: string | null = null
    try {
      launchToolCallId = agentSessionMessageService.findLaunchToolCallId(this.sessionId, taskId)
    } catch (error) {
      // A transient database error must not kill the connection — and must not pin the resume
      // edge id either (first-wins would then block the launch root forever). Skip registration;
      // the next task event or receipt re-runs this lookup and self-heals.
      logger.warn('Failed to recover launch tool call id for background task', {
        sessionId: this.sessionId,
        taskId,
        error
      })
      return
    }
    this.backgroundTaskToolCallIds.set(taskId, launchToolCallId ?? toolCallId)
    if (this.backgroundTasks.some((task) => task.id === taskId)) this.publishBackgroundTasks()
  }

  private handleInitSystemMessage(message: Extract<SDKMessage, { subtype: 'init' }>, ctx: StreamContext): void {
    this.setSessionId(message.session_id)
    // A primed connection initializes before any turn opens. The resume token above is session state
    // and applies immediately, but the metadata chunk is turn content, so it waits for `beginTurn`.
    if (!this.turnActive) {
      this.pendingInit = message
      return
    }
    this.logMcpConnectionIssues(message.mcp_servers)
    logger.info(`Stream session initialized: ${message.session_id}`)
    ctx.sink.enqueue({ type: 'message-metadata', messageMetadata: { modelId: this.modelId } })
  }

  /**
   * Task lifecycle describes work the run spawned, which routinely outlives the turn that spawned
   * it. Inside a turn it stays a hidden message part, so the transcript keeps the full history;
   * afterwards there is no message to attach to, and the host keeps the latest event per task as
   * session status instead — otherwise a background task's completion never lands anywhere and its
   * row stays running forever.
   */
  private handleTaskSystemMessage(message: SdkTaskSystemMessage, ctx: StreamContext): void {
    const eventData = this.toTaskEventPartData(message)

    // Membership and liveness remain owned exclusively by `background_tasks_changed`. A native
    // subagent edge may enrich an already-authoritative row with its explicit root tool-use id for
    // navigation only; missing/reordered edges therefore delay the button but never add/hide a chip.
    if (
      eventData.toolUseId &&
      (eventData.taskType === 'subagent' ||
        eventData.taskType === 'local_agent' ||
        eventData.taskType === 'local_workflow' ||
        eventData.subagentType)
    ) {
      this.registerBackgroundTaskToolCallId(eventData.taskId, eventData.toolUseId)
    }

    // Keep a process-scoped per-task surface for status history and stop targets.
    this.statusSink.emit({ type: 'background-task-event', data: eventData })

    if (!this.turnActive) {
      return
    }

    ctx.sink.enqueue({
      type: 'data-agent-task-event',
      id: `task-${eventData.taskId}-${eventData.event}-${message.uuid}`,
      data: eventData
    })
  }

  /**
   * A failed API request is backing off. Turn-scoped by design: it renders inside the active turn's
   * message stream, and only a turn gives it a clear end (a chunk, turn-complete or error all clear
   * it). A turn-less connection's retry would have nothing to attach to and no such boundary, so it
   * must not enter the retry state at all.
   */
  private handleApiRetrySystemMessage(message: SDKAPIRetryMessage): void {
    if (!this.turnActive) return
    this.statusSink.emit({
      type: 'api-retry',
      retry: {
        attempt: message.attempt,
        maxRetries: message.max_retries,
        retryDelayMs: message.retry_delay_ms,
        errorStatus: message.error_status,
        errorCategory: message.error
      }
    })
  }

  /** Only a subagent's own rate-limit backoff carries state the UI reads; the rest is liveness. */
  private handleToolProgressMessage(message: SDKToolProgressMessage): void {
    const retry = message.subagent_retry
    if (!retry || !this.turnActive) return
    this.statusSink.emit({
      type: 'api-retry',
      retry: {
        attempt: retry.attempt,
        maxRetries: retry.max_retries,
        retryDelayMs: retry.retry_delay_ms,
        errorStatus: retry.error_status,
        errorCategory: retry.error_category,
        ...(message.subagent_type ? { subagentType: message.subagent_type } : {})
      }
    })
  }

  private handleStatusSystemMessage(message: SDKStatusMessage): void {
    if (message.status === 'compacting') {
      this.statusSink.emit({ type: 'compaction-start' })
      return
    }
    if (message.compact_result === 'failed' || message.compact_error) {
      logger.warn('Claude compaction failed', { sessionId: message.session_id, error: message.compact_error })
      this.statusSink.emit({ type: 'compaction-error', error: message.compact_error ?? 'Compaction failed' })
      return
    }
    if (message.compact_result === 'success') {
      // A successful compaction may report `success` WITHOUT a following `compact_boundary` (the SDK
      // does not guarantee one). Settle idempotently with a no-anchor completion so the session does
      // not stay `compacting` until the idle TTL; a real boundary below still wins with the anchor.
      this.statusSink.emit({ type: 'compaction-complete' })
    }
  }

  private handleSessionStateChangedSystemMessage(message: SDKSessionStateChangedMessage): void {
    if (message.state !== 'idle') return
    // Idle means held-back results and the background-agent loop have drained, so no detached flow
    // can still stream. Drop the per-flow state instead of retaining it for the connection lifetime;
    // a late straggler simply gets a fresh context via `getOrCreateFlowContext`.
    if (!this.turnActive) this.flowContexts.length = 0
    if (!this.backgroundWorkReleasePending) return
    this.backgroundWorkReleasePending = false
    this.statusSink.emit({ type: 'background-work-state', active: false })
  }

  private handleCompactBoundarySystemMessage(message: SDKCompactBoundaryMessage): void {
    const metadata = message.compact_metadata
    const anchor: AgentSessionCompactionAnchorData = {
      status: 'done',
      phase: 'agent-session',
      trigger: metadata.trigger,
      completedAt: new Date().toISOString(),
      preTokens: metadata.pre_tokens
    }
    if (metadata.post_tokens !== undefined) anchor.postTokens = metadata.post_tokens
    if (metadata.duration_ms !== undefined) anchor.durationMs = metadata.duration_ms

    this.statusSink.emit({ type: 'compaction-complete', anchor })
  }

  private handleThinkingTokensSystemMessage(message: SDKThinkingTokensMessage, ctx: StreamContext): void {
    ctx.usage = {
      ...ctx.usage,
      outputTokens: {
        ...ctx.usage.outputTokens,
        reasoning: message.estimated_tokens
      }
    }
    ctx.sink.enqueue({
      type: 'message-metadata',
      messageMetadata: this.buildMessageMetadata(ctx.usage)
    })
  }

  private toTaskEventPartData(message: SdkTaskSystemMessage): AgentTaskEventPartData {
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
          error: message.patch.error,
          isBackgrounded: message.patch.is_backgrounded
        }
      }
      case 'task_notification':
        return {
          ...base,
          event: 'notification',
          status: mapTaskStatus(message.status),
          // The completion summary is prose, not a name — consumers keep the started-event title.
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

  private buildParentProviderMetadata(sdkParentToolUseId: SdkParentToolUseId): Record<string, JSONObject> | undefined {
    if (!sdkParentToolUseId) return undefined
    const resumedViaCallId = this.resumeMarkers.get(sdkParentToolUseId)
    return {
      'claude-code': {
        parentToolCallId: sdkParentToolUseId
      },
      cherry: {
        transport: AGENT_RUNTIME_CAPABILITIES['claude-code'].transport,
        ...(resumedViaCallId ? { resumedViaCallId } : {})
      }
    }
  }

  private buildToolProviderMetadata(state: ToolStreamState): Record<string, JSONObject> {
    const resumedViaCallId = state.parentToolCallId ? this.resumeMarkers.get(state.parentToolCallId) : undefined
    const claudeCode: JSONObject = {
      parentToolCallId: state.parentToolCallId ?? null,
      ...(state.sdkBlockType ? { sdkBlockType: state.sdkBlockType } : {}),
      ...(state.serverName ? { serverName: state.serverName } : {}),
      ...(state.serverId ? { serverId: state.serverId } : {})
    }

    return {
      'claude-code': claudeCode,
      cherry: {
        transport: AGENT_RUNTIME_CAPABILITIES['claude-code'].transport,
        ...(resumedViaCallId ? { resumedViaCallId } : {}),
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

  private buildToolOutput(
    result: NonNullable<JSONValue>,
    state: ToolStreamState,
    rawContent?: ClaudeToolResultBlock['content']
  ): NonNullable<JSONValue> {
    if (state.toolType !== 'mcp') return result
    return {
      content: hasMcpNonTextContent(rawContent) ? normalizeMcpToolContent(rawContent) : result,
      metadata: {
        type: 'mcp',
        name: state.displayName ?? state.name,
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
      // Last resort: the name never arrived, so the call is emitted under the placeholder.
      toolName: state.name || UNKNOWN_TOOL_NAME,
      input: this.deserializeToolInput(serializedInput),
      providerExecuted: true,
      dynamic: true,
      title: this.getToolTitle(state),
      providerMetadata: this.buildToolProviderMetadata(state)
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
    // Full cumulative snapshot (Claude Code reports final usage once). Provider
    // cost (`total_cost_usd`) is deliberately NOT used here — it is unreliable
    // (session-cumulative / subscription-equivalent). Direct Agent SDK
    // invocations are priced from their frozen model snapshot when their
    // immutable usage record is captured.
    return {
      modelId: this.modelId,
      stats: v3UsageToStats(usage)
    }
  }
}
