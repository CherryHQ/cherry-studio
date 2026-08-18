import { closeSync, fstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'

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
import { application } from '@application'
import { loggerService } from '@logger'
import { extractSystemReminderBodies, SystemReminderTextFilter } from '@main/ai/steerReminder'
import { t } from '@main/i18n'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import {
  type AgentSessionBackgroundTask,
  isTerminalAgentSessionTaskStatus
} from '@shared/ai/agentSessionBackgroundTasks'
import type { AgentSessionCompactionAnchorData } from '@shared/ai/agentSessionCompaction'
import { parseClaudeCodeBackgroundBashReceipt } from '@shared/ai/claudeCodeInternalProtocol'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { CherryUIMessageChunk, CherryUIMessageMetadata, MessageStats } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'
import { isMcpContentBlock } from '@shared/utils/mcp'

import type { AgentRuntimeEvent } from '../types'
import type { McpToolDisplayMetadata } from './types'
import {
  type LocalWorkflowLaunch,
  type LocalWorkflowPlan,
  parseLocalWorkflowLaunch,
  parseLocalWorkflowPlan,
  parseWorkflowSnapshotText,
  updateLocalWorkflowSnapshot
} from './workflowSnapshot'

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
const MAX_WORKFLOW_SNAPSHOT_BYTES = 1_048_576
const AGENT_TRANSCRIPT_READ_CHUNK_BYTES = 256 * 1024
const MAX_AGENT_TRANSCRIPT_READ_BYTES_PER_PASS = 512 * 1024
const TERMINAL_TASK_RECONCILE_DELAY_MS = 1000
const TERMINAL_TASK_RECONCILE_MAX_ATTEMPTS = 3
const CLAUDE_PROJECT_DIRECTORY_INDEX_TTL_MS = 30_000
const BACKGROUND_BASH_HEAD_BYTES = 32 * 1024
const BACKGROUND_BASH_TAIL_BYTES = 32 * 1024
const BACKGROUND_BASH_POLL_INTERVAL_MS = 1000
const SAFE_TRANSCRIPT_ID = /^[A-Za-z0-9_-]{1,128}$/

// ── Internal types ──────────────────────────────────────────────────

type BetaUsage = SDKResultMessage['usage']
type SdkParentToolUseId = SDKAssistantMessage['parent_tool_use_id']
type SdkTaskSystemMessage =
  | SDKTaskNotificationMessage
  | SDKTaskProgressMessage
  | SDKTaskStartedMessage
  | SDKTaskUpdatedMessage
type SdkTaskProgressRuntimeMessage = SDKTaskProgressMessage & { workflow_progress?: unknown }
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

type BackgroundBashOutputState = {
  toolCallId: string
  outputFile: string
  lastOutput?: string
  sizeBytes?: number
  mtimeMs?: number
  timer?: NodeJS.Timeout
}

type WorkflowSnapshotCacheEntry = {
  snapshotPath: string
  sizeBytes: number
  mtimeMs: number
  workflow?: AgentTaskEventPartData['workflow']
}

type AgentUsageStats = {
  cumulativeTokens: number
  latestTokens: number
  latestMessageId?: string
  messageTokens: Map<string, number>
  totalToolCalls: number
  toolCallIds: Set<string>
}

type AgentTranscriptStatsCacheEntry = AgentUsageStats & {
  transcriptPath: string
  sizeBytes: number
  mtimeMs: number
  readOffset: number
  pendingLine: Buffer
}

type PendingTerminalWorkflowState = {
  eventData: AgentTaskEventPartData
  timer: NodeJS.Timeout
  /** Attempts made while the snapshot/transcript is still catching up with the terminal event. */
  attempts: number
}

type PendingTerminalAgentState = PendingTerminalWorkflowState & {
  sdkSessionId: string
}

type ClaudeProjectDirectoryIndex = {
  projectDirectories: string[]
  scannedAt: number
}

const claudeProjectDirectoryIndexes = new Map<string, ClaudeProjectDirectoryIndex>()

export type ClaudeCodeStreamAdapterOptions = {
  modelId: string
  /** Cherry session id — for logs only; `onSessionId` reports the runtime's own id. */
  sessionId: string
  claudeConfigDir?: string
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
  if (!isRecord(result)) return undefined
  if (result.status !== 'async_launched' && result.status !== 'remote_launched') return undefined
  const id = result.taskId ?? result.agentId
  return typeof id === 'string' && id ? id : undefined
}

function getBackgroundBashTaskId(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined
  const id = result.backgroundTaskId
  return typeof id === 'string' && id ? id : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type CompletedAgentOutputStats = {
  agentId: string
  contextTokens?: number
  toolUses?: number
  durationMs?: number
}

function getCompletedAgentOutputStats(value: unknown): CompletedAgentOutputStats | undefined {
  if (!isRecord(value) || value.status !== 'completed' || typeof value.agentId !== 'string' || !value.agentId) {
    return undefined
  }

  const contextTokens =
    typeof value.totalTokens === 'number' && Number.isFinite(value.totalTokens) && value.totalTokens > 0
      ? value.totalTokens
      : undefined
  const toolUses =
    typeof value.totalToolUseCount === 'number' &&
    Number.isFinite(value.totalToolUseCount) &&
    value.totalToolUseCount >= 0
      ? value.totalToolUseCount
      : undefined
  const durationMs =
    typeof value.totalDurationMs === 'number' && Number.isFinite(value.totalDurationMs) && value.totalDurationMs >= 0
      ? value.totalDurationMs
      : undefined
  return {
    agentId: value.agentId,
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(durationMs !== undefined ? { durationMs } : {})
  }
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

function getSdkMessageTimestamp(message: SDKMessage): string {
  const timestamp = (message as unknown as { timestamp?: unknown }).timestamp
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return new Date().toISOString()
}

function hasWorkflowStatsChanged(
  previous: AgentTaskEventPartData['workflow'] | undefined,
  next: NonNullable<AgentTaskEventPartData['workflow']>
): boolean {
  if (!previous) return true
  const signature = (workflow: NonNullable<AgentTaskEventPartData['workflow']>) =>
    JSON.stringify([
      workflow.totalTokens ?? null,
      workflow.totalCumulativeTokens ?? null,
      workflow.totalToolCalls ?? null,
      workflow.workflowProgress.flatMap((item) =>
        item.type === 'workflow_agent'
          ? [[item.index, item.tokens ?? null, item.cumulativeTokens ?? null, item.toolCalls ?? null]]
          : []
      )
    ])
  return signature(previous) !== signature(next)
}

function hasAgentUsageChanged(
  previous: AgentTaskEventPartData['usage'] | undefined,
  next: NonNullable<AgentTaskEventPartData['usage']>
): boolean {
  return (
    previous?.totalTokens !== next.totalTokens ||
    previous?.contextTokens !== next.contextTokens ||
    previous?.toolUses !== next.toolUses ||
    previous?.durationMs !== next.durationMs
  )
}

function readBufferAt(fd: number, length: number, position: number): Buffer {
  const buffer = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const bytesRead = readSync(fd, buffer, offset, length - offset, position + offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset)
}

function readUtf8FileWithinLimit(
  filePath: string,
  maxBytes: number,
  cached?: Pick<WorkflowSnapshotCacheEntry, 'sizeBytes' | 'mtimeMs'>
): { text?: string; sizeBytes: number; mtimeMs: number; oversized: boolean; unchanged: boolean } {
  const fd = openSync(filePath, 'r')
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('Path is not a regular file')
    if (cached && cached.sizeBytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return { sizeBytes: stat.size, mtimeMs: stat.mtimeMs, oversized: false, unchanged: true }
    }
    if (stat.size > maxBytes) {
      return { sizeBytes: stat.size, mtimeMs: stat.mtimeMs, oversized: true, unchanged: false }
    }
    return {
      text: readBufferAt(fd, stat.size, 0).toString('utf8'),
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      oversized: false,
      unchanged: false
    }
  } finally {
    closeSync(fd)
  }
}

function getClaudeProjectDirectories(claudeConfigDir: string): readonly string[] {
  const indexKey = path.resolve(claudeConfigDir, 'projects')
  const cached = claudeProjectDirectoryIndexes.get(indexKey)
  if (cached && Date.now() - cached.scannedAt < CLAUDE_PROJECT_DIRECTORY_INDEX_TTL_MS) {
    return cached.projectDirectories
  }

  try {
    const projectsDir = realpathSync(indexKey)
    const projectDirectories: string[] = []
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      try {
        const projectDir = realpathSync(path.join(projectsDir, entry.name))
        if (path.dirname(projectDir) === projectsDir) projectDirectories.push(projectDir)
      } catch {
        // A project directory can disappear while Claude rotates its local session state.
      }
    }
    claudeProjectDirectoryIndexes.set(indexKey, { projectDirectories, scannedAt: Date.now() })
    return projectDirectories
  } catch {
    const projectDirectories = cached?.projectDirectories ?? []
    claudeProjectDirectoryIndexes.set(indexKey, { projectDirectories, scannedAt: Date.now() })
    return projectDirectories
  }
}

function createAgentUsageStats(): AgentUsageStats {
  return {
    cumulativeTokens: 0,
    latestTokens: 0,
    messageTokens: new Map(),
    totalToolCalls: 0,
    toolCallIds: new Set()
  }
}

function hasAgentUsageStats(stats: AgentUsageStats | undefined): stats is AgentUsageStats {
  return Boolean(stats && (stats.messageTokens.size > 0 || stats.toolCallIds.size > 0))
}

function applyAssistantMessageStats(message: unknown, stats: AgentUsageStats): boolean {
  if (!isRecord(message)) return false

  let changed = false
  const content = message.content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block) || typeof block.id !== 'string' || !block.id || stats.toolCallIds.has(block.id)) continue
      switch (block.type) {
        case 'tool_use':
        case 'server_tool_use':
        case 'mcp_tool_use':
          stats.toolCallIds.add(block.id)
          stats.totalToolCalls += 1
          changed = true
      }
    }
  }

  const messageId = message.id
  const usage = isRecord(message.usage) ? message.usage : undefined
  if (typeof messageId !== 'string' || !messageId || !usage) return changed

  const inputTokens = usage.input_tokens
  const outputTokens = usage.output_tokens
  if (
    typeof inputTokens !== 'number' ||
    !Number.isInteger(inputTokens) ||
    inputTokens < 0 ||
    typeof outputTokens !== 'number' ||
    !Number.isInteger(outputTokens) ||
    outputTokens < 0
  ) {
    return changed
  }

  let total = inputTokens + outputTokens
  for (const key of ['cache_creation_input_tokens', 'cache_read_input_tokens'] as const) {
    const tokens = usage[key]
    if (tokens === undefined || tokens === null) continue
    if (typeof tokens !== 'number' || !Number.isInteger(tokens) || tokens < 0) return changed
    total += tokens
  }
  if (total <= 0) return changed

  const previous = stats.messageTokens.get(messageId)
  if (previous !== undefined && total <= previous) return changed
  stats.messageTokens.set(messageId, total)
  stats.cumulativeTokens += total - (previous ?? 0)
  if (previous === undefined) {
    stats.latestMessageId = messageId
    stats.latestTokens = total
  } else if (stats.latestMessageId === messageId) {
    stats.latestTokens = total
  }
  return true
}

function applyAssistantTranscriptStats(line: string, cache: AgentTranscriptStatsCacheEntry): void {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return
  }
  if (!isRecord(value) || value.type !== 'assistant' || value.isApiErrorMessage === true) return
  applyAssistantMessageStats(value.message, cache)
}

function readAgentTranscriptStats(
  transcriptPath: string,
  cached?: AgentTranscriptStatsCacheEntry
): AgentTranscriptStatsCacheEntry {
  const fd = openSync(transcriptPath, 'r')
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('Path is not a regular file')
    let cache = cached
    if (!cache) {
      cache = {
        transcriptPath,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        readOffset: 0,
        pendingLine: Buffer.alloc(0),
        ...createAgentUsageStats()
      }
    } else if (
      stat.size < cache.readOffset ||
      (stat.size === cache.sizeBytes && stat.mtimeMs !== cache.mtimeMs && cache.readOffset === stat.size)
    ) {
      cache.readOffset = 0
      cache.pendingLine = Buffer.alloc(0)
    }
    if (cache.readOffset >= stat.size && cache.sizeBytes === stat.size && cache.mtimeMs === stat.mtimeMs) return cache

    let bytesReadThisPass = 0
    while (cache.readOffset < stat.size && bytesReadThisPass < MAX_AGENT_TRANSCRIPT_READ_BYTES_PER_PASS) {
      const length = Math.min(
        AGENT_TRANSCRIPT_READ_CHUNK_BYTES,
        stat.size - cache.readOffset,
        MAX_AGENT_TRANSCRIPT_READ_BYTES_PER_PASS - bytesReadThisPass
      )
      const chunk = readBufferAt(fd, length, cache.readOffset)
      if (chunk.length === 0) break
      cache.readOffset += chunk.length
      bytesReadThisPass += chunk.length

      const buffer = cache.pendingLine.length > 0 ? Buffer.concat([cache.pendingLine, chunk]) : chunk
      const completeEnd = buffer.lastIndexOf(0x0a)
      if (completeEnd < 0) {
        cache.pendingLine = buffer
        continue
      }

      const lines = buffer
        .subarray(0, completeEnd + 1)
        .toString('utf8')
        .split(/\r?\n/)
      for (const line of lines) applyAssistantTranscriptStats(line, cache)
      cache.pendingLine = buffer.subarray(completeEnd + 1)
    }
    cache.sizeBytes = stat.size
    cache.mtimeMs = stat.mtimeMs
    return cache
  } finally {
    closeSync(fd)
  }
}

function readBackgroundBashOutputFile(filePath: string): {
  text: string
  sizeBytes: number
  mtimeMs: number
  truncated: boolean
} {
  const fd = openSync(filePath, 'r')
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('Path is not a regular file')
    const maxBytes = BACKGROUND_BASH_HEAD_BYTES + BACKGROUND_BASH_TAIL_BYTES
    if (stat.size <= maxBytes) {
      return {
        text: readBufferAt(fd, stat.size, 0).toString('utf8'),
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        truncated: false
      }
    }

    const head = readBufferAt(fd, BACKGROUND_BASH_HEAD_BYTES, 0)
    const tail = readBufferAt(fd, BACKGROUND_BASH_TAIL_BYTES, stat.size - BACKGROUND_BASH_TAIL_BYTES)
    const omittedBytes = Math.max(0, stat.size - head.length - tail.length)
    return {
      text: `${head.toString('utf8')}\n${t('agent.session.background_bash.output_truncated', { omittedBytes })}\n${tail.toString('utf8')}`,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      truncated: true
    }
  } finally {
    closeSync(fd)
  }
}

function extractBackgroundBashReceipt(content: unknown): { taskId: string; outputFile: string } | undefined {
  const texts = getTextContent(content)
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const receipt = parseClaudeCodeBackgroundBashReceipt(texts[index])
    if (receipt) return receipt
  }
  return undefined
}

export class ClaudeCodeStreamAdapter {
  private ctx: StreamContext
  private readonly modelId: string
  private readonly sessionId: string
  private readonly claudeConfigDir?: string
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
  private readonly backgroundTaskTypes = new Map<string, string>()
  private readonly terminalTaskIds = new Set<string>()
  private readonly taskTimelines = new Map<string, { createdAt: string; completedAt?: string }>()
  private readonly localWorkflowLaunches = new Map<string, LocalWorkflowLaunch>()
  private readonly localWorkflowPlans = new Map<string, LocalWorkflowPlan>()
  private readonly localWorkflowLiveSnapshots = new Map<string, NonNullable<AgentTaskEventPartData['workflow']>>()
  private readonly localWorkflowRuntimeProgresses = new Map<string, unknown[]>()
  private readonly persistedWorkflowSnapshotTaskIds = new Set<string>()
  private readonly persistedTerminalWorkflowSnapshotTaskIds = new Set<string>()
  private readonly workflowSnapshotCache = new Map<string, WorkflowSnapshotCacheEntry>()
  private readonly workflowTranscriptStatsCaches = new Map<string, Map<string, AgentTranscriptStatsCacheEntry>>()
  private readonly pendingTerminalWorkflowEvents = new Map<string, PendingTerminalWorkflowState>()
  private readonly pendingTerminalAgentEvents = new Map<string, PendingTerminalAgentState>()
  private readonly claudeSessionProjectDirectories = new Map<string, string>()
  private readonly agentTranscriptStatsCaches = new Map<string, AgentTranscriptStatsCacheEntry>()
  private readonly agentTaskIdsByToolCallId = new Map<string, string>()
  private readonly agentFlowStats = new Map<string, AgentUsageStats>()
  private readonly asyncAgentTaskIds = new Set<string>()
  private readonly backgroundBashOutputs = new Map<string, BackgroundBashOutputState>()
  private disposed = false
  /** Parented SDK streams get independent state so subagent text/tool deltas cannot pollute the
   *  main agent's counters. Their sink is detached from the turn when that turn completes. */
  private readonly flowContexts: FlowContext[] = []
  /** `system/init` can arrive before the first turn opens, so its metadata chunk waits for one. */
  private pendingInit?: Extract<SDKMessage, { subtype: 'init' }>
  private turnHasActivity = false

  constructor(options: ClaudeCodeStreamAdapterOptions) {
    this.modelId = options.modelId
    this.sessionId = options.sessionId
    this.claudeConfigDir = options.claudeConfigDir
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

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearBackgroundTaskState()
    this.backgroundTasks = []
    this.backgroundWorkReleasePending = false
    this.flowContexts.length = 0
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
      if (message.type === 'assistant') this.updateAgentFlowStats(flow.rootToolCallId, message)
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
    const toolResults = this.extractToolResults(content)
    const structuredResult = toolResults.length === 1 ? message.tool_use_result : undefined

    for (const result of toolResults) {
      this.handleToolResult(
        result,
        sdkParentToolUseId,
        ctx,
        structuredResult,
        getSdkMessageTimestamp(message),
        message.session_id
      )
    }
  }

  private handleToolResult(
    result: ClaudeToolResultBlock,
    sdkParentToolUseId: SdkParentToolUseId,
    ctx: StreamContext,
    structuredResult?: unknown,
    resultTimestamp?: string,
    sdkSessionId?: string
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

    const isProviderWorkflow = toolName === 'Workflow' && state.toolType !== 'mcp'
    if (isProviderWorkflow && structuredResult !== undefined && resultTimestamp) {
      this.registerLocalWorkflowLaunch(result.tool_use_id, structuredResult, resultTimestamp)
    }

    const normalizedResult = this.normalizeToolResult(result.content)
    const normalizedStructuredResult =
      structuredResult === undefined ? undefined : this.normalizeToolResult(structuredResult)
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
    const isProviderBash = toolName === 'Bash' && state.toolType !== 'mcp'
    const completedAgentOutput =
      !isError && isSubagentToolName(toolName) && normalizedStructuredResult !== undefined
        ? getCompletedAgentOutputStats(normalizedStructuredResult)
        : undefined
    let backgroundTaskId: string | undefined
    if (!isError) {
      const launchResult =
        (isSubagentToolName(toolName) || isProviderWorkflow || isProviderBash) &&
        normalizedStructuredResult !== undefined
          ? normalizedStructuredResult
          : normalizedResult
      backgroundTaskId = isProviderBash
        ? getBackgroundBashTaskId(launchResult)
        : getLaunchedBackgroundTaskId(launchResult)
      if (backgroundTaskId && (isSubagentToolName(toolName) || isProviderWorkflow || isProviderBash)) {
        this.registerBackgroundTaskToolCallId(backgroundTaskId, result.tool_use_id)
        if (isSubagentToolName(toolName)) {
          this.asyncAgentTaskIds.add(backgroundTaskId)
          this.registerAgentTaskToolCallId(backgroundTaskId, result.tool_use_id)
        }
        if (isProviderBash) this.backgroundTaskTypes.set(backgroundTaskId, 'local_bash')
      }
      if (completedAgentOutput) {
        this.registerAgentTaskToolCallId(completedAgentOutput.agentId, result.tool_use_id)
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
    if (!isError && isProviderBash && backgroundTaskId && sdkSessionId) {
      this.registerBackgroundBashOutput(backgroundTaskId, result.tool_use_id, result.content, sdkSessionId)
    }
    if (completedAgentOutput) {
      this.publishCompletedAgentOutput(result.tool_use_id, completedAgentOutput, resultTimestamp, sdkSessionId)
    }
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
      case 'background_tasks_changed': {
        // Missing members can precede their terminal edge, so retain them until that edge or idle.
        const nextTasks = new Map(
          message.tasks.map((task) => {
            this.backgroundTaskTypes.set(task.task_id, task.task_type)
            if (task.task_type === 'local_agent' || task.task_type === 'subagent') {
              this.asyncAgentTaskIds.add(task.task_id)
            }
            return [
              task.task_id,
              {
                id: task.task_id,
                type: task.task_type,
                description: task.description
              } satisfies AgentSessionBackgroundTask
            ] as const
          })
        )
        const retainedTasks: AgentSessionBackgroundTask[] = []
        for (const task of this.backgroundTasks) {
          const next = nextTasks.get(task.id)
          if (next) {
            retainedTasks.push(next)
            nextTasks.delete(task.id)
          } else if (!this.terminalTaskIds.has(task.id)) {
            retainedTasks.push(task)
          }
        }
        for (const task of nextTasks.values()) {
          if (!this.terminalTaskIds.has(task.id)) retainedTasks.push(task)
        }
        this.backgroundTasks = retainedTasks
        this.publishBackgroundTasks()
        if (message.tasks.length > 0) {
          this.backgroundWorkReleasePending = false
          this.statusSink.emit({ type: 'background-work-state', active: true })
        } else {
          this.backgroundWorkReleasePending = true
        }
        return
      }
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

  private registerAgentTaskToolCallId(taskId: string, toolCallId: string): void {
    this.registerBackgroundTaskToolCallId(taskId, toolCallId)
    this.agentTaskIdsByToolCallId.set(toolCallId, taskId)
  }

  private getAgentUsage(
    stats: AgentUsageStats | undefined,
    reported: AgentTaskEventPartData['usage'] | undefined,
    terminal: boolean
  ): AgentTaskEventPartData['usage'] | undefined {
    const hasTokenStats = Boolean(stats && stats.messageTokens.size > 0)
    const hasToolStats = Boolean(stats && (hasTokenStats || stats.toolCallIds.size > 0))
    const manualToolUses = hasToolStats ? stats?.totalToolCalls : undefined
    let toolUses = reported?.toolUses
    if ((!terminal || toolUses === undefined) && manualToolUses !== undefined) {
      toolUses = toolUses === undefined ? manualToolUses : Math.max(manualToolUses, toolUses)
    }
    const contextTokens =
      terminal && reported?.contextTokens !== undefined
        ? reported.contextTokens
        : hasTokenStats && stats && stats.latestTokens > 0
          ? stats.latestTokens
          : reported?.contextTokens
    const usage = {
      ...(hasTokenStats && stats && stats.cumulativeTokens > 0 ? { totalTokens: stats.cumulativeTokens } : {}),
      ...(contextTokens !== undefined ? { contextTokens } : {}),
      ...(toolUses !== undefined ? { toolUses } : {}),
      ...(reported?.durationMs !== undefined ? { durationMs: reported.durationMs } : {})
    }
    return Object.keys(usage).length > 0 ? usage : undefined
  }

  private updateAgentFlowStats(rootToolCallId: string, message: SDKAssistantMessage): void {
    const taskId = this.agentTaskIdsByToolCallId.get(rootToolCallId)
    const flowStats = this.agentFlowStats.get(rootToolCallId) ?? createAgentUsageStats()
    if (!this.agentFlowStats.has(rootToolCallId)) this.agentFlowStats.set(rootToolCallId, flowStats)
    const flowChanged = applyAssistantMessageStats(message.message, flowStats)
    if (!taskId || this.terminalTaskIds.has(taskId)) return

    const cachedTranscriptStats = this.agentTranscriptStatsCaches.get(taskId)
    const previousTranscriptStats = cachedTranscriptStats
      ? {
          cumulativeTokens: cachedTranscriptStats.cumulativeTokens,
          latestTokens: cachedTranscriptStats.latestTokens,
          totalToolCalls: cachedTranscriptStats.totalToolCalls
        }
      : undefined
    const transcriptStats = this.readAgentTaskTranscriptStats(taskId, message.session_id)
    const transcriptChanged = Boolean(
      transcriptStats &&
        (transcriptStats.cumulativeTokens !== (previousTranscriptStats?.cumulativeTokens ?? 0) ||
          transcriptStats.latestTokens !== (previousTranscriptStats?.latestTokens ?? 0) ||
          transcriptStats.totalToolCalls !== (previousTranscriptStats?.totalToolCalls ?? 0))
    )
    if (!flowChanged && !transcriptChanged) return

    const stats = hasAgentUsageStats(transcriptStats) ? transcriptStats : flowStats
    const usage = this.getAgentUsage(stats, undefined, false)
    if (!usage) return
    const eventData: AgentTaskEventPartData = {
      event: 'progress',
      taskId,
      toolUseId: rootToolCallId,
      status: 'in_progress',
      ...(this.asyncAgentTaskIds.has(taskId) ? { isBackgrounded: true } : {}),
      ...this.getTaskTimeline(taskId, 'in_progress', getSdkMessageTimestamp(message)),
      usage
    }
    this.statusSink.emit({ type: 'background-task-event', data: eventData })
    if (this.turnActive && this.ctx.toolStates.has(rootToolCallId)) {
      this.ctx.sink.enqueue({
        type: 'data-agent-task-event',
        id: `task-${taskId}-progress`,
        data: eventData
      })
    }
  }

  private publishCompletedAgentOutput(
    toolCallId: string,
    completed: CompletedAgentOutputStats,
    timestamp?: string,
    sdkSessionId?: string
  ): void {
    const reportedUsage: NonNullable<AgentTaskEventPartData['usage']> = {
      ...(completed.contextTokens !== undefined ? { contextTokens: completed.contextTokens } : {}),
      ...(completed.toolUses !== undefined ? { toolUses: completed.toolUses } : {}),
      ...(completed.durationMs !== undefined ? { durationMs: completed.durationMs } : {})
    }
    const transcriptStats = sdkSessionId
      ? this.readAgentTaskTranscriptStats(completed.agentId, sdkSessionId)
      : undefined
    const usage = this.getAgentUsage(
      hasAgentUsageStats(transcriptStats) ? transcriptStats : this.agentFlowStats.get(toolCallId),
      reportedUsage,
      true
    )
    const eventData: AgentTaskEventPartData = {
      event: 'notification',
      taskId: completed.agentId,
      toolUseId: toolCallId,
      status: 'completed',
      ...(this.asyncAgentTaskIds.has(completed.agentId) ? { isBackgrounded: true } : {}),
      ...this.getTaskTimeline(completed.agentId, 'completed', timestamp ?? new Date().toISOString()),
      ...(usage ? { usage } : {})
    }
    this.statusSink.emit({ type: 'background-task-event', data: eventData })
    this.terminalTaskIds.add(completed.agentId)
    const taskIndex = this.backgroundTasks.findIndex((task) => task.id === completed.agentId)
    if (taskIndex >= 0) {
      this.backgroundTasks.splice(taskIndex, 1)
      this.publishBackgroundTasks()
    }
    if (sdkSessionId) {
      this.scheduleTerminalAgentReconciliation(eventData, sdkSessionId)
    } else {
      this.releaseTerminalTaskState(completed.agentId)
    }
  }

  private registerBackgroundBashOutput(
    taskId: string,
    toolCallId: string,
    content: unknown,
    sdkSessionId: string
  ): void {
    if (this.disposed) return
    const receipt = extractBackgroundBashReceipt(content)
    const outputFile =
      receipt?.taskId === taskId ? this.validateTaskOutputPath(receipt.outputFile, taskId, sdkSessionId) : undefined
    if (!outputFile) {
      logger.warn('Rejected background Bash output receipt', {
        sessionId: this.sessionId,
        sdkSessionId,
        taskId,
        receiptTaskId: receipt?.taskId,
        outputFile: receipt?.outputFile
      })
      return
    }

    this.stopBackgroundBashPolling(taskId, true)
    const state: BackgroundBashOutputState = { toolCallId, outputFile }
    const timer = setInterval(() => this.pollBackgroundBashOutput(taskId), BACKGROUND_BASH_POLL_INTERVAL_MS)
    timer.unref()
    state.timer = timer
    this.backgroundBashOutputs.set(taskId, state)
    this.pollBackgroundBashOutput(taskId)
  }

  private validateTaskOutputPath(outputFile: string, taskId: string, sdkSessionId: string): string | undefined {
    if (!path.isAbsolute(outputFile)) return undefined
    try {
      const claudeRoot = realpathSync(path.join(application.getPath('sys.temp'), 'claude'))
      const canonicalOutputFile = realpathSync(outputFile)
      const relative = path.relative(claudeRoot, canonicalOutputFile)
      if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        return undefined
      }
      const segments = relative.split(path.sep)
      if (
        segments.length !== 4 ||
        segments[1] !== sdkSessionId ||
        segments[2] !== 'tasks' ||
        segments[3] !== `${taskId}.output`
      ) {
        return undefined
      }
      return canonicalOutputFile
    } catch {
      return undefined
    }
  }

  private pollBackgroundBashOutput(taskId: string): void {
    const state = this.backgroundBashOutputs.get(taskId)
    if (!state || this.disposed) return
    try {
      const stat = statSync(state.outputFile)
      if (state.sizeBytes === stat.size && state.mtimeMs === stat.mtimeMs) return
    } catch {
      return
    }
    const result = this.readBackgroundBashOutput(taskId, state, false)
    if (!result || result.text === state.lastOutput) return
    state.lastOutput = result.text
    this.emitBackgroundToolChunk(state.toolCallId, {
      type: 'tool-output-available',
      toolCallId: state.toolCallId,
      output: result.text,
      dynamic: true,
      providerExecuted: true,
      preliminary: true
    })
  }

  private readBackgroundBashOutput(
    taskId: string,
    state: BackgroundBashOutputState,
    warnOnError: boolean
  ): ReturnType<typeof readBackgroundBashOutputFile> | undefined {
    try {
      const result = readBackgroundBashOutputFile(state.outputFile)
      state.sizeBytes = result.sizeBytes
      state.mtimeMs = result.mtimeMs
      if (result.truncated && result.text !== state.lastOutput) {
        logger.warn('Truncated background Bash output', {
          sessionId: this.sessionId,
          taskId,
          outputFile: state.outputFile,
          sizeBytes: result.sizeBytes
        })
      }
      return result
    } catch (error) {
      if (warnOnError) {
        logger.warn('Failed to read background Bash output', {
          sessionId: this.sessionId,
          taskId,
          outputFile: state.outputFile,
          error
        })
      }
      return undefined
    }
  }

  private stopBackgroundBashPolling(taskId: string, remove: boolean): BackgroundBashOutputState | undefined {
    const state = this.backgroundBashOutputs.get(taskId)
    if (!state) return undefined
    if (state.timer) {
      clearInterval(state.timer)
      state.timer = undefined
    }
    if (remove) this.backgroundBashOutputs.delete(taskId)
    return state
  }

  private emitBackgroundToolChunk(toolCallId: string, chunk: CherryUIMessageChunk): void {
    const flow = this.flowContexts.find((candidate) => candidate.stream.toolStates.has(toolCallId))
    if (flow) {
      flow.stream.sink.enqueue(chunk)
      return
    }
    if (this.turnActive && this.ctx.toolStates.has(toolCallId)) {
      this.ctx.sink.enqueue(chunk)
      return
    }
    this.statusSink.emit({ type: 'background-flow-chunk', rootToolCallId: toolCallId, chunk })
  }

  private clearBackgroundTaskState(): void {
    for (const taskId of this.backgroundBashOutputs.keys()) this.stopBackgroundBashPolling(taskId, false)
    for (const pending of this.pendingTerminalWorkflowEvents.values()) clearTimeout(pending.timer)
    for (const pending of this.pendingTerminalAgentEvents.values()) clearTimeout(pending.timer)
    this.backgroundBashOutputs.clear()
    this.backgroundTaskToolCallIds.clear()
    this.backgroundTaskTypes.clear()
    this.terminalTaskIds.clear()
    this.taskTimelines.clear()
    this.localWorkflowLaunches.clear()
    this.localWorkflowPlans.clear()
    this.localWorkflowLiveSnapshots.clear()
    this.localWorkflowRuntimeProgresses.clear()
    this.persistedWorkflowSnapshotTaskIds.clear()
    this.persistedTerminalWorkflowSnapshotTaskIds.clear()
    this.workflowSnapshotCache.clear()
    this.workflowTranscriptStatsCaches.clear()
    this.pendingTerminalWorkflowEvents.clear()
    this.pendingTerminalAgentEvents.clear()
    this.claudeSessionProjectDirectories.clear()
    this.agentTranscriptStatsCaches.clear()
    this.agentTaskIdsByToolCallId.clear()
    this.agentFlowStats.clear()
    this.asyncAgentTaskIds.clear()
  }

  private registerLocalWorkflowLaunch(toolCallId: string, value: unknown, createdAt: string): void {
    const launch = parseLocalWorkflowLaunch(value, createdAt)
    if (!launch) return

    this.localWorkflowLaunches.set(launch.taskId, launch)
    this.localWorkflowLiveSnapshots.delete(launch.taskId)
    this.localWorkflowRuntimeProgresses.delete(launch.taskId)
    this.workflowSnapshotCache.delete(launch.taskId)
    this.workflowTranscriptStatsCaches.delete(launch.taskId)
    this.backgroundTaskTypes.set(launch.taskId, 'local_workflow')
    if (!this.taskTimelines.has(launch.taskId)) this.taskTimelines.set(launch.taskId, { createdAt: launch.createdAt })
    this.registerBackgroundTaskToolCallId(launch.taskId, toolCallId)
  }

  private getTaskTimeline(
    taskId: string,
    status: AgentTaskEventPartData['status'],
    eventTimestamp: string
  ): { createdAt: string; completedAt?: string } {
    const timeline =
      this.taskTimelines.get(taskId) ??
      ({ createdAt: this.localWorkflowLaunches.get(taskId)?.createdAt ?? eventTimestamp } satisfies {
        createdAt: string
        completedAt?: string
      })
    if (isTerminalAgentSessionTaskStatus(status) && !timeline.completedAt) timeline.completedAt = eventTimestamp
    this.taskTimelines.set(taskId, timeline)
    return timeline
  }

  private readLocalWorkflowSnapshot(
    taskId: string,
    preferSnapshotContext: boolean
  ): AgentTaskEventPartData['workflow'] | undefined {
    const launch = this.localWorkflowLaunches.get(taskId)
    if (!launch) return undefined
    try {
      const cached = this.workflowSnapshotCache.get(taskId)
      const result = readUtf8FileWithinLimit(
        launch.snapshotPath,
        MAX_WORKFLOW_SNAPSHOT_BYTES,
        cached?.snapshotPath === launch.snapshotPath ? cached : undefined
      )
      if (result.unchanged) {
        return cached?.workflow
          ? this.mergeLocalWorkflowTranscriptStats(taskId, cached.workflow, preferSnapshotContext)
          : undefined
      }
      if (result.oversized) {
        logger.warn('Skipped oversized workflow snapshot', {
          sessionId: this.sessionId,
          taskId,
          snapshotPath: launch.snapshotPath,
          sizeBytes: result.sizeBytes
        })
        this.workflowSnapshotCache.set(taskId, {
          snapshotPath: launch.snapshotPath,
          sizeBytes: result.sizeBytes,
          mtimeMs: result.mtimeMs
        })
        return undefined
      }
      const parsedWorkflow = result.text === undefined ? undefined : parseWorkflowSnapshotText(result.text, launch)
      this.workflowSnapshotCache.set(taskId, {
        snapshotPath: launch.snapshotPath,
        sizeBytes: result.sizeBytes,
        mtimeMs: result.mtimeMs,
        workflow: parsedWorkflow
      })
      return parsedWorkflow
        ? this.mergeLocalWorkflowTranscriptStats(taskId, parsedWorkflow, preferSnapshotContext)
        : undefined
    } catch {
      return undefined
    }
  }

  private readLocalWorkflowAgentStats(
    taskId: string,
    agentId: unknown
  ): { cumulativeTokens: number; latestTokens: number; totalToolCalls: number } | undefined {
    const launch = this.localWorkflowLaunches.get(taskId)
    if (!launch?.transcriptDir || typeof agentId !== 'string' || !SAFE_TRANSCRIPT_ID.test(agentId)) {
      return undefined
    }

    const taskCache = this.workflowTranscriptStatsCaches.get(taskId)
    const cached = taskCache?.get(agentId)
    try {
      let transcriptPath = cached?.transcriptPath
      if (!transcriptPath) {
        const transcriptDir = realpathSync(launch.transcriptDir)
        transcriptPath = realpathSync(path.join(transcriptDir, `agent-${agentId}.jsonl`))
        if (path.dirname(transcriptPath) !== transcriptDir) return undefined
      }
      const next = readAgentTranscriptStats(transcriptPath, cached)
      const nextTaskCache = taskCache ?? new Map<string, AgentTranscriptStatsCacheEntry>()
      nextTaskCache.set(agentId, next)
      if (!taskCache) this.workflowTranscriptStatsCaches.set(taskId, nextTaskCache)
      return {
        cumulativeTokens: next.cumulativeTokens,
        latestTokens: next.latestTokens,
        totalToolCalls: next.totalToolCalls
      }
    } catch {
      return cached
        ? {
            cumulativeTokens: cached.cumulativeTokens,
            latestTokens: cached.latestTokens,
            totalToolCalls: cached.totalToolCalls
          }
        : undefined
    }
  }

  private resolveClaudeSessionProjectDirectory(sdkSessionId: string): string | undefined {
    const cached = this.claudeSessionProjectDirectories.get(sdkSessionId)
    if (cached) return cached
    if (!this.claudeConfigDir || !SAFE_TRANSCRIPT_ID.test(sdkSessionId)) return undefined

    try {
      for (const projectDir of getClaudeProjectDirectories(this.claudeConfigDir)) {
        try {
          const sessionTranscriptPath = realpathSync(path.join(projectDir, `${sdkSessionId}.jsonl`))
          if (path.dirname(sessionTranscriptPath) !== projectDir || !statSync(sessionTranscriptPath).isFile()) continue
          this.claudeSessionProjectDirectories.set(sdkSessionId, projectDir)
          return projectDir
        } catch {
          continue
        }
      }
    } catch {
      return undefined
    }
    return undefined
  }

  private readAgentTaskTranscriptStats(taskId: string, sdkSessionId: string): AgentUsageStats | undefined {
    if (!SAFE_TRANSCRIPT_ID.test(taskId)) return undefined

    const cached = this.agentTranscriptStatsCaches.get(taskId)
    try {
      let transcriptPath = cached?.transcriptPath
      if (!transcriptPath) {
        const projectDir = this.resolveClaudeSessionProjectDirectory(sdkSessionId)
        if (!projectDir) return undefined
        const sessionDir = realpathSync(path.join(projectDir, sdkSessionId))
        if (path.dirname(sessionDir) !== projectDir) return undefined
        const transcriptDir = realpathSync(path.join(sessionDir, 'subagents'))
        if (path.dirname(transcriptDir) !== sessionDir) return undefined
        transcriptPath = realpathSync(path.join(transcriptDir, `agent-${taskId}.jsonl`))
        if (path.dirname(transcriptPath) !== transcriptDir) return undefined
      }

      const next = readAgentTranscriptStats(transcriptPath, cached)
      this.agentTranscriptStatsCaches.set(taskId, next)
      return next
    } catch {
      return cached
    }
  }

  private fillLocalWorkflowTranscriptStats(taskId: string, workflowProgress: unknown[]): unknown[] {
    return workflowProgress.map((item) => {
      if (!isRecord(item) || item.type !== 'workflow_agent') return item
      const stats = this.readLocalWorkflowAgentStats(taskId, item.agentId)
      if (!stats) return item
      const reportedCumulativeTokens =
        typeof item.cumulativeTokens === 'number' && item.cumulativeTokens >= 0 ? item.cumulativeTokens : 0
      const reportedToolCalls = typeof item.toolCalls === 'number' && item.toolCalls >= 0 ? item.toolCalls : 0
      const hasNewCumulativeTokens = stats.cumulativeTokens > reportedCumulativeTokens
      const hasNewContextTokens = stats.latestTokens > 0 && stats.latestTokens !== item.tokens
      const hasNewToolCalls = stats.totalToolCalls > reportedToolCalls
      return hasNewCumulativeTokens || hasNewContextTokens || hasNewToolCalls
        ? {
            ...item,
            ...(hasNewCumulativeTokens ? { cumulativeTokens: stats.cumulativeTokens } : {}),
            ...(hasNewContextTokens ? { tokens: stats.latestTokens } : {}),
            ...(hasNewToolCalls ? { toolCalls: stats.totalToolCalls } : {})
          }
        : item
    })
  }

  private mergeLocalWorkflowTranscriptStats(
    taskId: string,
    workflow: NonNullable<AgentTaskEventPartData['workflow']>,
    preferWorkflowContext: boolean
  ): NonNullable<AgentTaskEventPartData['workflow']> {
    const runtimeProgress = this.localWorkflowRuntimeProgresses.get(taskId)
    if (!runtimeProgress) return workflow
    const statsByIndex = new Map<number, { cumulativeTokens: number; tokens?: number; toolCalls: number }>()
    for (const item of this.fillLocalWorkflowTranscriptStats(taskId, runtimeProgress)) {
      if (!isRecord(item) || item.type !== 'workflow_agent' || typeof item.index !== 'number') continue
      const cumulativeTokens =
        typeof item.cumulativeTokens === 'number' && item.cumulativeTokens >= 0 ? item.cumulativeTokens : 0
      const tokens = typeof item.tokens === 'number' && item.tokens >= 0 ? item.tokens : undefined
      const toolCalls = typeof item.toolCalls === 'number' && item.toolCalls >= 0 ? item.toolCalls : 0
      statsByIndex.set(item.index, { cumulativeTokens, tokens, toolCalls })
    }
    if (statsByIndex.size === 0) return workflow

    let changed = false
    let totalCumulativeTokens = 0
    let totalTokens = 0
    let hasContextTokens = false
    let totalToolCalls = 0
    const workflowProgress = workflow.workflowProgress.map((item) => {
      if (item.type !== 'workflow_agent') return item
      const stats = statsByIndex.get(item.index)
      const cumulativeTokens = Math.max(item.cumulativeTokens ?? 0, stats?.cumulativeTokens ?? 0)
      const tokens = preferWorkflowContext && item.tokens !== undefined ? item.tokens : (stats?.tokens ?? item.tokens)
      const toolCalls = Math.max(item.toolCalls ?? 0, stats?.toolCalls ?? 0)
      totalCumulativeTokens += cumulativeTokens
      if (tokens !== undefined) {
        totalTokens += tokens
        hasContextTokens = true
      }
      totalToolCalls += toolCalls
      if (cumulativeTokens === item.cumulativeTokens && tokens === item.tokens && toolCalls === item.toolCalls)
        return item
      changed = true
      return { ...item, cumulativeTokens, ...(tokens !== undefined ? { tokens } : {}), toolCalls }
    })
    totalCumulativeTokens = Math.max(totalCumulativeTokens, workflow.totalCumulativeTokens ?? 0)
    const nextTotalTokens =
      preferWorkflowContext && workflow.totalTokens !== undefined
        ? workflow.totalTokens
        : hasContextTokens
          ? totalTokens
          : workflow.totalTokens
    const nextTotalToolCalls =
      preferWorkflowContext && workflow.totalToolCalls !== undefined ? workflow.totalToolCalls : totalToolCalls
    return changed ||
      totalCumulativeTokens !== workflow.totalCumulativeTokens ||
      nextTotalTokens !== workflow.totalTokens ||
      nextTotalToolCalls !== workflow.totalToolCalls
      ? {
          ...workflow,
          ...(nextTotalTokens !== undefined ? { totalTokens: nextTotalTokens } : {}),
          totalCumulativeTokens,
          totalToolCalls: nextTotalToolCalls,
          workflowProgress
        }
      : workflow
  }

  private updateLocalWorkflowLiveSnapshot(
    eventData: AgentTaskEventPartData,
    workflowProgress?: unknown
  ): AgentTaskEventPartData['workflow'] | undefined {
    const launch = this.localWorkflowLaunches.get(eventData.taskId)
    const plan = this.localWorkflowPlans.get(eventData.taskId)
    if (!launch || !plan) return undefined
    const workflow = updateLocalWorkflowSnapshot(
      plan,
      launch,
      {
        status: eventData.status ?? 'in_progress',
        description: eventData.description,
        lastToolName: eventData.lastToolName,
        usage: eventData.usage,
        workflowProgress
      },
      this.localWorkflowLiveSnapshots.get(eventData.taskId)
    )
    this.localWorkflowLiveSnapshots.set(eventData.taskId, workflow)
    return workflow
  }

  private scheduleTerminalWorkflowReconciliation(eventData: AgentTaskEventPartData): void {
    const existing = this.pendingTerminalWorkflowEvents.get(eventData.taskId)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(
      () => this.reconcileTerminalWorkflowStats(eventData.taskId),
      TERMINAL_TASK_RECONCILE_DELAY_MS
    )
    timer.unref?.()
    this.pendingTerminalWorkflowEvents.set(eventData.taskId, { eventData, timer, attempts: 0 })
  }

  private reconcileTerminalWorkflowStats(taskId: string): void {
    const pending = this.pendingTerminalWorkflowEvents.get(taskId)
    if (!pending) return
    const workflow = this.readLocalWorkflowSnapshot(taskId, true)
    const terminalTotalTokens = pending.eventData.workflow?.totalTokens
    const snapshotMatchesTerminalContext =
      terminalTotalTokens === undefined || workflow?.totalTokens === terminalTotalTokens
    if (workflow && snapshotMatchesTerminalContext && hasWorkflowStatsChanged(pending.eventData.workflow, workflow)) {
      this.statusSink.emit({
        type: 'background-task-event',
        data: { ...pending.eventData, workflow }
      })
      this.finishTerminalTaskReconciliation(taskId)
      return
    }
    pending.attempts += 1
    if (pending.attempts < TERMINAL_TASK_RECONCILE_MAX_ATTEMPTS) {
      // A terminal edge can race the CLI's final snapshot write. Keep the task state until either
      // fresh statistics appear or the bounded retry window expires.
      const timer = setTimeout(() => this.reconcileTerminalWorkflowStats(taskId), TERMINAL_TASK_RECONCILE_DELAY_MS)
      timer.unref?.()
      pending.timer = timer
      return
    }
    this.finishTerminalTaskReconciliation(taskId)
  }

  private scheduleTerminalAgentReconciliation(eventData: AgentTaskEventPartData, sdkSessionId: string): void {
    const existing = this.pendingTerminalAgentEvents.get(eventData.taskId)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => this.reconcileTerminalAgentStats(eventData.taskId), TERMINAL_TASK_RECONCILE_DELAY_MS)
    timer.unref?.()
    this.pendingTerminalAgentEvents.set(eventData.taskId, { eventData, sdkSessionId, timer, attempts: 0 })
  }

  private reconcileTerminalAgentStats(taskId: string): void {
    const pending = this.pendingTerminalAgentEvents.get(taskId)
    if (!pending) return
    const transcriptStats = this.readAgentTaskTranscriptStats(taskId, pending.sdkSessionId)
    const usage = this.getAgentUsage(transcriptStats, pending.eventData.usage, true)
    if (usage && hasAgentUsageChanged(pending.eventData.usage, usage)) {
      this.statusSink.emit({
        type: 'background-task-event',
        data: { ...pending.eventData, usage }
      })
      this.finishTerminalTaskReconciliation(taskId)
      return
    }
    pending.attempts += 1
    if (pending.attempts < TERMINAL_TASK_RECONCILE_MAX_ATTEMPTS) {
      // Reported terminal context is authoritative and may not equal the latest transcript line.
      // Retry based on whether any externally visible usage changed instead of comparing the two.
      const timer = setTimeout(() => this.reconcileTerminalAgentStats(taskId), TERMINAL_TASK_RECONCILE_DELAY_MS)
      timer.unref?.()
      pending.timer = timer
      return
    }
    this.finishTerminalTaskReconciliation(taskId)
  }

  private finishTerminalTaskReconciliation(taskId: string): void {
    this.releaseTerminalTaskState(taskId)
    if (
      !this.turnActive &&
      this.backgroundTasks.length === 0 &&
      !this.backgroundWorkReleasePending &&
      !this.hasPendingTerminalReconciliation()
    ) {
      this.flowContexts.length = 0
      this.clearBackgroundTaskState()
    }
  }

  private hasPendingTerminalReconciliation(): boolean {
    return this.pendingTerminalWorkflowEvents.size > 0 || this.pendingTerminalAgentEvents.size > 0
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
    const baseEventData = this.toTaskEventPartData(message)
    if (message.subtype === 'task_started' && baseEventData.taskType === 'local_workflow' && baseEventData.prompt) {
      const plan = parseLocalWorkflowPlan(baseEventData.prompt)
      if (plan) {
        this.localWorkflowPlans.set(baseEventData.taskId, plan)
        this.localWorkflowLiveSnapshots.delete(baseEventData.taskId)
      }
    }
    if (baseEventData.taskType) this.backgroundTaskTypes.set(baseEventData.taskId, baseEventData.taskType)
    const toolUseId = baseEventData.toolUseId ?? this.backgroundTaskToolCallIds.get(baseEventData.taskId)
    const isAgentTask =
      baseEventData.taskType === 'local_agent' ||
      baseEventData.taskType === 'subagent' ||
      Boolean(baseEventData.subagentType) ||
      Boolean(toolUseId && this.agentTaskIdsByToolCallId.get(toolUseId) === baseEventData.taskId)
    if (isAgentTask) {
      if (baseEventData.isBackgrounded === true) this.asyncAgentTaskIds.add(baseEventData.taskId)
      if (baseEventData.isBackgrounded === false) this.asyncAgentTaskIds.delete(baseEventData.taskId)
      if (toolUseId) this.registerAgentTaskToolCallId(baseEventData.taskId, toolUseId)
    }
    const timeline = this.getTaskTimeline(baseEventData.taskId, baseEventData.status, getSdkMessageTimestamp(message))
    const reportedWorkflowProgress =
      message.subtype === 'task_progress' ? (message as SdkTaskProgressRuntimeMessage).workflow_progress : undefined
    if (Array.isArray(reportedWorkflowProgress)) {
      this.localWorkflowRuntimeProgresses.set(baseEventData.taskId, reportedWorkflowProgress)
    }
    const runtimeWorkflowProgress = this.localWorkflowRuntimeProgresses.get(baseEventData.taskId)
    const isTerminal = isTerminalAgentSessionTaskStatus(baseEventData.status)
    // A terminal transition can arrive as task_notification or as task_updated with a terminal
    // patch.status; both settle the task, so terminal bookkeeping keys off the status, not the subtype.
    const shouldReconcileTerminalWorkflow =
      baseEventData.status === 'completed' &&
      (this.backgroundTaskTypes.get(baseEventData.taskId) === 'local_workflow' ||
        this.localWorkflowLaunches.has(baseEventData.taskId))
    const shouldReconcileTerminalAgent = baseEventData.status === 'completed' && isAgentTask
    const shouldReconcileTerminalTask = shouldReconcileTerminalWorkflow || shouldReconcileTerminalAgent
    const liveWorkflow = runtimeWorkflowProgress
      ? this.updateLocalWorkflowLiveSnapshot(
          baseEventData,
          // Claude Code emits this field at runtime although the SDK declaration currently omits it.
          this.fillLocalWorkflowTranscriptStats(baseEventData.taskId, runtimeWorkflowProgress)
        )
      : undefined
    const workflowSnapshot = isTerminal
      ? (this.readLocalWorkflowSnapshot(baseEventData.taskId, true) ??
        liveWorkflow ??
        this.updateLocalWorkflowLiveSnapshot(baseEventData))
      : (liveWorkflow ??
        this.readLocalWorkflowSnapshot(baseEventData.taskId, false) ??
        this.updateLocalWorkflowLiveSnapshot(baseEventData))
    const workflow =
      workflowSnapshot && isTerminal && baseEventData.usage
        ? {
            ...workflowSnapshot,
            ...(baseEventData.usage.contextTokens !== undefined
              ? { totalTokens: baseEventData.usage.contextTokens }
              : {}),
            ...(baseEventData.usage.toolUses !== undefined ? { totalToolCalls: baseEventData.usage.toolUses } : {})
          }
        : workflowSnapshot
    const transcriptStats = isAgentTask
      ? this.readAgentTaskTranscriptStats(baseEventData.taskId, message.session_id)
      : undefined
    const agentStats = hasAgentUsageStats(transcriptStats)
      ? transcriptStats
      : toolUseId
        ? this.agentFlowStats.get(toolUseId)
        : undefined
    const usage = isAgentTask ? this.getAgentUsage(agentStats, baseEventData.usage, isTerminal) : baseEventData.usage
    const eventData: AgentTaskEventPartData = {
      ...baseEventData,
      toolUseId,
      ...(usage ? { usage } : {}),
      ...(isAgentTask && baseEventData.isBackgrounded === undefined && this.asyncAgentTaskIds.has(baseEventData.taskId)
        ? { isBackgrounded: true }
        : {}),
      ...timeline,
      ...(workflow ? { workflow } : {})
    }
    if (isTerminal) this.stopBackgroundBashPolling(eventData.taskId, false)

    // Native task edges enrich membership with navigation identity; terminal edges also settle it.
    if (
      eventData.toolUseId &&
      (eventData.taskType === 'subagent' ||
        eventData.taskType === 'local_agent' ||
        eventData.taskType === 'local_workflow' ||
        this.isBackgroundBashTask(eventData.taskId) ||
        eventData.subagentType)
    ) {
      this.registerBackgroundTaskToolCallId(eventData.taskId, eventData.toolUseId)
    }

    if (isTerminal && (message.subtype === 'task_notification' || message.subtype === 'task_updated')) {
      this.publishTerminalBackgroundBashOutput(message)
    }

    // Keep a process-scoped per-task surface for status history and stop targets.
    this.statusSink.emit({ type: 'background-task-event', data: eventData })
    if (shouldReconcileTerminalWorkflow) {
      this.scheduleTerminalWorkflowReconciliation(eventData)
    } else if (shouldReconcileTerminalAgent) {
      this.scheduleTerminalAgentReconciliation(eventData, message.session_id)
    }
    if (isTerminal) {
      this.terminalTaskIds.add(eventData.taskId)
      const taskIndex = this.backgroundTasks.findIndex((task) => task.id === eventData.taskId)
      if (taskIndex >= 0) {
        this.backgroundTasks.splice(taskIndex, 1)
        this.publishBackgroundTasks()
      }
    }

    if (!this.turnActive) {
      if (isTerminal && !shouldReconcileTerminalTask) {
        this.releaseTerminalTaskState(eventData.taskId)
      }
      return
    }

    let persistedEventData = eventData
    if (workflow) {
      const terminalSnapshotPersisted = this.persistedTerminalWorkflowSnapshotTaskIds.has(eventData.taskId)
      const persistedTaskIds = isTerminal
        ? this.persistedTerminalWorkflowSnapshotTaskIds
        : this.persistedWorkflowSnapshotTaskIds
      if ((!isTerminal && terminalSnapshotPersisted) || persistedTaskIds.has(eventData.taskId)) {
        const withoutWorkflow = { ...eventData }
        delete withoutWorkflow.workflow
        persistedEventData = withoutWorkflow
      } else {
        persistedTaskIds.add(eventData.taskId)
      }
    }

    ctx.sink.enqueue({
      type: 'data-agent-task-event',
      id: `task-${eventData.taskId}-${eventData.event}`,
      data: persistedEventData
    })
    if (isTerminal && !shouldReconcileTerminalTask) {
      this.releaseTerminalTaskState(eventData.taskId)
    }
  }

  private releaseTerminalTaskState(taskId: string): void {
    const pendingWorkflow = this.pendingTerminalWorkflowEvents.get(taskId)
    if (pendingWorkflow) clearTimeout(pendingWorkflow.timer)
    const pendingAgent = this.pendingTerminalAgentEvents.get(taskId)
    if (pendingAgent) clearTimeout(pendingAgent.timer)
    const toolCallId = this.backgroundTaskToolCallIds.get(taskId)
    this.backgroundTaskToolCallIds.delete(taskId)
    this.backgroundTaskTypes.delete(taskId)
    this.localWorkflowLaunches.delete(taskId)
    this.localWorkflowPlans.delete(taskId)
    this.localWorkflowLiveSnapshots.delete(taskId)
    this.localWorkflowRuntimeProgresses.delete(taskId)
    this.persistedWorkflowSnapshotTaskIds.delete(taskId)
    this.persistedTerminalWorkflowSnapshotTaskIds.delete(taskId)
    this.workflowSnapshotCache.delete(taskId)
    this.workflowTranscriptStatsCaches.delete(taskId)
    this.pendingTerminalWorkflowEvents.delete(taskId)
    this.pendingTerminalAgentEvents.delete(taskId)
    this.agentTranscriptStatsCaches.delete(taskId)
    if (toolCallId) {
      this.agentTaskIdsByToolCallId.delete(toolCallId)
      this.agentFlowStats.delete(toolCallId)
    }
    this.asyncAgentTaskIds.delete(taskId)
    this.stopBackgroundBashPolling(taskId, false)
    this.backgroundBashOutputs.delete(taskId)
  }

  private isBackgroundBashTask(taskId: string): boolean {
    const taskType = this.backgroundTaskTypes.get(taskId) ?? ''
    return taskType === 'local_bash'
  }

  private publishTerminalBackgroundBashOutput(message: SDKTaskNotificationMessage | SDKTaskUpdatedMessage): void {
    if (!this.isBackgroundBashTask(message.task_id)) return
    const state = this.stopBackgroundBashPolling(message.task_id, false)
    const toolCallId = state?.toolCallId ?? this.backgroundTaskToolCallIds.get(message.task_id)
    if (!toolCallId) return
    const notificationOutputFile =
      'output_file' in message && message.output_file
        ? this.validateTaskOutputPath(message.output_file, message.task_id, message.session_id)
        : undefined
    const outputState = notificationOutputFile ? { toolCallId, outputFile: notificationOutputFile } : state
    const result = outputState ? this.readBackgroundBashOutput(message.task_id, outputState, true) : undefined
    this.backgroundBashOutputs.delete(message.task_id)

    const terminalStatus = 'patch' in message ? message.patch.status : message.status
    if (terminalStatus === 'completed') {
      if (!result) return
      this.emitBackgroundToolChunk(toolCallId, {
        type: 'tool-output-available',
        toolCallId,
        output: result.text,
        dynamic: true,
        providerExecuted: true
      })
      return
    }

    const errorText = ['summary' in message ? message.summary : undefined, result?.text]
      .filter((value): value is string => Boolean(value))
      .join('\n\n')
    this.emitBackgroundToolChunk(toolCallId, {
      type: 'tool-output-error',
      toolCallId,
      errorText,
      dynamic: true,
      providerExecuted: true
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
    if (!this.backgroundWorkReleasePending) {
      if (!this.turnActive && this.backgroundTasks.length === 0 && !this.hasPendingTerminalReconciliation()) {
        this.flowContexts.length = 0
        this.clearBackgroundTaskState()
      }
      return
    }
    this.backgroundWorkReleasePending = false
    if (this.backgroundTasks.length > 0) {
      this.backgroundTasks = []
      this.publishBackgroundTasks()
    }
    if (!this.turnActive && !this.hasPendingTerminalReconciliation()) {
      this.flowContexts.length = 0
      this.clearBackgroundTaskState()
    }
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
          usage: this.getTaskUsage(message.usage, false)
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
          usage: this.getTaskUsage(message.usage, true)
        }
    }
  }

  private getTaskUsage(
    value: SDKTaskNotificationMessage['usage'] | SDKTaskProgressMessage['usage'] | undefined,
    includeContextTokens: boolean
  ): AgentTaskEventPartData['usage'] | undefined {
    if (!value) return undefined
    return {
      ...(includeContextTokens && value.total_tokens > 0 ? { contextTokens: value.total_tokens } : {}),
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
