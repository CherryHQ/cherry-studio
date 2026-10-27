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

import {
  advanceIndentedMaskState,
  confirmedOpenFenceStreamPrefix,
  fenceContainerPrefixFromState,
  type IndentedMaskState,
  initialIndentedMaskState,
  inlineCodeCarryStart,
  isPlausiblePartialTag,
  maskCodeFences,
  openLineParagraphContinuation,
  shouldDeferScratchpadStripping,
  stripKnownModelScratchpadBlocksPreservingCodeFences,
  stripKnownModelScratchpadBlocksPreservingCodeFencesStepped,
  stripTrailingToolProtocolClosingFragments,
  textHasUnclosedCodeFence,
  textHasUnclosedInlineCodeOutsideCodeBlocks,
  unclosedHtmlTextElementOpener,
  unclosedOpaqueMarkupOpener,
  textStartsWithCompleteNonScratchpadMarkup,
  textStartsWithModelScratchpadTag
} from '@cherrystudio/ai-core'
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
    readonly statusCode?: number | null
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
  /** Snapshot text before this block is not Markdown context for its deltas. */
  textBlockContextStart: number
  streamedTextLength: number
  usage: LanguageModelV3Usage
  hasReceivedStreamEvents: boolean
  hasStreamedJson: boolean
  textStreamedViaContentBlock: boolean
  /** Parentless main-agent text may carry model scratchpad wrappers outside compaction windows. */
  filterParentlessScratchpadText: boolean
  scratchpadTextProbe: string
  scratchpadStreamRemainder: string
  /** Odd trailing backslash run at the processed tail: the next delta's first character is escaped. */
  scratchpadStreamEscapeCarry: boolean
  /** Opener line of a confirmed-open code fence whose content already streamed; pairs mid-fence remainder content. */
  scratchpadStreamFenceCarry: string
  /** Literal-markup carry (unclosed HTML text element / comment / CDATA), tracked incrementally over emitted text so long answers do not rescan per delta (cherry-pr-review round-12 html-carry-rescan). */
  scratchpadStreamHtmlCarry: string
  /** accumulatedText length already classified for the html carry. */
  scratchpadStreamHtmlCarryScanned: number
  /** textBlockContextStart the carry scan is based on; a shift resets it. */
  scratchpadStreamHtmlCarryBase: number
  /**
   * Persistent line-classification state (list/quote container ancestry) advanced over emitted
   * complete lines only: the open-line carry holds the current line's raw text but cannot hold
   * its container stack, and rebuilding ancestry per delta misclassifies container-scoped markup
   * as top-level scratchpad (cherry-pr-review round-17 markdown-container-loss).
   */
  scratchpadMaskState: IndentedMaskState
  /**
   * Raw emitted text already presented to advanceIndentedMaskState but not yet
   * line-stepped (the unterminated tail). advanceIndentedMaskState steps
   * complete lines only and DROPS the partial tail, so feeding it per-delta
   * emit text loses the line's content: when the completing chunk arrives,
   * a truncated line steps and the container ancestry corrupts (round-17
   * multi-chunk partition finding). Re-present this tail with every advance.
   */
  scratchpadMaskStateUnstepped: string
  /** True while the unstepped tail holds no line ending, so a delta's stepped cut needs only the delta scanned. */
  scratchpadMaskUnsteppedEolFree: boolean
  /** Last OPEN_LINE_HEAD_MAX-ish characters of accumulatedText (valid while olSyncLen matches), so tail reads never flatten the accumulator. */
  accRecent: string
  /** Raw scan-consumed text queued for mask-state advance (suppressed lines
   * included): the container machine must see pre-strip structure, not the
   * blank lines stripping leaves (round-18 review case 56). */
  scratchpadMaskAdvanceRawQueue: string
  /**
   * Held open-fence progress for advanceScratchpadMaskState (round-17
   * retained-fence quadratic, cherry-pr-review inv_50f4adc875e16a2f). While a
   * fence stays open the held raw text is kept as segments and each delta is
   * scanned line-by-line - only the NEW text - for the events that can change
   * the mask outcome: a candidate closing-fence line, a container-boundary
   * line, or (for a fence inside a scratchpad block) a possible block closing
   * tag. Absent those events the full re-mask's outcome is unchanged by
   * construction, so the delta is appended without re-scanning processed
   * fence content.
   */
  scratchpadMaskHeldFence: {
    /** Parsed opener char; null when the opener line is unparseable - the closer scan then fires on EITHER fence char instead of assuming backtick. */
    fenceChar: '`' | '~' | null
    openerRunLength: number
    rawContainerPrefix: string
    enclosedScratchpad: boolean
    openLine: {
      phase: 'prefix' | 'run' | 'trailing' | 'dead'
      runLength: number
      head: string
      headDone: boolean
      startsWithPrefix: boolean
      hasRealContent: boolean
    }
    segments: string[]
  } | null
  /**
   * Append-stable open-line carry verdicts, keyed by the open line's absolute
   * start. Recomputed when the line restarts or shrinks (round-17 latency).
   */
  scratchpadOpenLineCarry: { key: number; openLineLength: number; markerHead: string; paragraph: boolean } | null
  /** Incremental inline-code checkpoint for the bounded carry of a long quote-led open line (key = line start in the text block). */
  scratchpadQuoteCarry: { key: number; checkpoint: number; tail: string; seenLen: number } | null
  /**
   * Incremental open-line tracker over accumulatedText (the text after the
   * last newline, clamped to the current text block), kept by
   * appendAccumulated so the per-delta carries never re-slice or re-scan the
   * whole accumulator: olSyncLen is the accumulator length the tracker
   * describes (-1 = rebuild lazily), olStart the line's absolute start, olLen
   * its length, olHead its first OPEN_LINE_HEAD_MAX characters and olPending
   * the text appended since the quote carry last consumed it.
   */
  olSyncLen: number
  olStart: number
  olLen: number
  olHead: string
  olPending: string
  /** Cached verdict of the previous-line check for an indented open line, keyed by line start and accumulator generation. */
  /** The two completed lines before the open line (null = unknown/longer than the head) and how many lines precede it in the block (capped at 2): the whole input of the previous-line verdict. */
  olPrev1: string | null
  olPrev2: string | null
  olDone: number
  olPrevVerdict: { start: number; gen: number; allows: boolean } | null
  /** Bumped whenever accumulatedText is replaced rather than appended. */
  accGen: number
  /** Scratchpad-stripped visible text pending incremental tool-protocol suffix removal. */
  toolProtocolStripAccumulator: string
  toolProtocolStripEmittedLength: number
  /** Incremental tail memos over the accumulator: index of the last non-whitespace char, and of the last '<'. Kept in lockstep with the accumulator so per-delta suffix checks stay O(delta) over a long whitespace tail (cherry-pr-review perf). */
  toolProtocolStripLastNonWsIndex: number
  toolProtocolStripLastLtIndex: number
  /**
   * Accumulator text not yet emitted (accumulator.slice(emittedLength)), kept
   * incrementally so the emitted piece is built from the small pending text
   * instead of slicing the growing accumulator: a slice of the accumulator
   * flattens it per delta and pins a distinct O(block) parent string in every
   * emitted delta. null once a strip rewrote the stripped coordinates: the
   * slice path below then takes over for the rest of the block.
   */
  toolProtocolStripUnemitted: string | null
  /** Last non-whitespace char of the accumulator, so the '>' guard needs no indexing of the accumulator. */
  toolProtocolStripLastNonWsChar: string
  /** Shape of the text from the last '<': 0 none/not tag-like, 1 '<', 2 '</', 3 tag-like name so far. */
  toolProtocolStripTagState: number
  /** A trailing high surrogate not yet paired, with the tag state before it. */
  toolProtocolStripHighSurrogate: { char: string; state: number } | null
  suppressActiveTextPart: boolean
  /** Set once a text part is classified as a compaction artifact: its remaining deltas are dropped. */
  suppressCompactionArtifactPart: boolean
  compactionScratchpadStripped: boolean
  textStartDeferred: boolean
  textPartStarted: boolean
  /** Parent of the active text part, retained so deferred text-start emission keeps it. */
  textPartParentId: SdkParentToolUseId
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

/** True when the text ends with an odd-length backslash run: the next chunk's first character is escaped. */
function hasOddTrailingBackslashRun(text: string): boolean {
  let run = 0
  for (let i = text.length - 1; i >= 0 && text[i] === '\\'; i--) {
    run++
  }
  return run % 2 === 1
}

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
  return Object.keys(out).length > 0 ? out : undefined
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

/** Head of a long quote-led open line carried verbatim across deltas. */
const QUOTE_LINE_CARRY_HEAD = 256
/** Open-line head kept by the incremental tracker; lines up to this length are handled without touching the accumulator. */
const OPEN_LINE_HEAD_MAX = 1024
const ACC_RECENT_MAX = 256

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
  private awaitingBackgroundReply = false
  /** The latest authoritative level, enriched only by explicit async-launch receipts from this driver. */
  private backgroundTasks: AgentSessionBackgroundTask[] = []
  private readonly backgroundTaskToolCallIds = new Map<string, string>()
  /** Parented SDK streams get independent state so subagent text/tool deltas cannot pollute the
   *  main agent's counters. Their sink is detached from the turn when that turn completes. */
  private readonly flowContexts: FlowContext[] = []
  /** `system/init` can arrive before the first turn opens, so its metadata chunk waits for one. */
  private pendingInit?: Extract<SDKMessage, { subtype: 'init' }>
  private turnHasActivity = false
  /** Runtime compaction prose is internal state transfer and must not land in visible transcript text. */
  private runtimeCompactionActive = false
  /**
   * Grace window after a completed compaction. Non-standard gateways can commit the compaction
   * exchange (an `<analysis>` scratchpad plus a `<summary>` in the compaction prompt's section
   * format) as regular assistant text that arrives just after the compacting status clears, so
   * text starts stay deferred until the first visible text emits.
   */
  private compactionArtifactGrace = false
  /**
   * Provenance for the compaction-artifact grace: a compaction that completes before the
   * assistant produced any output for the pending user prompt runs AHEAD of the requested
   * answer, so its success/boundary must not arm artifact suppression against that answer
   * (cherry-pr-review inv_63b9c0bbf40500fd).
   */
  private hasSeenGenuineUserPrompt = false
  /**
   * Visible answer text delivered for the pending user prompt. Tool rounds are
   * not the answer: a Read round before a runtime compaction must not flip the
   * preemption provenance and arm artifact suppression against the requested
   * answer (cherry-pr-review inv_fa1985c9a95f568f).
   */
  private assistantAnswerSinceUserPrompt = false
  private compactionPreemptsPendingAnswer = false

  /** Section headings demanded by the compaction instruction; two or more mark a compaction summary. */
  private static readonly COMPACTION_SUMMARY_SECTIONS = [
    'Task Overview',
    'Current State',
    'Important Discoveries',
    'Next Steps',
    'Context to Preserve'
  ]

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
  private createTurnContext(sink = this.sink, filterParentlessScratchpadText = sink === this.sink): StreamContext {
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
      textBlockContextStart: 0,
      streamedTextLength: 0,
      usage: createEmptyUsage(),
      hasReceivedStreamEvents: false,
      hasStreamedJson: false,
      textStreamedViaContentBlock: false,
      filterParentlessScratchpadText,
      scratchpadTextProbe: '',
      scratchpadStreamRemainder: '',
      scratchpadStreamEscapeCarry: false,
      scratchpadStreamFenceCarry: '',
      scratchpadStreamHtmlCarry: '',
      scratchpadStreamHtmlCarryScanned: 0,
      scratchpadStreamHtmlCarryBase: -1,
      scratchpadMaskState: initialIndentedMaskState(),
      scratchpadMaskStateUnstepped: '',
      scratchpadMaskUnsteppedEolFree: true,
      accRecent: '',
      scratchpadMaskAdvanceRawQueue: '',
      scratchpadMaskHeldFence: null,
      scratchpadOpenLineCarry: null,
      scratchpadQuoteCarry: null,
      olSyncLen: -1,
      olStart: 0,
      olLen: 0,
      olHead: '',
      olPending: '',
      olPrev1: null,
      olPrev2: null,
      olDone: 0,
      olPrevVerdict: null,
      accGen: 0,
      toolProtocolStripAccumulator: '',
      toolProtocolStripEmittedLength: 0,
      toolProtocolStripLastNonWsIndex: -1,
      toolProtocolStripLastLtIndex: -1,
      toolProtocolStripUnemitted: '',
      toolProtocolStripLastNonWsChar: '',
      toolProtocolStripTagState: 0,
      toolProtocolStripHighSurrogate: null,
      suppressActiveTextPart: false,
      suppressCompactionArtifactPart: false,
      compactionScratchpadStripped: false,
      textStartDeferred: false,
      textPartStarted: false,
      textPartParentId: null
    }
  }

  private resetToolProtocolStripState(ctx: StreamContext): void {
    ctx.toolProtocolStripAccumulator = ''
    ctx.toolProtocolStripEmittedLength = 0
    ctx.toolProtocolStripLastNonWsIndex = -1
    ctx.toolProtocolStripLastLtIndex = -1
    ctx.toolProtocolStripUnemitted = ''
    ctx.toolProtocolStripLastNonWsChar = ''
    ctx.toolProtocolStripTagState = 0
    ctx.toolProtocolStripHighSurrogate = null
  }

  /** Strips tool-protocol closings only once trailing content is known (block may span deltas). */
  private takeToolProtocolStrippedVisibleDelta(text: string, ctx: StreamContext, flush = false): string {
    if (!ctx.filterParentlessScratchpadText || (!text && !flush)) {
      return text
    }
    const appendBase = ctx.toolProtocolStripAccumulator.length
    ctx.toolProtocolStripAccumulator += text
    if (ctx.toolProtocolStripUnemitted !== null) ctx.toolProtocolStripUnemitted += text
    for (let i = 0; i < text.length; i++) {
      let ch = text[i]
      const code = ch.charCodeAt(0)
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
        // Step by code point so an astral letter classifies as the old whole-string /u regex did.
        const low = text.charCodeAt(i + 1)
        if (low >= 0xdc00 && low <= 0xdfff) {
          ch += text[i + 1]
        }
      }
      const width = ch.length
      if (ctx.toolProtocolStripHighSurrogate !== null && width === 1 && code >= 0xdc00 && code <= 0xdfff) {
        // A pair split across deltas: re-classify it as one code point from the state before its high half.
        const before = ctx.toolProtocolStripHighSurrogate
        ctx.toolProtocolStripHighSurrogate = null
        if (before.state !== 0) {
          ctx.toolProtocolStripTagState = /[\p{L}\p{N}_|｜-]/u.test(before.char + ch) ? 3 : 0
        }
      } else {
        ctx.toolProtocolStripHighSurrogate = null
        if (code >= 0xd800 && code <= 0xdbff && width === 1 && i + 1 === text.length) {
          ctx.toolProtocolStripHighSurrogate = { char: ch, state: ctx.toolProtocolStripTagState }
        }
        if (ch === '<') {
          ctx.toolProtocolStripLastLtIndex = appendBase + i
          ctx.toolProtocolStripTagState = 1
        } else if (ctx.toolProtocolStripTagState !== 0) {
          if (ch === '/' && ctx.toolProtocolStripTagState === 1) ctx.toolProtocolStripTagState = 2
          else ctx.toolProtocolStripTagState = /[\p{L}\p{N}_|｜-]/u.test(ch) ? 3 : 0
        }
      }
      if (!/\s/u.test(ch)) {
        ctx.toolProtocolStripLastNonWsIndex = appendBase + i + width - 1
        ctx.toolProtocolStripLastNonWsChar = ch
      }
      i += width - 1
    }
    // The strip is a no-op unless the last non-whitespace character is '>'
    // (its linear guard's first check). Skipping the call then keeps a long
    // streamed whitespace tail O(delta) instead of rescanning the whole
    // accumulator per delta (cherry-pr-review perf).
    const accumulator = ctx.toolProtocolStripAccumulator
    const lastNonWs = ctx.toolProtocolStripLastNonWsIndex
    const stripped =
      lastNonWs === -1 || ctx.toolProtocolStripLastNonWsChar !== '>'
        ? accumulator
        : stripTrailingToolProtocolClosingFragments(accumulator)
    if (stripped !== accumulator) ctx.toolProtocolStripUnemitted = null
    // Hold back the trailing suffix that further text could still complete into
    // a strippable fragment (a whitespace run, or a partial `<...` tag).
    // Emitting it eagerly rewinds toolProtocolStripEmittedLength when the
    // fragment completes and is stripped, duplicating protocol text in the
    // output (cherry-pr-review inv_9a2a758db93aa142). The offset only advances;
    // flush at text-part end releases the remainder.
    let emitEnd = stripped.length
    if (!flush) {
      // Whitespace alone is not held: a stripped fragment keeps its leading
      // whitespace consumed, and emitted trailing whitespace must stay emitted.
      // Locate the candidate linearly: the `\s*<...$` regex backtracks
      // quadratically over a long whitespace-only tail, and this check runs on
      // every streamed delta (cherry-pr-review). Only one `<` can lead the
      // held-back suffix, so the last one is the only candidate.
      // Same linear lookup as lastIndexOf('<'), from the append-time memo.
      // Identity comparison: when the strip actually removed a fragment the
      // memo indexes the accumulator, not the shortened string, so rescan
      // that (rare) path directly (cherry-pr-review inv_9a2a758db93aa142).
      const tagStart = stripped === accumulator ? ctx.toolProtocolStripLastLtIndex : stripped.lastIndexOf('<')
      const tagLike =
        tagStart !== -1 &&
        (stripped === accumulator
          ? ctx.toolProtocolStripTagState !== 0
          : /^<\/?[\p{L}\p{N}_|｜-]*$/u.test(stripped.slice(tagStart)))
      if (tagLike) {
        let holdStart = tagStart
        while (holdStart > 0 && /\s/u.test(stripped[holdStart - 1])) holdStart--
        emitEnd -= stripped.length - holdStart
      }
    }
    if (emitEnd <= ctx.toolProtocolStripEmittedLength) return ''
    let emit: string
    if (ctx.toolProtocolStripUnemitted !== null && stripped === accumulator) {
      const pending = ctx.toolProtocolStripUnemitted
      const take = emitEnd - ctx.toolProtocolStripEmittedLength
      emit = pending.slice(0, take)
      ctx.toolProtocolStripUnemitted = pending.slice(take)
    } else {
      this.scratchpadWholeSliceChars += stripped.length
      emit = stripped.slice(ctx.toolProtocolStripEmittedLength, emitEnd)
    }
    ctx.toolProtocolStripEmittedLength = emitEnd
    return emit
  }

  /**
   * Releases the held-back tool-protocol remainder without hold-back when a
   * text part closes. Whatever is still buffered at part end is final content:
   * a completed trailing fragment was already stripped, so what remains is real
   * text (cherry-pr-review inv_9a2a758db93aa142).
   */
  private flushToolProtocolStripRemainder(ctx: StreamContext): void {
    const remaining = this.takeToolProtocolStrippedVisibleDelta('', ctx, true)
    if (!remaining || ctx.suppressActiveTextPart) return
    if (!ctx.textPartId) {
      ctx.textPartId = generateId()
    }
    if (!ctx.textPartStarted) {
      ctx.sink.enqueue({
        type: 'text-start',
        id: ctx.textPartId,
        providerMetadata: this.textStartProviderMetadata(ctx)
      })
      ctx.textPartStarted = true
    }
    ctx.sink.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: remaining })
    ctx.textStreamedViaContentBlock = true
    this.appendAccumulated(ctx, remaining)
    ctx.streamedTextLength += remaining.length
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
  beginTurn({ userPrompt = false }: { userPrompt?: boolean } = {}): void {
    if (userPrompt) {
      this.hasSeenGenuineUserPrompt = true
      this.assistantAnswerSinceUserPrompt = false
      this.endCompactionArtifactGrace()
    }
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
    if (this.isCompactionInternalContent(message, parentToolUseId)) return { type: 'continue' }

    // A resumed CLI replays pending background-task notifications as their own zero-turn query before
    // pulling the host's input (claude-agent-sdk#383); that result belongs to the task, not the turn.
    if (message.type === 'result' && message.origin?.kind === 'task-notification' && !this.autonomousTurn) {
      this.setSessionId(message.session_id)
      logger.info('Received a task-notification result; not settling a turn for it', {
        sessionId: this.sessionId,
        subtype: message.subtype
      })
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
      this.statusSink.emit({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
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
      stream: this.createTurnContext(this.turnActive ? this.sink : this.createFlowSink(parentToolCallId), false)
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
        // Scratchpad provenance belongs to the message whose text carried the
        // wrapper: carrying it into a new message lets unrelated tool-round
        // reasoning erase the final answer (cherry-pr-review inv_2d860893242eb158).
        ctx.compactionScratchpadStripped = false
        break
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
    ctx.textBlockContextStart = ctx.accumulatedText.length
    ctx.olSyncLen = -1
    ctx.textPartId = partId
    ctx.scratchpadTextProbe = ''
    ctx.scratchpadMaskState = initialIndentedMaskState()
    ctx.scratchpadMaskStateUnstepped = ''
    ctx.scratchpadMaskUnsteppedEolFree = true
    ctx.scratchpadMaskAdvanceRawQueue = ''
    ctx.scratchpadMaskHeldFence = null
    ctx.scratchpadOpenLineCarry = null
    ctx.scratchpadQuoteCarry = null
    ctx.suppressActiveTextPart = false
    ctx.suppressCompactionArtifactPart = false
    ctx.textPartParentId = sdkParentToolUseId ?? null
    this.resetToolProtocolStripState(ctx)
    ctx.textStartDeferred = ctx.filterParentlessScratchpadText || this.compactionArtifactWatchActive()
    ctx.textPartStarted = false
    if (!ctx.textStartDeferred) {
      ctx.sink.enqueue({
        type: 'text-start',
        id: partId,
        providerMetadata: this.buildParentProviderMetadata(sdkParentToolUseId)
      })
      ctx.textPartStarted = true
    }
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
      this.appendAccumulated(ctx, text)
      ctx.streamedTextLength += text.length
      return
    }

    this.enqueueVisibleTextDelta(text, ctx)
  }

  private splitIncompleteTagSuffix(text: string): { emit: string; buffer: string } {
    const lastOpen = text.lastIndexOf('<')
    if (lastOpen === -1) {
      return { emit: text, buffer: '' }
    }
    const tail = text.slice(lastOpen)
    if (tail.includes('>') || !/^<[a-z/!?]/i.test(tail)) {
      return { emit: text, buffer: '' }
    }
    // A character that cannot appear in a tag prefix (the comma in `a<b, `)
    // disproves the candidate: emit it as ordinary text instead of buffering
    // it until block stop (cherry-pr-review: comparison-stream-stall).
    if (!isPlausiblePartialTag(tail, 0)) {
      return { emit: text, buffer: '' }
    }
    return { emit: text.slice(0, lastOpen), buffer: tail }
  }

  /**
   * Incremental literal-markup carry: classifies only text emitted since the
   * previous call. Emitted text is always inline-code-closed (unclosed spans
   * stay buffered in the remainder) and open fences pause tracking, so
   * scanning each new chunk with its own masking matches a full rescan of the
   * emitted prefix (cherry-pr-review round-12 html-carry-rescan).
   */
  private updateHtmlStreamCarry(ctx: StreamContext): void {
    if (
      ctx.scratchpadStreamHtmlCarryBase !== ctx.textBlockContextStart ||
      ctx.scratchpadStreamHtmlCarryScanned > ctx.accumulatedText.length
    ) {
      ctx.scratchpadStreamHtmlCarry = ''
      ctx.scratchpadStreamHtmlCarryBase = ctx.textBlockContextStart
      ctx.scratchpadStreamHtmlCarryScanned = ctx.textBlockContextStart
    }
    if (ctx.scratchpadStreamFenceCarry !== '') {
      // Inside an open fence everything is literal: keep the cursor current
      // so fenced markup is never reconsidered after the close.
      ctx.scratchpadStreamHtmlCarryScanned = ctx.accumulatedText.length
      return
    }
    while (ctx.scratchpadStreamHtmlCarryScanned < ctx.accumulatedText.length) {
      this.syncOpenLine(ctx)
      const recentStart = ctx.accumulatedText.length - ctx.accRecent.length
      const chunk =
        ctx.scratchpadStreamHtmlCarryScanned >= recentStart
          ? ctx.accRecent.slice(ctx.scratchpadStreamHtmlCarryScanned - recentStart)
          : ctx.accumulatedText.slice(ctx.scratchpadStreamHtmlCarryScanned)
      const probe = ctx.scratchpadStreamHtmlCarry + chunk
      if (!/<(textarea|title|script|style)[\s>]|<!--|<!\[CDATA\[/i.test(probe)) {
        // No opener in the scanned text: only a bounded tail can still become
        // a pattern start once more text arrives (the longest pattern prefix
        // is '<![CDATA['), so keep that overlap window and mark the rest
        // scanned instead of re-scanning the whole tail per delta (round-17
        // html-carry-rescan / cherry-review inv_269a650fa555da87).
        ctx.scratchpadStreamHtmlCarryScanned = Math.max(
          ctx.scratchpadStreamHtmlCarryScanned,
          ctx.accumulatedText.length - 16
        )
        break
      }
      ctx.scratchpadStreamHtmlCarry = unclosedHtmlTextElementOpener(probe) ?? unclosedOpaqueMarkupOpener(probe) ?? ''
      ctx.scratchpadStreamHtmlCarryScanned = ctx.accumulatedText.length
    }
  }

  /**
   * Step the container-ancestry mask state over newly emitted visible text.
   * A fence still open at the end of an advance span must not be stepped
   * piecemeal: a later span starting inside the fence would read its closing
   * marker as a NEW opener and mask every following line away from the
   * stepped state (round-18 fence-continuity regression, review probe
   * "plain paragraph + fence + indented line"). Hold the raw fence text in
   * the unstepped tail instead; when the closer arrives the whole fence masks
   * and steps as a single placeholder line, exactly as an undivided delivery
   * would. While a fence stays open, advance work is incremental: the held
   * raw fence text is kept as segments and each delta is scanned for closer,
   * container-boundary, and scratchpad-block events only - the full re-mask
   * runs once when such an event arrives instead of re-masking the growing
   * held fence per delta (cherry-pr-review inv_50f4adc875e16a2f).
   */
  /** Total characters presented to maskCodeFences by the mask-state advance (test instrumentation). */
  private scratchpadMaskAdvanceWorkChars = 0

  /** Total characters handed to the scratchpad strip scan across deltas (test instrumentation). */
  private scratchpadScanInputChars = 0
  /**
   * Test instrumentation for per-delta work outside the strip scan: characters
   * handled by the open-line carry (head, tail and any whole-line slice) and
   * characters of accumulator/accumulator-sized strings rebuilt or sliced on
   * the hot path. Both stay O(delta) on a long tickless quote line.
   */
  private scratchpadCarryWorkChars = 0
  private scratchpadWholeSliceChars = 0

  private advanceScratchpadMaskState(emit: string, ctx: StreamContext): void {
    // The scratchpad scan queues the RAW text it consumed per delta; the
    // container machine must advance over that raw structure: advancing over
    // post-strip visible text turns suppressed scratchpad-block lines into
    // blanks that never close an enclosing list, so a later indented line is
    // misclassified against a stale list (round-18 review case 56). The
    // visible fallback covers only deltas that bypassed the scan.
    const rawAdvance = ctx.scratchpadMaskAdvanceRawQueue
    ctx.scratchpadMaskAdvanceRawQueue = ''
    const incoming = rawAdvance !== '' ? rawAdvance : emit
    let maskAdvanceInput: string
    const heldFence = ctx.scratchpadMaskHeldFence
    if (heldFence !== null) {
      // While the fence stays open, each advance below re-masks the whole
      // held fence - O(fence length) per delta, quadratic over a streamed
      // fence (cherry-pr-review inv_50f4adc875e16a2f). Skip it when the new
      // text holds no event that can change the outcome: the slow path below
      // then leaves every input to the next delta byte-identical, so
      // appending the segment is exactly equivalent by construction.
      ctx.scratchpadMaskHeldFence = null
      if (!this.heldFenceDeltaMayClose(heldFence, incoming)) {
        heldFence.segments.push(incoming)
        ctx.scratchpadMaskHeldFence = heldFence
        return
      }
      maskAdvanceInput = heldFence.segments.join('') + incoming
    } else {
      maskAdvanceInput = ctx.scratchpadMaskStateUnstepped + incoming
    }
    // While the unstepped tail holds no line ending, every ending of the
    // combined input lies in the new text: scan only that, not the whole
    // growing partial line.
    const eolFree = heldFence === null && ctx.scratchpadMaskUnsteppedEolFree
    let maskAdvanceCut: number
    if (eolFree) {
      const incomingCut = this.steppedLineEndOffset(incoming)
      maskAdvanceCut = incomingCut > 0 ? ctx.scratchpadMaskStateUnstepped.length + incomingCut : 0
    } else {
      maskAdvanceCut = this.steppedLineEndOffset(maskAdvanceInput)
    }
    const endsWithCr = incoming !== '' ? incoming.endsWith('\r') : maskAdvanceInput.endsWith('\r')
    if (maskAdvanceCut <= 0) {
      ctx.scratchpadMaskStateUnstepped = maskAdvanceInput
      ctx.scratchpadMaskUnsteppedEolFree = eolFree && !/[\r\n]/.test(incoming)
      return
    }
    const span = maskAdvanceInput.slice(0, maskAdvanceCut)
    // Deterministic work instrumentation (cherry-pr-review
    // inv_50f4adc875e16a2f): quadratic re-masking of a held fence sums to
    // O(fence^2 / chunk) characters here; incremental advance stays linear.
    this.scratchpadMaskAdvanceWorkChars += span.length
    const maskedAdvance = maskCodeFences(span, {
      initialContainerPrefix: fenceContainerPrefixFromState(ctx.scratchpadMaskState) || undefined
    })
    const lastFenceToken = `${maskedAdvance.placeholderBase}CODE_FENCE_${maskedAdvance.fences.length - 1}\uE001`
    if (maskedAdvance.fences.length > 0 && maskedAdvance.text.endsWith(lastFenceToken)) {
      const fenceStart = maskedAdvance.text.length - lastFenceToken.length
      const beforeFence = maskedAdvance.text.slice(0, fenceStart)
      // Masked and raw text are byte-identical before the fence, so this line
      // start is the same offset in the raw span.
      const holdFrom = Math.max(beforeFence.lastIndexOf('\n'), beforeFence.lastIndexOf('\r')) + 1
      if (holdFrom > 0) {
        advanceIndentedMaskState(ctx.scratchpadMaskState, maskedAdvance.text.slice(0, holdFrom))
      }
      ctx.scratchpadMaskStateUnstepped = maskAdvanceInput.slice(holdFrom)
      ctx.scratchpadMaskUnsteppedEolFree = false
      if (maskedAdvance.fences.length === 1) {
        // Single open fence: masked and raw text are byte-identical before
        // it, so the token position is the raw fence start as well.
        ctx.scratchpadMaskHeldFence = this.buildHeldFence(ctx.scratchpadMaskStateUnstepped, ctx)
      }
      return
    }
    advanceIndentedMaskState(ctx.scratchpadMaskState, maskedAdvance.text)
    ctx.scratchpadMaskStateUnstepped = maskAdvanceInput.slice(maskAdvanceCut)
    ctx.scratchpadMaskUnsteppedEolFree = !endsWithCr
  }

  /**
   * Initial held-fence progress at hold entry: opener character, raw
   * container prefix, scratchpad-block enclosure, and the open-line state of
   * the held tail's final partial line.
   */
  private buildHeldFence(heldRaw: string, ctx: StreamContext): NonNullable<StreamContext['scratchpadMaskHeldFence']> {
    const openerEnd = /\r\n|\r|\n/.exec(heldRaw)
    const openerLine = openerEnd ? heldRaw.slice(0, openerEnd.index) : heldRaw
    // The ACTUAL opener char and run length, parsed from the held raw opener
    // line, seeing past optional list-marker prefixes ("- ~~~", "1. ```"): a
    // real closing fence needs a run of the same char at least this long
    // (CommonMark), so a candidate line with a shorter run (``` inside a
    // ```` fence) cannot change the mask outcome and must not wake the slow
    // path. When the opener cannot be parsed, fenceChar stays null so the
    // closer scan fires on a run of EITHER fence char - defaulting to
    // backtick would never wake on a real tilde closer (cherry-review). Run
    // fallback 3 keeps the any-run->=3 superset for an unparseable opener.
    const openerMatch = /^[ >\t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*([`~])(\1*)/.exec(openerLine)
    const fenceChar = (openerMatch?.[1] ?? null) as '`' | '~' | null
    const openerRunLength = openerMatch ? 1 + openerMatch[2].length : 3
    // Raw continuation prefix of the fence's container ancestry, mirroring
    // fenceContainerPrefixFromState with the literal spaces streamed content
    // lines carry (the symbolic form marks list-marker columns with '-').
    let rawContainerPrefix = ''
    let prevCol = 0
    let prevQuote = 0
    for (const entry of ctx.scratchpadMaskState.listColumnStack) {
      while (prevQuote < entry.quoteDepth) {
        rawContainerPrefix += '> '
        prevQuote++
      }
      const relWidth = entry.column - prevCol
      if (relWidth <= 0) continue
      rawContainerPrefix += ' '.repeat(relWidth)
      prevCol = entry.column
    }
    const held: NonNullable<StreamContext['scratchpadMaskHeldFence']> = {
      fenceChar,
      openerRunLength,
      rawContainerPrefix,
      // The stepped state ends exactly at the fence line: an enclosing
      // scratchpad block must already sit on the scan stack there.
      enclosedScratchpad: ctx.scratchpadMaskState.scratchpadScan.stack.length > 0,
      openLine: {
        phase: 'prefix',
        runLength: 0,
        head: '',
        headDone: rawContainerPrefix === '',
        startsWithPrefix: rawContainerPrefix === '',
        hasRealContent: false
      },
      segments: [heldRaw]
    }
    // A trailing lone CR is a pending CRLF fragment withheld from the stepped
    // span: its line is still open, so the open line resumes after the last
    // LF only - the fragment's own line stays in the open-line state.
    const lastLineStart = heldRaw.lastIndexOf('\n') + 1
    for (const c of heldRaw.slice(lastLineStart)) this.heldFenceFeedChar(held, c)
    return held
  }

  /** Feed one character into the held fence's open-line state. */
  private heldFenceFeedChar(held: NonNullable<StreamContext['scratchpadMaskHeldFence']>, c: string): void {
    const st = held.openLine
    // Null fenceChar (unparseable opener): a run of either fence char counts
    // as a candidate - superset of real closers, never a miss.
    const fenceCharMatch = held.fenceChar === null ? c === '`' || c === '~' : c === held.fenceChar
    if (!st.headDone) {
      st.head += c
      if (st.head.length >= Math.max(held.rawContainerPrefix.length, 4)) {
        st.headDone = true
        st.startsWithPrefix = held.rawContainerPrefix === '' || st.head.startsWith(held.rawContainerPrefix)
      }
    } else if (c !== ' ' && c !== '\t') {
      st.hasRealContent = true
    }
    switch (st.phase) {
      case 'prefix':
        if (fenceCharMatch) {
          st.phase = 'run'
          st.runLength = 1
        } else if (c !== ' ' && c !== '\t' && c !== '>' && c !== '\r') {
          st.phase = 'dead'
        }
        break
      case 'run':
        if (fenceCharMatch) st.runLength++
        else if (c === ' ' || c === '\t' || c === '\r') st.phase = 'trailing'
        else st.phase = 'dead'
        break
      case 'trailing':
        if (c !== ' ' && c !== '\t' && c !== '\r') st.phase = 'dead'
        break
    }
  }

  /**
   * Whether a delta can change the held fence's mask outcome. Conservative:
   * any completed line that could be a closing fence (container prefix, up to
   * three spaces, a run of the fence character at least the opener's length,
   * trailing spaces only), any
   * content line that does not carry the fence's container prefix (a
   * container boundary may end the fence there), and - for a fence inside a
   * scratchpad block - any '<' that could start the block's closing tag. The
   * open-line state advances across deltas so a closer split across chunk
   * boundaries is still seen.
   */
  private heldFenceDeltaMayClose(held: NonNullable<StreamContext['scratchpadMaskHeldFence']>, delta: string): boolean {
    if (held.enclosedScratchpad && delta.includes('<')) return true
    const pieces = delta.split(/(\r\n|\r|\n)/)
    for (let i = 0; i < pieces.length; i += 2) {
      for (const c of pieces[i]) this.heldFenceFeedChar(held, c)
      if (i + 1 >= pieces.length) break
      const st = held.openLine
      if (!st.headDone) {
        st.headDone = true
        st.startsWithPrefix = false
        if (/[^ \t]/.test(st.head)) st.hasRealContent = true
      }
      const closerEvent = (st.phase === 'run' || st.phase === 'trailing') && st.runLength >= held.openerRunLength
      // A quoted fence ends at any line without its quote marker (blank
      // lines included); a list fence ends at dedented content but keeps
      // blank lines (fenceContainerEnd).
      const quoteEndEvent = held.rawContainerPrefix.includes('>') && !/^ {0,3}>/.test(st.head)
      const containerEvent =
        quoteEndEvent || (held.rawContainerPrefix !== '' && st.hasRealContent && !st.startsWithPrefix)
      if (closerEvent || containerEvent) return true
      held.openLine = {
        phase: 'prefix',
        runLength: 0,
        head: '',
        headDone: held.rawContainerPrefix === '',
        startsWithPrefix: held.rawContainerPrefix === '',
        hasRealContent: false
      }
    }
    return false
  }

  /** Appends visible text to the accumulator and keeps the open-line tracker in step (O(delta)). */
  private appendAccumulated(ctx: StreamContext, text: string): void {
    const prev = ctx.accumulatedText.length
    ctx.accumulatedText += text
    if (ctx.olSyncLen !== prev) {
      ctx.olSyncLen = -1
      return
    }
    ctx.olSyncLen = ctx.accumulatedText.length
    ctx.accRecent = (ctx.accRecent + text).slice(-ACC_RECENT_MAX)
    if (text === '') return
    const nl = text.lastIndexOf('\n')
    if (nl >= 0) {
      // Lines this append completes feed the previous-line verdict window.
      const parts = text.split('\n')
      for (let k = 0; k < parts.length - 1; k++) {
        let completed: string | null
        if (k === 0) {
          completed =
            ctx.olLen === ctx.olHead.length && ctx.olHead.length + parts[0].length <= OPEN_LINE_HEAD_MAX
              ? ctx.olHead + parts[0]
              : null
        } else {
          completed = parts[k].length <= OPEN_LINE_HEAD_MAX ? parts[k] : null
        }
        ctx.olPrev2 = ctx.olPrev1
        ctx.olPrev1 = completed
        ctx.olDone = Math.min(2, ctx.olDone + 1)
      }
      const line = text.slice(nl + 1)
      ctx.olStart = prev + nl + 1
      ctx.olLen = line.length
      ctx.olHead = line.slice(0, OPEN_LINE_HEAD_MAX)
      ctx.olPending = line
    } else {
      ctx.olLen += text.length
      if (ctx.olHead.length < OPEN_LINE_HEAD_MAX) ctx.olHead += text.slice(0, OPEN_LINE_HEAD_MAX - ctx.olHead.length)
      ctx.olPending = ctx.olPending.length > 8192 ? '' : ctx.olPending + text
    }
  }

  /** Brings the open-line tracker in sync with the accumulator (a full rebuild only when it was bypassed). */
  private syncOpenLine(ctx: StreamContext): void {
    const acc = ctx.accumulatedText
    if (ctx.olSyncLen === acc.length) return
    this.scratchpadWholeSliceChars += acc.length
    const start = Math.max(acc.lastIndexOf('\n') + 1, ctx.textBlockContextStart)
    ctx.olStart = start
    ctx.olLen = acc.length - start
    ctx.olHead = acc.slice(start, start + OPEN_LINE_HEAD_MAX)
    ctx.olPending = ''
    ctx.accRecent = acc.slice(-ACC_RECENT_MAX)
    // Prior lines of the block are unknown after a rebuild; only their count
    // (capped at 2) is recovered, so the verdict falls back to the block slice.
    ctx.olPrev1 = null
    ctx.olPrev2 = null
    // lastIndexOf with a negative start clamps to 0, so a count of 2 can come out with olPrev2 null:
    // the verdict's `known` check then falls back to the (counted) block slice.
    let done = 0
    for (let at = start; done < 2 && at > ctx.textBlockContextStart; done++) {
      at = acc.lastIndexOf('\n', at - 2) + 1
      if (at < ctx.textBlockContextStart) at = ctx.textBlockContextStart
    }
    ctx.olDone = done
    ctx.olSyncLen = acc.length
  }

  /** The whole open line: the tracked head when it is complete, otherwise sliced from the accumulator. */
  private openLineWhole(ctx: StreamContext): string {
    if (ctx.olLen <= ctx.olHead.length) return ctx.olHead
    this.scratchpadWholeSliceChars += ctx.olLen
    return ctx.accumulatedText.slice(ctx.olStart)
  }

  private filterScratchpadFromOngoingDelta(text: string, ctx: StreamContext): string {
    if (!ctx.filterParentlessScratchpadText || !ctx.textPartStarted || ctx.textStartDeferred) {
      return text
    }

    // Reattach the escape context of the previous chunk: its trailing backslash was already
    // emitted, so the scanner cannot see it. The synthetic prefix is removed again below.
    // The same applies to Markdown line context: a delta continuing an
    // indented-code line whose whitespace already emitted would be scanned as
    // column-zero text and lose literal code content (cherry-pr-review
    // inv_b4f675e18911386f).
    const indentPrefix = this.emittedIndentOnlyLinePrefixFor(ctx)
    // A delta continues the line the previous chunk left open: carry that
    // line's emitted content so the scanner classifies the combined first
    // line with its real Markdown block context. Without it, a chunk like
    // ` Example\n    <thinking>…` following an emitted `#` scans the heading
    // line as a paragraph, the indented literal code after it is deleted
    // (indented code cannot interrupt a paragraph), and the later snapshot -
    // normalized with full-block context - appends the mismatched suffix
    // (cherry-pr-review inv_f7b234887ed722ff). The carry holds any trailing
    // backslash literally, subsuming the escape carry.
    const openLinePrefix = this.emittedOpenLinePrefixWithState(ctx.scratchpadMaskState, ctx)
    // An HTML text element (script/style/textarea/title) left unclosed by the
    // emitted prefix makes wrapper-shaped markup in later deltas literal
    // character data: carry its opener into the scan so the body is not
    // stripped as a scratchpad block (cherry-pr-review round-9
    // fragmented-html-content-corruption). Fence carry takes precedence:
    // content inside an open fence is already literal.
    // Literal-markup context the scan cannot see once emitted: an unclosed
    // HTML text element, or an unclosed comment/CDATA section (round-11
    // opaque-markup-stream-context). Tracked incrementally over newly emitted
    // text only, so long answers do not rescan the whole accumulator per
    // delta (round-12 html-carry-rescan).
    this.updateHtmlStreamCarry(ctx)
    const htmlCarry = ctx.scratchpadStreamHtmlCarry
    const prefix =
      ctx.scratchpadStreamFenceCarry +
      htmlCarry +
      (openLinePrefix !== '' ? openLinePrefix : (ctx.scratchpadStreamEscapeCarry ? '\\' : '') + indentPrefix)
    const scanRemainder = ctx.scratchpadStreamRemainder
    const combined = prefix + scanRemainder + text
    this.scratchpadScanInputChars += combined.length
    ctx.scratchpadStreamRemainder = ''
    ctx.scratchpadStreamEscapeCarry = false

    // Seeded probes: an indented fence opener whose list ancestry was
    // emitted in an earlier delta still reads as a fence, and a 4-space
    // wrapper opener continuing a list item is paragraph content to defer,
    // not code (round-17 spanning-fence / multi-chunk partition findings).
    const containerPrefix = fenceContainerPrefixFromState(ctx.scratchpadMaskState)
    const streamSeed = {
      initialContainerPrefix: containerPrefix === '' ? undefined : containerPrefix,
      initialMaskState: ctx.scratchpadMaskState
    }
    if (shouldDeferScratchpadStripping(combined, streamSeed)) {
      // A confirmed-open code fence (opener line complete, outside any
      // scratchpad block) holds only literal text through its last complete
      // content line: fences are preserved verbatim, so those lines are
      // text-identical to their eventual combined delivery. Emit them now
      // instead of buffering the whole fence, which stalls long code answers
      // (cherry-pr-review inv_4f2b0c2d3f9c4a0b). Only the trailing partial
      // line can still become the closing marker, so it stays buffered; the
      // carried opener line keeps fence context for the next scan.
      // Inside a carried text element the body is literal: a fence-shaped line
      // there must not arm the fence carry for later real content.
      const openFence = htmlCarry === '' ? confirmedOpenFenceStreamPrefix(combined, streamSeed) : null
      const stableText =
        openFence && openFence.stableEnd > prefix.length ? combined.slice(prefix.length, openFence.stableEnd) : ''
      // Never emit unreviewed text verbatim: if stripping the stable region
      // would change it (e.g. a scratchpad block ahead of the fence), keep
      // buffering everything.
      if (openFence && stableText && stripKnownModelScratchpadBlocksPreservingCodeFences(stableText) === stableText) {
        ctx.scratchpadMaskAdvanceRawQueue += combined.slice(prefix.length, openFence.stableEnd)
        ctx.scratchpadStreamRemainder = combined.slice(openFence.stableEnd)
        ctx.scratchpadStreamFenceCarry = openFence.openerLine
        // The cut sits at a line boundary: no adjacent backslash run carries.
        ctx.scratchpadStreamEscapeCarry = false
        return stableText
      }
      ctx.scratchpadStreamRemainder = combined.slice(prefix.length)
      // The flush path cannot see the emitted text before the remainder, so
      // it needs the escape parity of the character run right before it.
      ctx.scratchpadStreamEscapeCarry = hasOddTrailingBackslashRun(ctx.accumulatedText)
      return ''
    }
    // No unclosed fence remains on this scan, so a carried opener is stale:
    // keeping it would prepend a phantom fence that masks later scratchpad
    // text as literal code content.
    ctx.scratchpadStreamFenceCarry = ''
    const stripped = stripKnownModelScratchpadBlocksPreservingCodeFencesStepped(combined, {
      initialMaskState: ctx.scratchpadMaskState
    })
    if (stripped.length < combined.length && this.compactionArtifactWatchActive()) {
      ctx.compactionScratchpadStripped = true
    }
    // The carried context is already-emitted text; a scratchpad block it
    // opened can close in this chunk and consume part of it, so measure the
    // surviving shared head instead of assuming the carry round-trips whole
    // (cherry-pr-review inv_f7b234887ed722ff).
    let scanned = stripped
    if (prefix !== '') {
      const strippedPrefix = stripKnownModelScratchpadBlocksPreservingCodeFencesStepped(prefix, {
        initialMaskState: ctx.scratchpadMaskState
      })
      let shared = 0
      const limit = Math.min(strippedPrefix.length, stripped.length)
      while (shared < limit && strippedPrefix[shared] === stripped[shared]) shared++
      scanned = stripped.slice(shared)
    }
    const { emit, buffer } = this.splitIncompleteTagSuffix(scanned)
    // Raw consumed this scan: the carried remainder plus this delta, less
    // the re-buffered suffix. A partial tag survives stripping byte-identical
    // only when stripping did not touch text inside the buffer's raw extent:
    // an incomplete tag can span newlines, so a scratchpad block that closes
    // inside that span leaves a stripped buffer shorter than its raw extent
    // and a length-only cut would queue still-pending raw bytes (round-18
    // review buffer-alignment finding). When the buffer is not the raw tail,
    // hold the whole raw scan input instead: queue nothing, emit nothing, and
    // let the completing delta re-scan it whole.
    const scanRaw = scanRemainder + text
    if (buffer !== '' && !scanRaw.endsWith(buffer)) {
      ctx.scratchpadStreamRemainder = scanRaw
      ctx.scratchpadStreamEscapeCarry = hasOddTrailingBackslashRun(ctx.accumulatedText)
      return ''
    }
    ctx.scratchpadMaskAdvanceRawQueue += scanRaw.slice(0, scanRaw.length - buffer.length)
    ctx.scratchpadStreamRemainder = buffer
    // Escape context belongs to the emit/buffer boundary, not the stripped tail: a
    // backslash inside the buffered partial tag is invisible to the next chunk, so
    // the carry must describe the character run right before the buffer
    // (cherry-pr-review inv_93cf115807fbf4b8).
    ctx.scratchpadStreamEscapeCarry = buffer
      ? hasOddTrailingBackslashRun(stripped.slice(0, stripped.length - buffer.length))
      : hasOddTrailingBackslashRun(scanned || stripped)
    // Commit container ancestry for the emitted complete lines. The
    // unstepped tail (partial open line) must be RE-PRESENTED on every
    // advance: advanceIndentedMaskState steps complete lines only and drops
    // the partial tail, so advancing over the per-delta emit delta alone
    // steps a truncated line once the completing chunk lands and corrupts
    // the container ancestry (round-17 multi-chunk partition finding). The
    // raw tail is carried and the whole pending span re-masked per advance.
    return emit
  }

  /** Compaction artifact watch: live while compaction runs and during the post-complete grace. */
  private compactionArtifactWatchActive(): boolean {
    return this.runtimeCompactionActive || this.compactionArtifactGrace
  }

  private endCompactionArtifactGrace(): void {
    this.compactionArtifactGrace = false
  }

  /**
   * Visible answer text committed to the main transcript. Answer provenance
   * derives from post-filtering output only: a scratchpad-only assistant
   * message (e.g. `<thinking>…</thinking>` alongside a tool call) emits
   * nothing, so it must not mark the pending prompt answered and arm artifact
   * suppression against the real answer (cherry-pr-review
   * inv_f006573bb1316667).
   */
  private noteVisibleAnswerText(text: string, ctx: StreamContext): void {
    if (ctx === this.ctx && text.trim()) {
      this.assistantAnswerSinceUserPrompt = true
    }
  }

  /**
   * Leading whitespace of the visible stream's open line when that line sits
   * at four or more columns of indentation (or a tab) and cannot be a
   * paragraph continuation: the next delta continues an indented Markdown
   * code block, a context the scratchpad scanner cannot see once the
   * indentation (and any already-emitted content) has landed
   * (cherry-pr-review inv_b4f675e18911386f, inv_07cd547fcfcb085d).
   * Partial indentation still in flight (fewer than four columns emitted
   * before the delta boundary) is carried as well, so the completing delta
   * is scanned with the full line indentation instead of as column-zero
   * scratchpad text (cherry-pr-review inv_91c25cca41ade4f0).
   */
  /**
   * The emitted content of the line the next delta continues, minus any part
   * still buffered in the remainder (which is re-appended on its own).
   * Whitespace-only open lines carry no block type of their own - the indent
   * carry handles those - so only content lines are returned.
   */

  /**
   * Byte offset just past the last line ending advanceIndentedMaskState would
   * step for `text`: every line with a terminator steps, except that a
   * chunk-final lone CR leaves its line pending (the CR may pair with a
   * completing LF next chunk). Mirrors the stepping rule so callers can carry
   * the unstepped tail forward.
   */
  private steppedLineEndOffset(text: string): number {
    const endings = [...text.matchAll(/\r\n|\r|\n/g)]
    if (endings.length === 0) return 0
    const stepped = text.endsWith('\r') ? endings.length - 1 : endings.length
    if (stepped === 0) return 0
    const last = endings[stepped - 1]
    return last.index + last[0].length
  }
  /**
   * State-composed open-line carry: block ancestry lives in the stepped mask
   * state, so the carry holds only what the current open (unstepped) line can
   * still contribute. Lines whose block type is still continuation-decidable
   * (whitespace/marker-only, quote-led, partial block markers) carry whole;
   * everything else carries indent + list-marker head + a one-character
   * paragraph sentinel + the inline-active tail from the earliest backtick
   * run that can still pair forward. Carrying the whole growing line re-ran
   * the full strip pipeline over it on every delta (round-17 latency
   * regression / cherry-review inv_269a650fa555da87).
   */
  private emittedOpenLinePrefixWithState(state: IndentedMaskState, ctx: StreamContext): string {
    this.syncOpenLine(ctx)
    const lineStart = ctx.olStart - ctx.textBlockContextStart
    if (ctx.olLen === 0) return ''
    // A quote-led line longer than the tracked head takes the incremental
    // bounded carry: nothing below slices or scans the whole line per delta.
    if (ctx.olLen > ctx.olHead.length && /^\s{0,3}>/.test(ctx.olHead)) return this.boundedQuoteLineCarry(ctx)
    const openLine = this.openLineWhole(ctx)
    // Whitespace/marker-only open lines carry as-is: their indentation and
    // container markers are the classification context (round-17).
    if (openLine.trim() === '') return openLine
    // Quote-marked open lines also carry whole: quoted container membership
    // of the line's content lives in the line itself, not yet in the stepped
    // state (the open line is never stepped).
    if (/^\s{0,3}>/.test(openLine)) {
      if (openLine.length <= QUOTE_LINE_CARRY_HEAD) return openLine
      return this.boundedQuoteLineCarry(ctx)
    }
    // A line that is entirely a potential block-marker prefix ('1', '-', '#',
    // '=', '```') can still merge with the arriving chunk into a real marker
    // or a setext underline, and a heading/setext line decides whether later
    // indented lines are code: those carry whole (round-17 split-1 cases).
    const indent = /^\s*/.exec(openLine)![0]
    // A chunk-final lone CR is a pending CRLF fragment, not line content:
    // classify without it while still carrying the raw text (inv_521edae1a6da3ee7).
    const remainder = openLine.slice(indent.length).replace(/\r$/, '')
    if (
      /^[-*+]?$/.test(remainder) ||
      /^\d{1,9}[.)]?$/.test(remainder) ||
      /^#{1,6}$/.test(remainder) ||
      // A run of 3+ fence characters (with a still-growing info string) is a
      // fence opener line: its classification depends on the completed line,
      // and the opener must re-enter the next scan whole (round-17 split-21).
      /^[`~]{3,}/.test(remainder) ||
      // Same for a fence opener on a LIST MARKER line ("1. ~~~"): the
      // paragraph sentinel would inject 'x' between the marker head and the
      // run, making the opener unrecognizable to the fence scan and leaving
      // the closer to read as a new top-level opener (round-19 marker-line
      // fence chunking divergence / in-fence content loss).
      /^(?:[-*+]|\d{1,9}[.)])[ \t]+[`~]{3,}/.test(remainder) ||
      /^[`~]+$/.test(remainder) ||
      /^(?:=+|-+)[ \t]*$/.test(remainder) ||
      /^(?:[-*_][ \t]*)+$/.test(remainder) ||
      /^[<_!]?[a-zA-Z]*$/.test(remainder)
    ) {
      return openLine
    }
    const cacheableKey = ctx.textBlockContextStart + lineStart
    const cached = ctx.scratchpadOpenLineCarry
    let markerHead: string
    let paragraph: boolean
    if (cached && cached.key === cacheableKey && cached.openLineLength <= openLine.length) {
      // Append-stable verdicts: once the line has real non-marker content, no
      // append can change its indent, list-marker head, or paragraph
      // classification (round-17 latency: this scan is per delta over a
      // growing line). A shrink means reconciliation rewrote the line and the
      // cache is stale.
      markerHead = cached.markerHead
      paragraph = cached.paragraph
    } else {
      markerHead = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/.exec(remainder)?.[0] ?? ''
      paragraph = openLineParagraphContinuation(openLine, state)
      // Only verdicts over a line with real content past the marker head are
      // append-stable: a bare '1. ' can still grow into '1.     ' (W>=5 ->
      // indented code, CommonMark ex273) or gain tabs (ex7), changing both
      // markerHead and the paragraph verdict (round-17 conformance ex273C /
      // ex274C / ex7C chunked-loss).
      if (openLine.length > indent.length + markerHead.length) {
        ctx.scratchpadOpenLineCarry = { key: cacheableKey, openLineLength: openLine.length, markerHead, paragraph }
      }
    }
    const tail = openLine.slice(Math.max(indent.length + markerHead.length, inlineCodeCarryStart(openLine)))
    const escapeMarker = tail === '' && hasOddTrailingBackslashRun(openLine) ? '\\' : ''
    // A bare marker line whose buffered scan remainder starts a fence run is
    // a potential marker-line fence opener ("1. " + "~~~" in flight): the
    // paragraph sentinel must not sit between the marker head and the run, or
    // the completed opener scans as paragraph text (unrecognizable to the
    // fence scan) and the closer re-reads as a new top-level opener
    // (round-19 marker-line fence chunking divergence / in-fence content
    // loss). A partial run is safe: the scan holds "1. ~"/"1. ~~" as a
    // potential fence prefix, and "1. ~x" still classifies as paragraph.
    // A bare marker-chain line ("1. ", "- 1. ") whose buffered scan
    // remainder starts a fence run is a potential marker-line fence opener
    // ("1. " + "~~~" in flight): carry the chain whole. The paragraph
    // sentinel must not sit between the marker head and the run, or the
    // completed opener scans as paragraph text (unrecognizable to the fence
    // scan) and the closer re-reads as a new top-level opener (round-19
    // marker-line fence chunking divergence / in-fence content loss). A
    // partial run is safe: the scan holds "1. ~"/"1. ~~" as a potential
    // fence prefix, and "1. ~x" still classifies as paragraph.
    if (
      /^(?:(?:[-*+]|\d{1,9}[.)])\s+)+$/.test(openLine.slice(indent.length)) &&
      /^[`~]/.test(ctx.scratchpadStreamRemainder)
    ) {
      return openLine
    }
    return indent + markerHead + (paragraph ? 'x' : '') + tail + escapeMarker
  }

  /**
   * Bounded carry for a long quote-led open line (cherry-review quoted-line
   * scaling). The line's block context (quote markers, indent, list marker
   * head, heading/fence prefix) sits in its head, so the carry is a bounded
   * head plus the inline-active tail, with the closed middle dropped:
   * - the head is cut so it never ends inside a backtick run, a backslash run,
   *   or an unfinished '<...' token, and never holds an inline span that is
   *   still unpaired inside the head (such a span, if later closed, lies in the
   *   dropped middle and is inert);
   * - the tail starts at the earliest unpaired backtick run (inlineCodeCarryStart
   *   semantics; empty when there is none), backed up over a preceding
   *   backslash run so an escaped tick stays escaped. A trailing backtick run
   *   is always carried because the next delta may extend it;
   * - a line whose head has no text character (an all marker/rule line such as
   *   '> ----') is carried whole because later text can change its type.
   * Pairing state is tracked incrementally from a checkpoint (every backtick
   * run before it is already paired), so a delta costs O(new text), except
   * while an unpaired run stays open: its whole span is then carried, as the
   * non-quote path also does.
   */
  private boundedQuoteLineCarry(ctx: StreamContext): string {
    this.syncOpenLine(ctx)
    const key = ctx.olStart
    // The tracked head always covers the carried head (OPEN_LINE_HEAD_MAX >
    // QUOTE_LINE_CARRY_HEAD); the whole line is only materialized when the
    // result is the whole line.
    const lineHead = ctx.olHead
    let head = lineHead.slice(0, QUOTE_LINE_CARRY_HEAD)
    if (!/[^\s>\-*_=#+.~`()[\]]/.test(head)) return this.openLineWhole(ctx)
    if (lineHead.charCodeAt(head.length) === 96) head = head.replace(/`+$/, '')
    const headSafe = inlineCodeCarryStart(head)
    if (headSafe < head.length) head = head.slice(0, headSafe)
    head = head.replace(/\\+$/, '')
    const lastLt = head.lastIndexOf('<')
    if (lastLt !== -1 && head.indexOf('>', lastLt) === -1) head = head.slice(0, lastLt)
    const entityStart = head.search(/&#?[A-Za-z0-9]*$/)
    if (entityStart !== -1) head = head.slice(0, entityStart)
    // Pairing state is tracked from a checkpoint (every backtick run before it
    // is already paired), and the text from the checkpoint is kept as `tail`,
    // extended by the text appended since the last call: a delta costs
    // O(new text + unpaired span), never O(line).
    let carry = ctx.scratchpadQuoteCarry
    let tail: string
    let base: number
    if (carry && carry.key === key && carry.checkpoint <= ctx.olLen) {
      base = carry.checkpoint
      if (carry.seenLen + ctx.olPending.length === ctx.olLen) tail = carry.tail + ctx.olPending
      else tail = this.openLineWhole(ctx).slice(base)
    } else {
      base = 0
      tail = this.openLineWhole(ctx)
    }
    ctx.olPending = ''
    this.scratchpadCarryWorkChars += lineHead.length + tail.length
    let tailStartLocal = inlineCodeCarryStart(tail)
    const trailing = /`+$/.exec(tail)
    if (trailing && trailing.index < tailStartLocal) tailStartLocal = trailing.index
    // Back up over a preceding backslash run so an escaped tick stays escaped
    // when the next delta rescans from the checkpoint.
    while (tailStartLocal > 0 && tail[tailStartLocal - 1] === '\\') tailStartLocal--
    const tailStart = base + tailStartLocal
    const nextTail = tail.slice(tailStartLocal)
    carry = { key, checkpoint: tailStart, tail: nextTail, seenLen: ctx.olLen }
    ctx.scratchpadQuoteCarry = carry
    if (tailStart < head.length) return this.openLineWhole(ctx)
    return head + nextTail
  }

  /**
   * Open-line indentation carry from the incremental tracker: the container
   * prefix and indent come from the tracked head, and the previous-line
   * verdict is computed once per line (it depends only on text before the
   * line), so a delta never slices the block or rescans the previous line.
   */
  private emittedIndentOnlyLinePrefixFor(ctx: StreamContext): string {
    this.syncOpenLine(ctx)
    const complete = ctx.olLen <= ctx.olHead.length
    const openLine = ctx.olHead
    const containerPrefix = openLine.match(/^(?: {0,3}>(?: |$)| {0,3}(?:[-*+]|\d{1,9}[.)]) )*/)?.[0] ?? ''
    const indent = openLine.slice(containerPrefix.length).match(/^[ \t]+/)?.[0]
    if (!indent) return ''
    // The head ended inside the prefix/indent run: classify from the full line.
    if (!complete && containerPrefix.length + indent.length >= openLine.length) {
      return this.emittedIndentOnlyLinePrefix(ctx.accumulatedText.slice(ctx.textBlockContextStart))
    }
    const carry = containerPrefix + indent
    if (ctx.olStart === ctx.textBlockContextStart) return carry
    let verdict = ctx.olPrevVerdict
    if (!verdict || verdict.start !== ctx.olStart || verdict.gen !== ctx.accGen) {
      let allows: boolean
      const known = ctx.olDone >= 1 && ctx.olPrev1 !== null && (ctx.olDone === 1 || ctx.olPrev2 !== null)
      if (known) {
        // Only the two lines before the open line can matter (the previous
        // line and, for a setext underline, the line before it).
        const window = (ctx.olDone >= 2 ? `${ctx.olPrev2}\n` : '') + `${ctx.olPrev1}\n`
        allows = this.indentCarryAllowedByPreviousLine(window, window.length)
      } else {
        this.scratchpadWholeSliceChars += ctx.accumulatedText.length - ctx.textBlockContextStart
        const text = ctx.accumulatedText.slice(ctx.textBlockContextStart)
        allows = this.indentCarryAllowedByPreviousLine(text, ctx.olStart - ctx.textBlockContextStart)
      }
      verdict = { start: ctx.olStart, gen: ctx.accGen, allows }
      ctx.olPrevVerdict = verdict
    }
    return verdict.allows ? carry : ''
  }

  private emittedIndentOnlyLinePrefix(text: string): string {
    const lineStart = text.lastIndexOf('\n') + 1
    const openLine = text.slice(lineStart)
    // Any open line already sitting at four or more columns of indentation is
    // an indented-code line, whether the delta split inside the leading
    // whitespace or after content landed: the next chunk continues that line
    // and must be scanned with its indentation restored (cherry-pr-review
    // inv_07cd547fcfcb085d).
    // Carry the complete mixed indentation: CommonMark measures columns with
    // tab stops, so a run like three spaces and a tab reaches column four.
    // Carrying only the leading spaces drops the tab and the completing chunk
    // scans below the indented-code threshold (cherry-pr-review
    // inv_f762891db4383e41).
    // Markdown containers prefix every line of their content: a blockquote
    // marker (`> `) or list marker (`- `) wraps the contained block, so the
    // indentation that opens code sits after the markers. Carry the marker
    // prefix along with the indentation, or quoted code scans as column-zero
    // text and loses literal content (cherry-pr-review
    // inv_5cfd1b3f92913a5c).
    const containerPrefix = openLine.match(/^(?: {0,3}>(?: |$)| {0,3}(?:[-*+]|\d{1,9}[.)]) )*/)?.[0] ?? ''
    const indent = openLine.slice(containerPrefix.length).match(/^[ \t]+/)?.[0]
    if (!indent) return ''
    const carry = containerPrefix + indent
    return this.indentCarryAllowedByPreviousLine(text, lineStart) ? carry : ''
  }

  private indentCarryAllowedByPreviousLine(text: string, lineStart: number): boolean {
    if (lineStart === 0) return true
    const prevLineEnd = lineStart - 1
    const prevLineStart = text.lastIndexOf('\n', prevLineEnd - 1) + 1
    const prevLine = text.slice(prevLineStart, prevLineEnd)
    if (prevLine.trim() === '') return true
    // A line holding only blockquote markers is its container's blank line:
    // it closes the paragraph just like an empty line.
    if (/^ {0,3}(?:>[ ]?)+$/.test(prevLine)) return true
    const prevContent = this.stripMarkdownContainerMarkers(prevLine)
    if (this.leadingIndentColumns(prevContent) >= 4) return true
    // Leaf blocks close a paragraph, so indentation after them opens indented
    // code rather than continuing paragraph text (CommonMark 0.31.2 §4.4;
    // cherry-pr-review inv_cc2d7448049afb39). Without this, an indented
    // literal element following a heading is scanned as column-zero
    // scratchpad and deleted from the stream.
    if (this.isLeafBlockBoundaryLine(prevContent, text, prevLineStart)) return true
    return false
  }

  /** Leading indentation of a line in CommonMark columns (tab stops of four). */
  private leadingIndentColumns(line: string): number {
    let columns = 0
    for (const ch of line) {
      if (ch === ' ') columns += 1
      else if (ch === '\t') columns += 4 - (columns % 4)
      else break
    }
    return columns
  }

  /**
   * Removes leading Markdown container markers (blockquote `> `, list
   * markers) so indentation and leaf-block checks see the contained content
   * (cherry-pr-review inv_5cfd1b3f92913a5c).
   */
  private stripMarkdownContainerMarkers(line: string): string {
    let rest = line
    for (;;) {
      const marker = /^ {0,3}(?:>[ ]?|(?:[-*+]|\d{1,9}[.)]) )/.exec(rest)
      if (!marker) return rest
      rest = rest.slice(marker[0].length)
    }
  }

  /**
   * Whether a completed line (already container-stripped) ends a paragraph,
   * letting a following indented line open an indented code block. Mirrors
   * the scanner's leaf-block-boundary rules so streaming and whole-text
   * filtering agree on the visible text (cherry-pr-review
   * inv_cc2d7448049afb39).
   */
  private isLeafBlockBoundaryLine(content: string, text: string, contentLineStart: number): boolean {
    if (/^ {0,3}#{1,6}(?:[ \t]+|$)/.test(content)) return true
    if (/^ {0,3}(?:\*[ \t]*){3,}$/.test(content)) return true
    if (/^ {0,3}(?:_[ \t]*){3,}$/.test(content)) return true
    if (/^ {0,3}(?:-[ \t]*){3,}$/.test(content)) return true
    if (/^ {0,3}(?:`{3,}|~{3,})/.test(content)) return true
    if (!/^ {0,3}(?:=+|-+)[ \t]*$/.test(content)) return false
    // A setext underline only closes an OPEN paragraph; on its own it is
    // paragraph text. The line before it decides.
    const prevEnd = contentLineStart - 1
    if (prevEnd <= 0) return false
    const prevStart = text.lastIndexOf('\n', prevEnd - 1) + 1
    const prevLine = this.stripMarkdownContainerMarkers(text.slice(prevStart, prevEnd))
    if (prevLine.trim() === '') return false
    if (this.leadingIndentColumns(prevLine) >= 4) return false
    if (
      /^ {0,3}(?:#{1,6}(?:[ \t]+|$)|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$|(?:-[ \t]*){3,}$|(?:`{3,}|~{3,}))/.test(prevLine)
    ) {
      return false
    }
    return true
  }

  /**
   * Classifies deferred probe text against the compaction artifact shape: content that is entirely
   * scratchpad plus a `<summary>` carrying the compaction prompt's numbered sections. Gateways that
   * commit the compaction exchange as regular (parented) assistant text bypass the parentless
   * message filter, so this shape check runs regardless of how the turn started.
   */
  private classifyCompactionArtifactProbe(
    probe: string,
    atBlockEnd: boolean,
    ctx: StreamContext
  ): 'pending' | 'artifact' | 'not-artifact' {
    // Compaction provenance is conversation-specific: the watch is armed by
    // the main conversation's compaction, so a parented child flow's
    // summary-shaped answer - even with an analysis wrapper and numbered
    // sections - is that conversation's genuine answer, not a main-agent
    // artifact. Section shape and a scratchpad wrapper do not establish
    // provenance; only the main context can hold it (cherry-pr-review
    // inv_4f2b0c2d3f9c4a0b). Flows still emit verbatim via the
    // flow-preservation branches at the call sites.
    if (!ctx.filterParentlessScratchpadText) return 'not-artifact'
    const stripped = stripKnownModelScratchpadBlocksPreservingCodeFences(probe)
    // Stripping only removes scratchpad blocks (code fences round-trip), so a
    // length change is provenance that the model wrapped internal blocks
    // around this content (cherry-pr-review inv_a80cefcbe270db4f).
    // The probe itself may already be summary-only because a snapshot or an
    // earlier block lost its scratchpad wrapper upstream; the context flag
    // carries that provenance forward (cherry-pr-review inv_a80cefcbe270db4f).
    const hadScratchpad = stripped.length < probe.length || ctx.compactionScratchpadStripped
    const trimmed = stripped.trimStart()
    if (!trimmed) {
      if (!atBlockEnd) return 'pending'
      // A block that is entirely scratchpad (e.g. a lone <analysis>) is internal content.
      return probe.trim() ? 'artifact' : 'not-artifact'
    }
    if (!trimmed.startsWith('<')) return 'not-artifact'
    // Same impossible-tag-prefix gate as classifyScratchpadProbe: a '<' that
    // cannot begin a tag is ordinary answer text (cherry-pr-review:
    // impossible-tag-prefix stall).
    if (!isPlausiblePartialTag(trimmed, 0)) return 'not-artifact'
    if (!trimmed.includes('>')) {
      return atBlockEnd ? 'not-artifact' : 'pending'
    }
    if (textStartsWithModelScratchpadTag(trimmed)) {
      // Unclosed scratchpad block still streaming - wait for the close to see what follows.
      return atBlockEnd ? 'not-artifact' : 'pending'
    }
    if (!trimmed.startsWith('<summary')) return 'not-artifact'
    const markerCount = ClaudeCodeStreamAdapter.COMPACTION_SUMMARY_SECTIONS.filter((section) =>
      new RegExp(`(^|\\n)\\s*\\d+\\.\\s*${section}\\b`, 'i').test(trimmed)
    ).length
    // A bare summary-shaped answer with numbered headings but no scratchpad
    // provenance is legitimate user-facing prose, not a compaction artifact.
    if (markerCount >= 2 && hadScratchpad) {
      // The artifact is the summary exchange alone. Validate the complete
      // boundary before suppressing: ordinary text after the closing tag is a
      // real answer, not compaction prose (cherry-pr-review inv_673840dd69889b50).
      const summaryClose = /<\/summary\s*>/i.exec(trimmed)
      if (summaryClose && trimmed.slice(summaryClose.index + summaryClose[0].length).trim()) {
        return 'not-artifact'
      }
      return atBlockEnd ? 'artifact' : 'pending'
    }
    if (!trimmed.includes('</summary>') && !atBlockEnd) return 'pending'
    return 'not-artifact'
  }

  private classifyScratchpadProbe(
    probe: string,
    atBlockEnd = false
  ): { action: 'pending'; rewriteProbe?: string } | { action: 'suppress' } | { action: 'emit'; visible: string } {
    if (!probe) return { action: 'pending' }

    const trimmed = probe.trimStart()
    if (!trimmed) {
      return atBlockEnd ? { action: 'emit', visible: probe } : { action: 'pending' }
    }
    if (!trimmed.startsWith('<')) {
      return { action: 'emit', visible: probe }
    }
    // A '<' that cannot begin any tag (a comparison, an arrow) is ordinary
    // text: emit it instead of holding the answer for a '>' that settles
    // nothing (cherry-pr-review: impossible-tag-prefix stall).
    if (!isPlausiblePartialTag(trimmed, 0)) {
      return { action: 'emit', visible: probe }
    }
    if (!trimmed.includes('>')) {
      if (atBlockEnd) {
        return { action: 'emit', visible: probe }
      }
      return { action: 'pending' }
    }

    if (textStartsWithCompleteNonScratchpadMarkup(trimmed)) {
      return { action: 'emit', visible: probe }
    }

    // A complete first line with four-column indentation is literal Markdown
    // code. Its apparent scratchpad opener must not defer the rest of the answer.
    const indent = /^[ \t]+/.exec(probe)?.[0] ?? ''
    const indentColumns = [...indent].reduce((col, char) => col + (char === '\t' ? 4 - (col % 4) : 1), 0)
    if (indentColumns >= 4 && /[\r\n]/.test(probe)) return { action: 'emit', visible: probe }

    if (textStartsWithModelScratchpadTag(probe)) {
      const stripped = stripKnownModelScratchpadBlocksPreservingCodeFences(probe)
      // An unclosed inline span can still pair forward with a later backtick and
      // reclassify the block boundary, so hold while one is open. An unclosed
      // fence only matters when the scratchpad block's own closure depends on
      // it; when the block closed before the fence opened, the fence content is
      // stable public code and can stream incrementally (cherry-pr-review
      // round-9 initial-probe-stalls-code-stream).
      if (
        !atBlockEnd &&
        (textHasUnclosedInlineCodeOutsideCodeBlocks(probe) ||
          (textHasUnclosedCodeFence(probe) && stripped.length === probe.length))
      ) {
        return { action: 'pending' }
      }
      if (stripped.length < probe.length) {
        const remainder = stripped
        if (
          textStartsWithModelScratchpadTag(remainder) ||
          (!atBlockEnd &&
            remainder.trimStart().startsWith('<') &&
            !textStartsWithCompleteNonScratchpadMarkup(remainder))
        ) {
          return { action: 'pending', rewriteProbe: remainder }
        }
        if (remainder.trim().length > 0) {
          return { action: 'emit', visible: this.trimAfterScratchpadStrip(probe, remainder) }
        }
        // A whitespace-only remainder is not disposable mid-stream: when the
        // delta boundary lands right after the closed block, that whitespace
        // carries the blank-line separator AND the next visible line's
        // indentation - suppressing it here strips the indentation that
        // combined delivery preserves (trimAfterScratchpadStrip), and the
        // shortened stream then mismatches the assistant snapshot, which
        // appends the duplicate suffix (cherry-pr-review
        // inv_685fa6678f9069fa#f1). Stay pending so the completed probe
        // classifies exactly like combined delivery; at block end the
        // whitespace is trailing and suppresses with the block.
        return atBlockEnd ? { action: 'suppress' } : { action: 'pending' }
      }
      if (atBlockEnd) {
        return { action: 'emit', visible: probe }
      }
      return { action: 'pending' }
    }

    if (atBlockEnd) {
      return { action: 'emit', visible: probe }
    }
    return { action: 'pending' }
  }

  private flushDeferredScratchpadText(ctx: StreamContext): void {
    if (!ctx.textStartDeferred || !ctx.textPartId) return

    const pending = ctx.scratchpadTextProbe
    ctx.textStartDeferred = false
    ctx.scratchpadTextProbe = ''
    if (!pending) return

    if (this.compactionArtifactWatchActive()) {
      const verdict = this.classifyCompactionArtifactProbe(pending, true, ctx)
      if (verdict === 'artifact') {
        ctx.suppressActiveTextPart = true
        ctx.suppressCompactionArtifactPart = true
        return
      }
      if (!ctx.filterParentlessScratchpadText) {
        // Flow-context text under the watch is healthy: emit verbatim.
        ctx.sink.enqueue({
          type: 'text-start',
          id: ctx.textPartId,
          providerMetadata: this.textStartProviderMetadata(ctx)
        })
        ctx.sink.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: pending })
        ctx.textPartStarted = true
        ctx.textStreamedViaContentBlock = true
        this.appendAccumulated(ctx, pending)
        ctx.streamedTextLength += pending.length
        this.endCompactionArtifactGrace()
        return
      }
    }

    if (!ctx.filterParentlessScratchpadText) {
      // The flow-context exemption does not depend on the artifact watch
      // (cherry-pr-review round-14 deferred-child-corruption).
      ctx.sink.enqueue({
        type: 'text-start',
        id: ctx.textPartId,
        providerMetadata: this.textStartProviderMetadata(ctx)
      })
      ctx.sink.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: pending })
      ctx.textPartStarted = true
      ctx.textStreamedViaContentBlock = true
      this.appendAccumulated(ctx, pending)
      ctx.streamedTextLength += pending.length
      return
    }

    const classified = this.classifyScratchpadProbe(pending, true)
    if (classified.action === 'pending') {
      if (classified.rewriteProbe !== undefined) {
        ctx.scratchpadTextProbe = classified.rewriteProbe
        ctx.textStartDeferred = true
      }
      return
    }
    if (classified.action === 'suppress') {
      ctx.suppressActiveTextPart = true
      return
    }

    const visible = this.trimAfterScratchpadStrip(pending, classified.visible)
    ctx.sink.enqueue({
      type: 'text-start',
      id: ctx.textPartId,
      providerMetadata: this.textStartProviderMetadata(ctx)
    })
    ctx.sink.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: visible })
    ctx.textPartStarted = true
    ctx.textStreamedViaContentBlock = true
    this.appendAccumulated(ctx, visible)
    ctx.streamedTextLength += visible.length
    this.noteVisibleAnswerText(visible, ctx)
    // The deferred block start is visible answer text: it must step the mask
    // state like filter-path emissions, or later open-line verdicts classify
    // against a state missing these lines (round-18 fence-continuity family).
    this.advanceScratchpadMaskState(visible, ctx)
    this.endCompactionArtifactGrace()
  }

  /** Appends visible text without scratchpad probing — used when a content block ends. */
  private appendVisibleTextDelta(text: string, ctx: StreamContext): void {
    text = this.takeToolProtocolStrippedVisibleDelta(text, ctx)
    if (!text) return
    if (!ctx.textPartId) {
      ctx.textPartId = generateId()
    }
    if (!ctx.textPartStarted) {
      ctx.sink.enqueue({
        type: 'text-start',
        id: ctx.textPartId,
        providerMetadata: this.textStartProviderMetadata(ctx)
      })
      ctx.textPartStarted = true
    }
    ctx.sink.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: text })
    ctx.textStreamedViaContentBlock = true
    this.appendAccumulated(ctx, text)
    ctx.streamedTextLength += text.length
    this.noteVisibleAnswerText(text, ctx)
  }

  private enqueueVisibleTextDelta(
    text: string,
    ctx: StreamContext,
    providerMetadata?: Record<string, JSONObject>
  ): void {
    if (!text) return
    if (ctx.suppressCompactionArtifactPart) return
    if (ctx.suppressActiveTextPart) {
      if (ctx.textPartStarted) return
      ctx.suppressActiveTextPart = false
    }

    if (!ctx.textPartId) {
      ctx.textPartId = generateId()
      ctx.textStartDeferred = ctx.filterParentlessScratchpadText || this.compactionArtifactWatchActive()
      ctx.scratchpadTextProbe = ''
      ctx.textPartStarted = false
      if (!ctx.textStartDeferred) {
        ctx.sink.enqueue({
          type: 'text-start',
          id: ctx.textPartId,
          providerMetadata: this.textStartProviderMetadata(ctx, providerMetadata)
        })
        ctx.textPartStarted = true
      }
    }

    if (ctx.textStartDeferred) {
      ctx.scratchpadTextProbe += text
      let watchEmittedProbe = false
      if (this.compactionArtifactWatchActive()) {
        const verdict = this.classifyCompactionArtifactProbe(ctx.scratchpadTextProbe, false, ctx)
        if (verdict === 'pending') {
          return
        }
        if (verdict === 'artifact') {
          // Drop the rest of this text part too: the artifact is the whole part, so later
          // deltas of the same block must not leak either.
          ctx.scratchpadTextProbe = ''
          ctx.textStartDeferred = false
          ctx.suppressCompactionArtifactPart = true
          return
        }
        if (!ctx.filterParentlessScratchpadText) {
          // Flow-context text under the watch is healthy: emit the probe as-is. Scratchpad
          // turns keep their own classification below.
          ctx.textStartDeferred = false
          text = ctx.scratchpadTextProbe
          ctx.scratchpadTextProbe = ''
          ctx.sink.enqueue({
            type: 'text-start',
            id: ctx.textPartId,
            providerMetadata: this.textStartProviderMetadata(ctx, providerMetadata)
          })
          ctx.textPartStarted = true
          this.endCompactionArtifactGrace()
          watchEmittedProbe = true
        }
      }
      if (!watchEmittedProbe) {
        if (!ctx.filterParentlessScratchpadText) {
          // Flow-context text is exempt from parentless scratchpad
          // classification regardless of the artifact watch's state: a child
          // block deferred while the watch was active must not be classified
          // after the watch clears (cherry-pr-review round-14
          // deferred-child-corruption).
          ctx.textStartDeferred = false
          text = ctx.scratchpadTextProbe
          ctx.scratchpadTextProbe = ''
          ctx.sink.enqueue({
            type: 'text-start',
            id: ctx.textPartId,
            providerMetadata: this.textStartProviderMetadata(ctx, providerMetadata)
          })
          ctx.textPartStarted = true
        } else {
          const classified = this.classifyScratchpadProbe(ctx.scratchpadTextProbe)
          if (classified.action === 'pending') {
            if (classified.rewriteProbe !== undefined) {
              ctx.scratchpadTextProbe = classified.rewriteProbe
            }
            return
          }
          if (classified.action === 'suppress') {
            ctx.scratchpadTextProbe = ''
            return
          }
          ctx.textStartDeferred = false
          ctx.sink.enqueue({
            type: 'text-start',
            id: ctx.textPartId,
            providerMetadata: this.textStartProviderMetadata(ctx, providerMetadata)
          })
          ctx.textPartStarted = true
          this.endCompactionArtifactGrace()
          text = classified.visible
          ctx.scratchpadTextProbe = ''
        }
      }
    }

    if (ctx.filterParentlessScratchpadText && ctx.textPartStarted && !ctx.textStartDeferred) {
      text = this.filterScratchpadFromOngoingDelta(text, ctx)
      if (!text) return
    }

    text = this.takeToolProtocolStrippedVisibleDelta(text, ctx)
    if (!text) return

    if (!ctx.textPartStarted) {
      ctx.sink.enqueue({
        type: 'text-start',
        id: ctx.textPartId,
        providerMetadata: this.textStartProviderMetadata(ctx, providerMetadata)
      })
      ctx.textPartStarted = true
    }
    // Step the mask state over exactly what is about to be emitted: deferral
    // and flush paths emit text the filter's internal step never saw, leaving
    // the state behind the visible stream (round-18 fence-continuity finding).
    this.advanceScratchpadMaskState(text, ctx)

    ctx.sink.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: text })
    ctx.textStreamedViaContentBlock = true
    this.appendAccumulated(ctx, text)
    ctx.streamedTextLength += text.length
    this.noteVisibleAnswerText(text, ctx)
  }

  private handleInputJsonDelta(partialJson: string, blockIndex: number, ctx: StreamContext): void {
    if (!partialJson) return

    if (ctx.options.responseFormat?.type === 'json') {
      if (!ctx.textPartId) {
        ctx.textPartId = generateId()
        ctx.sink.enqueue({ type: 'text-start', id: ctx.textPartId })
        ctx.textPartStarted = true
      }
      ctx.sink.enqueue({ type: 'text-delta', id: ctx.textPartId, delta: partialJson })
      this.appendAccumulated(ctx, partialJson)
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
      if (ctx.textPartId === textId) {
        this.flushDeferredScratchpadText(ctx)
        this.flushScratchpadStreamRemainder(ctx)
        this.flushToolProtocolStripRemainder(ctx)
      }
      if (!ctx.suppressActiveTextPart && ctx.textPartStarted && ctx.textPartId === textId) {
        ctx.sink.enqueue({ type: 'text-end', id: textId })
      }
      ctx.textBlocksByIndex.delete(blockIndex)
      if (ctx.textPartId === textId) {
        ctx.textPartId = undefined
        ctx.scratchpadTextProbe = ''
        ctx.scratchpadStreamRemainder = ''
        ctx.scratchpadStreamEscapeCarry = false
        ctx.scratchpadStreamFenceCarry = ''
        ctx.scratchpadMaskState = initialIndentedMaskState()
        ctx.scratchpadMaskStateUnstepped = ''
        ctx.scratchpadMaskUnsteppedEolFree = true
        ctx.scratchpadMaskAdvanceRawQueue = ''
        ctx.scratchpadMaskHeldFence = null
        ctx.scratchpadOpenLineCarry = null
        ctx.scratchpadQuoteCarry = null
        this.resetToolProtocolStripState(ctx)
        ctx.suppressActiveTextPart = false
        ctx.suppressCompactionArtifactPart = false
        ctx.textStartDeferred = false
        ctx.textPartStarted = false
        ctx.textPartParentId = null
      }
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

    // Scratchpad provenance belongs to this message alone: a strip from an
    // earlier message in the turn must not mark this one's text as a
    // compaction artifact (cherry-pr-review inv_2d860893242eb158).
    ctx.compactionScratchpadStripped = false

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

    const visibleText = content
      .map((c: BetaContentBlock) => (c.type === 'text' ? c.text : ''))
      .map((blockText) => this.normalizeParentlessAssistantBlockText(blockText, ctx))
      .join('')

    if (visibleText) {
      this.handleAssistantText(visibleText, sdkParentToolUseId, ctx)
    }

    // Snapshot block order varies: when the text block follows the tool
    // blocks, per-block handling would leave the preamble flagged as the
    // answer. A message with tool calls is always a tool round, so the
    // message-level state wins (cherry-pr-review inv_58329b90d53633c8).
    if (tools.length > 0 && ctx === this.ctx) {
      this.assistantAnswerSinceUserPrompt = false
    }
  }

  /** Per content block so multi-block streaming offsets match snapshot reconciliation. */
  private normalizeParentlessAssistantBlockText(blockText: string, ctx: StreamContext): string {
    if (!blockText) return ''
    if (!ctx.filterParentlessScratchpadText) {
      return blockText
    }
    const stripped = stripKnownModelScratchpadBlocksPreservingCodeFences(blockText)
    if (stripped.length < blockText.length && this.compactionArtifactWatchActive()) {
      // The snapshot carried scratchpad alongside this text: that is the runtime
      // provenance distinguishing a compaction artifact from a bare
      // summary-shaped answer (cherry-pr-review inv_a80cefcbe270db4f).
      ctx.compactionScratchpadStripped = true
    }
    const visible = this.trimAfterScratchpadStrip(blockText, stripped)
    return stripTrailingToolProtocolClosingFragments(visible)
  }

  /** Trim separator whitespace only when scratchpad stripping actually changed the text. */
  private trimAfterScratchpadStrip(original: string, stripped: string): string {
    // Drop the blank separator lines between a stripped block and the visible
    // content, but never the first visible line's own indentation: that
    // whitespace is what makes an indented code block a code block
    // (cherry-pr-review inv_b4af2f970a27a005#f1).
    return stripped.length < original.length ? stripped.replace(/^(?:[ 	]*\r?\n)+/, '') : stripped
  }

  private handleAssistantToolUse(
    tool: ClaudeToolUseBlock,
    sdkParentToolUseId: SdkParentToolUseId,
    ctx: StreamContext
  ): void {
    // A tool call means the turn is mid-work: text the same message carried is
    // a preamble, not the requested answer, so it must not arm artifact
    // suppression against the answer that follows the tool result
    // (cherry-pr-review inv_58329b90d53633c8).
    if (ctx === this.ctx) {
      this.assistantAnswerSinceUserPrompt = false
    }
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

  private handleAssistantText(visibleText: string, sdkParentToolUseId: SdkParentToolUseId, ctx: StreamContext): void {
    const providerMetadata = this.buildParentProviderMetadata(sdkParentToolUseId)
    ctx.textPartParentId = sdkParentToolUseId ?? null
    if (!visibleText) {
      return
    }
    if (ctx.hasReceivedStreamEvents) {
      const deltaText = visibleText.length > ctx.streamedTextLength ? visibleText.slice(ctx.streamedTextLength) : ''

      if (ctx.options.responseFormat?.type === 'json') {
        ctx.accumulatedText = visibleText
        ctx.olSyncLen = -1
        ctx.accGen++
        return
      }
      if (deltaText) {
        this.enqueueVisibleTextDelta(deltaText, ctx, providerMetadata)
      }
      ctx.accumulatedText = visibleText
      ctx.olSyncLen = -1
      ctx.accGen++
      ctx.streamedTextLength = visibleText.length
    } else if (ctx.options.responseFormat?.type === 'json') {
      this.appendAccumulated(ctx, visibleText)
    } else {
      this.enqueueVisibleTextDelta(visibleText, ctx, providerMetadata)
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
      ctx.olSyncLen = -1
      ctx.accGen++
      ctx.streamedTextLength = 0
    }

    const sdkParentToolUseId = message.parent_tool_use_id
    const content = message.message.content
    const toolResults = this.extractToolResults(content)

    // A genuine user prompt establishes that the following assistant text answers the
    // user, not the compaction instruction: scratchpad removal plus a sectioned
    // summary shape does not by itself establish compaction provenance, so the
    // artifact grace ends here (cherry-pr-review inv_5b861e177143056b).
    if (!message.isSynthetic && toolResults.length === 0 && getTextContent(content).some((text) => text.trim())) {
      this.hasSeenGenuineUserPrompt = true
      this.assistantAnswerSinceUserPrompt = false
      this.endCompactionArtifactGrace()
    }

    for (const result of toolResults) {
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
      if (ctx.textPartId) this.closeActiveTextPart(ctx)
    } else if (structuredOutput !== undefined) {
      const jsonTextId = generateId()
      const jsonText = JSON.stringify(structuredOutput)
      ctx.sink.enqueue({ type: 'text-start', id: jsonTextId })
      ctx.sink.enqueue({ type: 'text-delta', id: jsonTextId, delta: jsonText })
      ctx.sink.enqueue({ type: 'text-end', id: jsonTextId })
    } else if (ctx.textPartId) {
      this.closeActiveTextPart(ctx)
    } else if (
      ctx.accumulatedText &&
      !ctx.textStreamedViaContentBlock &&
      ctx.streamedTextLength < ctx.accumulatedText.length
    ) {
      const fallbackDelta = ctx.accumulatedText.slice(ctx.streamedTextLength)
      if (
        !(
          this.compactionArtifactWatchActive() &&
          this.classifyCompactionArtifactProbe(fallbackDelta, true, ctx) === 'artifact'
        )
      ) {
        const fallbackTextId = generateId()
        ctx.sink.enqueue({ type: 'text-start', id: fallbackTextId })
        ctx.sink.enqueue({ type: 'text-delta', id: fallbackTextId, delta: fallbackDelta })
        ctx.sink.enqueue({ type: 'text-end', id: fallbackTextId })
        this.endCompactionArtifactGrace()
      }
      ctx.streamedTextLength = ctx.accumulatedText.length
    }

    this.finalizeToolCalls(ctx)
    this.runtimeCompactionActive = false

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
        this.handleStatusSystemMessage(message, ctx)
        return
      case 'compact_boundary':
        this.handleCompactBoundarySystemMessage(message, ctx)
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
        if (this.hasBackgroundAgents()) this.awaitingBackgroundReply = true
        if (message.tasks.length > 0) {
          this.backgroundWorkReleasePending = false
          this.statusSink.emit({
            type: 'background-work-state',
            active: true,
            ...(!this.awaitingBackgroundReply ? { awaitingReply: false } : {})
          })
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
    if (this.backgroundTaskToolCallIds.get(taskId) === toolCallId) return
    this.backgroundTaskToolCallIds.set(taskId, toolCallId)
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
    // A transcript-visible task notification posts a background result the
    // assistant still owes an answer for: an earlier acknowledgement that the
    // work is running is not that answer. Leaving the prompt marked answered
    // would arm compaction-artifact grace against the requested follow-up and
    // suppress it (cherry-pr-review round-7 background-followup-suppression).
    // skip_transcript tasks (watchers, live updates) post no result and owe
    // no answer, so they leave provenance untouched.
    if (message.subtype === 'task_notification' && message.skip_transcript !== true) {
      this.assistantAnswerSinceUserPrompt = false
      this.endCompactionArtifactGrace()
    }
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

  private handleStatusSystemMessage(message: SDKStatusMessage, ctx: StreamContext): void {
    if (message.status === 'compacting') {
      this.closeActiveTextPart(ctx)
      ctx.accumulatedText = ''
      ctx.olSyncLen = -1
      ctx.accGen++
      ctx.streamedTextLength = 0
      this.runtimeCompactionActive = true
      this.compactionPreemptsPendingAnswer = this.hasSeenGenuineUserPrompt && !this.assistantAnswerSinceUserPrompt
      this.statusSink.emit({ type: 'compaction-start' })
      return
    }
    // A PreCompact hook may skip compaction: the SDK clears status without
    // compact_result or a boundary. No summary exchange follows that exit.
    if (this.runtimeCompactionActive && message.status === null && !message.compact_result && !message.compact_error) {
      this.runtimeCompactionActive = false
      this.compactionArtifactGrace = false
      this.compactionPreemptsPendingAnswer = false
      return
    }
    if (message.compact_result === 'failed' || message.compact_error) {
      this.runtimeCompactionActive = false
      logger.warn('Claude compaction failed', { sessionId: message.session_id, error: message.compact_error })
      this.statusSink.emit({ type: 'compaction-error', error: message.compact_error ?? 'Compaction failed' })
      return
    }
    if (message.compact_result === 'success') {
      // Success ends suppression: the SDK does not guarantee a boundary, so content after
      // success is post-compaction output and must stay visible. A later boundary still wins.
      // A compaction that preempted the pending user prompt's answer must not arm
      // the grace against that answer (cherry-pr-review inv_63b9c0bbf40500fd).
      this.runtimeCompactionActive = false
      this.compactionArtifactGrace = !this.compactionPreemptsPendingAnswer
      // closeActiveTextPart on compacting may have cleared textPartId while offsets still
      // reflect pre-compaction streaming; reset so snapshot reconciliation starts fresh.
      ctx.accumulatedText = ''
      ctx.olSyncLen = -1
      ctx.accGen++
      ctx.streamedTextLength = 0
      this.statusSink.emit({ type: 'compaction-complete' })
    }
  }

  private hasBackgroundAgents(): boolean {
    return this.backgroundTasks.some((task) => task.type === 'subagent' || task.type === 'local_agent')
  }

  private handleSessionStateChangedSystemMessage(message: SDKSessionStateChangedMessage): void {
    if (message.state !== 'idle') return
    // Idle means held-back results and the background-agent loop have drained, so no detached flow
    // can still stream. Drop the per-flow state instead of retaining it for the connection lifetime;
    // a late straggler simply gets a fresh context via `getOrCreateFlowContext`.
    if (!this.turnActive) this.flowContexts.length = 0
    if (this.awaitingBackgroundReply && !this.hasBackgroundAgents()) {
      this.awaitingBackgroundReply = false
      if (this.backgroundTasks.length > 0) {
        this.statusSink.emit({ type: 'background-work-state', active: true, awaitingReply: false })
      }
    }
    if (!this.backgroundWorkReleasePending) return
    this.backgroundWorkReleasePending = false
    this.statusSink.emit({ type: 'background-work-state', active: false })
  }

  private handleCompactBoundarySystemMessage(message: SDKCompactBoundaryMessage, ctx: StreamContext): void {
    this.runtimeCompactionActive = false
    // Same provenance rule as compact success: a preempted pending answer stays
    // visible (cherry-pr-review inv_63b9c0bbf40500fd).
    this.compactionArtifactGrace = !this.compactionPreemptsPendingAnswer
    // A boundary starts a fresh context window, so the next assistant snapshot is a new response.
    // Reset the streaming offsets or its prefix would be sliced against pre-compaction lengths.
    this.closeActiveTextPart(ctx)
    ctx.accumulatedText = ''
    ctx.olSyncLen = -1
    ctx.accGen++
    ctx.streamedTextLength = 0
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

  private isCompactionInternalContent(message: SDKMessage, parentToolUseId: string | null | undefined): boolean {
    if (parentToolUseId != null || !this.runtimeCompactionActive) return false
    if (message.type === 'stream_event' || message.type === 'assistant' || message.type === 'user') {
      logger.debug('Suppressing runtime compaction content from transcript stream', {
        type: message.type,
        sessionId: this.sessionId
      })
      return true
    }
    return false
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

  private textStartProviderMetadata(
    ctx: StreamContext,
    explicit?: Record<string, JSONObject>
  ): Record<string, JSONObject> | undefined {
    return explicit ?? this.buildParentProviderMetadata(ctx.textPartParentId)
  }

  private buildParentProviderMetadata(sdkParentToolUseId: SdkParentToolUseId): Record<string, JSONObject> | undefined {
    if (!sdkParentToolUseId) return undefined
    return {
      'claude-code': {
        parentToolCallId: sdkParentToolUseId
      },
      cherry: {
        transport: AGENT_RUNTIME_CAPABILITIES['claude-code'].transport
      }
    }
  }

  private buildToolProviderMetadata(state: ToolStreamState): Record<string, JSONObject> {
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

  private flushScratchpadStreamRemainder(ctx: StreamContext): void {
    // The fence carry pairs remainder content that starts inside an open code
    // fence; it is consumed here whether or not a remainder is pending.
    const fenceCarry = ctx.scratchpadStreamFenceCarry
    ctx.scratchpadStreamFenceCarry = ''
    if (!ctx.scratchpadStreamRemainder) return
    // Scan the remainder with the same open-line context the streaming filter
    // carries, or flushed literal code can lose its block classification at
    // the boundary (cherry-pr-review inv_f7b234887ed722ff).
    // The same literal-markup carry the streaming filter applies: without it
    // a buffered remainder inside an unclosed element or comment loses its
    // context at flush (cherry-pr-review round-12 buffered-html-flush-context).
    this.updateHtmlStreamCarry(ctx)
    const openLinePrefix = this.emittedOpenLinePrefixWithState(ctx.scratchpadMaskState, ctx)
    const indentPrefix = this.emittedIndentOnlyLinePrefixFor(ctx)
    const prefix =
      fenceCarry +
      ctx.scratchpadStreamHtmlCarry +
      (openLinePrefix !== '' ? openLinePrefix : (ctx.scratchpadStreamEscapeCarry ? '\\' : '') + indentPrefix)
    const pending = prefix + ctx.scratchpadStreamRemainder
    ctx.scratchpadStreamRemainder = ''
    ctx.scratchpadStreamEscapeCarry = false
    const stripped = stripKnownModelScratchpadBlocksPreservingCodeFencesStepped(pending, {
      initialMaskState: ctx.scratchpadMaskState
    })
    let visible = stripped
    if (prefix !== '') {
      const strippedPrefix = stripKnownModelScratchpadBlocksPreservingCodeFencesStepped(prefix, {
        initialMaskState: ctx.scratchpadMaskState
      })
      let shared = 0
      const limit = Math.min(strippedPrefix.length, stripped.length)
      while (shared < limit && strippedPrefix[shared] === stripped[shared]) shared++
      visible = stripped.slice(shared)
    }
    if (visible) {
      this.appendVisibleTextDelta(visible, ctx)
    }
  }

  private closeActiveTextPart(ctx: StreamContext): void {
    if (!ctx.textPartId) return
    const closedTextId = ctx.textPartId
    this.flushDeferredScratchpadText(ctx)
    this.flushScratchpadStreamRemainder(ctx)
    this.flushToolProtocolStripRemainder(ctx)
    if (!ctx.suppressActiveTextPart && ctx.textPartStarted) {
      ctx.sink.enqueue({ type: 'text-end', id: closedTextId })
    }
    ctx.textPartId = undefined
    ctx.scratchpadTextProbe = ''
    ctx.scratchpadStreamRemainder = ''
    ctx.scratchpadStreamEscapeCarry = false
    ctx.scratchpadStreamFenceCarry = ''
    ctx.scratchpadStreamHtmlCarry = ''
    ctx.scratchpadStreamHtmlCarryScanned = 0
    ctx.scratchpadStreamHtmlCarryBase = -1
    ctx.scratchpadMaskState = initialIndentedMaskState()
    ctx.scratchpadMaskStateUnstepped = ''
    ctx.scratchpadMaskUnsteppedEolFree = true
    ctx.scratchpadMaskAdvanceRawQueue = ''
    ctx.scratchpadMaskHeldFence = null
    ctx.scratchpadOpenLineCarry = null
    ctx.scratchpadQuoteCarry = null
    this.resetToolProtocolStripState(ctx)
    ctx.suppressActiveTextPart = false
    ctx.suppressCompactionArtifactPart = false
    ctx.textStartDeferred = false
    ctx.textPartStarted = false
    ctx.textPartParentId = null
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
