/**
 * Translate dsh `session.event` envelopes (`{type, seq, time, data}`) into
 * Cherry `UIMessageChunk`s plus connection callbacks.
 *
 * Maps only the content/tool/usage surface; turn lifecycle (`turn/end` →
 * turn-complete/error, resume tokens) is owned by `DshRuntimeConnection` via
 * the sink callbacks. Event shapes are declared structurally (the dsh type
 * packages are peer deps of the client SDK, not direct Cherry deps).
 *
 * Mapping:
 * - `assistant/chunk` block-start/deltas/block-end → text and reasoning chunks
 * - `tool/call` → tool-input-start + tool-input-available (raw JSON args parsed defensively)
 * - `tool/result` → tool-output-available / tool-output-error
 * - `assistant/message` usage → accumulated `message-metadata` + per-call sink callback
 * - `turn/end` → sink callback with the wire reason
 * - `compaction/start|summary|end` → host compaction runtime events via the sink
 * - `llm/retry` → api-retry status via the sink
 * - content with no host-opened turn → autonomous-turn lifecycle (goal rounds)
 */
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentSessionApiRetryInfo } from '@shared/ai/agentSessionApiRetry'
import type { CherryUIMessageChunk } from '@shared/data/types/message'

import type { AgentRuntimeEvent } from '../types'

/** dsh transport tag consumed by the renderer's tool-part routing. */
export const DSH_TRANSPORT = AGENT_RUNTIME_CAPABILITIES.dsh.transport

export interface DshTokenUsageLike {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export interface DshTurnEndReasonLike {
  kind?: string
  error?: { message?: string; code?: string }
}

export interface DshInvocationMetrics {
  timeFirstTokenMs?: number
  timeCompletionMs: number
  timeThinkingMs?: number
}

export type DshCompactionRuntimeEvent = Extract<
  AgentRuntimeEvent,
  { type: 'compaction-start' | 'compaction-complete' | 'compaction-error' }
>

export interface DshStreamSink {
  enqueue(chunk: CherryUIMessageChunk): void
  /** One provider call's token accounting (`assistant/message`); the connection owns invocation records. */
  onAssistantUsage(info: {
    turn: number
    seq: number
    usage: DshTokenUsageLike
    model?: string
    metrics?: DshInvocationMetrics
  }): void
  onTurnEnd(reason: DshTurnEndReasonLike): void
  /** One scheduled provider retry (`llm/retry`); the host clears the status when content resumes. */
  onApiRetry(retry: AgentSessionApiRetryInfo): void
  /** Compaction lifecycle (`compaction/start|end`) mapped to host runtime events. */
  onCompaction(event: DshCompactionRuntimeEvent): void
  /** A runtime-started turn (goal round): `started` fires before the turn's first chunk,
   *  `finished` before its `onTurnEnd` — the host opens/settles a receive-only stream. */
  onAutonomousTurnState(state: 'started' | 'finished'): void
}

function toolProviderMetadata(toolName: string, extra: Record<string, unknown> = {}) {
  return {
    cherry: {
      transport: DSH_TRANSPORT,
      tool: { type: 'builtin', name: toolName }
    },
    dsh: { toolName, ...extra }
  }
}

export class DshStreamAdapter {
  /** Bumped whenever `assistant/chunk` lands on a new (turn, step) pair so
   *  content-part ids stay unique across the model calls of one tool loop
   *  (dsh resets block indexes per step). */
  private turnSeq = 0
  private lastStepKey?: string
  /** Open stream blocks of the current step, by block index. */
  private readonly openBlocks = new Map<number, 'text' | 'reasoning'>()
  /** callId → toolName; `tool/result` carries only the correlation id. */
  private readonly startedTools = new Map<string, string>()
  /** Running token totals for the current turn — a Cherry turn spans N model
   *  calls whose `message-metadata` is last-wins, so emit the running sum. */
  private turnUsage = emptyTurnUsage()
  /** Per-step provider-call timing, measured at event-arrival time (includes
   *  ~ms of stdio forwarding latency — same order as the gateway's stream clock). */
  private stepStartedAt?: number
  private firstTokenAt?: number
  private thinkingMs = 0
  private readonly reasoningOpenedAt = new Map<number, number>()
  /** Open compaction folds by compactionId — dsh's lock pairs every start with an end. */
  private readonly activeCompactions = new Map<
    string,
    {
      startedAt: number
      turn: number | null
      trigger: 'manual' | 'auto'
      shadowedTokenCount?: number
      summaryTokens?: number
    }
  >()

  /** Content belongs to a turn; a host `send()` opens one via `beginTurn()`. */
  private turnActive = false
  /** The current turn was opened by runtime content (a goal round), not a host prompt. */
  private autonomousTurn = false

  constructor(private readonly sink: DshStreamSink) {}

  /** Mark the next turn as host-prompted; called by the connection before each bridge prompt. */
  beginTurn(): void {
    this.turnActive = true
    this.autonomousTurn = false
  }

  /** Roll back a `beginTurn()` whose prompt never reached the runtime. */
  abortTurn(): void {
    this.turnActive = false
    this.autonomousTurn = false
  }

  /** Content with no host-opened turn = the runtime started its own (goal-round) turn. */
  private ensureTurnOpen(): void {
    if (this.turnActive) return
    this.sink.onAutonomousTurnState('started')
    this.turnActive = true
    this.autonomousTurn = true
  }

  handleEvent(event: unknown): void {
    if (!isRecord(event) || typeof event.type !== 'string') return
    const data = isRecord(event.data) ? event.data : {}
    switch (event.type) {
      case 'turn/start':
        this.turnUsage = emptyTurnUsage()
        this.startedTools.clear()
        this.resetStepTiming()
        return
      case 'assistant/chunk':
        this.ensureTurnOpen()
        this.handleAssistantChunk(data)
        return
      case 'tool/call':
        this.ensureTurnOpen()
        this.handleToolCall(data)
        return
      case 'tool/result':
        this.ensureTurnOpen()
        this.handleToolResult(data)
        return
      case 'assistant/message':
        this.ensureTurnOpen()
        this.handleAssistantMessage(data, numeric(event.seq))
        return
      case 'turn/end': {
        // A turn that never carried content (a stale goal round rejected at pre-step)
        // has nothing to settle — surfacing it would fabricate an empty host turn.
        if (!this.turnActive) return
        this.turnActive = false
        if (this.autonomousTurn) {
          this.autonomousTurn = false
          // Ownership release must precede the terminal turn-complete (host contract).
          this.sink.onAutonomousTurnState('finished')
        }
        this.sink.onTurnEnd(isRecord(data.reason) ? (data.reason as DshTurnEndReasonLike) : {})
        return
      }
      case 'llm/retry':
        this.handleRetry(data)
        return
      case 'compaction/start':
        this.handleCompactionStart(data)
        return
      case 'compaction/summary':
        this.handleCompactionSummary(data, numeric(event.seq))
        return
      case 'compaction/end':
        this.handleCompactionEnd(data)
        return
      default:
        // step/*, user/message, todo/write, request/*, approval/*, llm/retry-started,
        // compaction/prune, session/end-seed, and unknown types: the unknown-event
        // MUST-refuse rule applies to log reconstruction (the runtime's job), not here.
        return
    }
  }

  private blockId(index: number): string {
    return `dsh-${this.turnSeq}-${index}`
  }

  private handleAssistantChunk(data: Record<string, unknown>): void {
    const stepKey = `${numeric(data.turn)}:${numeric(data.step)}`
    if (stepKey !== this.lastStepKey) {
      this.lastStepKey = stepKey
      this.turnSeq += 1
      this.openBlocks.clear()
      this.resetStepTiming()
      this.stepStartedAt = Date.now()
    }
    const chunk = data.chunk
    if (!isRecord(chunk) || typeof chunk.type !== 'string') return
    const index = numeric(chunk.index)
    switch (chunk.type) {
      case 'block-start': {
        if (chunk.blockType === 'text') this.openBlock(index, 'text')
        else if (chunk.blockType === 'reasoning') this.openBlock(index, 'reasoning')
        return
      }
      case 'text-delta': {
        if (!this.openBlocks.has(index)) this.openBlock(index, 'text')
        this.firstTokenAt ??= Date.now()
        this.sink.enqueue({ type: 'text-delta', id: this.blockId(index), delta: String(chunk.text ?? '') })
        return
      }
      case 'reasoning-delta': {
        if (!this.openBlocks.has(index)) this.openBlock(index, 'reasoning')
        this.firstTokenAt ??= Date.now()
        this.sink.enqueue({ type: 'reasoning-delta', id: this.blockId(index), delta: String(chunk.text ?? '') })
        return
      }
      case 'block-end': {
        const kind = this.openBlocks.get(index)
        this.openBlocks.delete(index)
        if (kind === 'text') this.sink.enqueue({ type: 'text-end', id: this.blockId(index) })
        else if (kind === 'reasoning') {
          const openedAt = this.reasoningOpenedAt.get(index)
          this.reasoningOpenedAt.delete(index)
          if (openedAt !== undefined) this.thinkingMs += Date.now() - openedAt
          this.sink.enqueue({ type: 'reasoning-end', id: this.blockId(index) })
        }
        return
      }
      default:
        // tool-call-delta / usage / finish: tools and usage surface via the
        // tool/call, tool/result, and assistant/message events instead.
        return
    }
  }

  private openBlock(index: number, kind: 'text' | 'reasoning'): void {
    this.openBlocks.set(index, kind)
    if (kind === 'reasoning') this.reasoningOpenedAt.set(index, Date.now())
    this.sink.enqueue({ type: kind === 'text' ? 'text-start' : 'reasoning-start', id: this.blockId(index) })
  }

  private resetStepTiming(): void {
    this.stepStartedAt = undefined
    this.firstTokenAt = undefined
    this.thinkingMs = 0
    this.reasoningOpenedAt.clear()
  }

  /** Provider-call timing for the step this `assistant/message` closes; undefined when no chunk streamed. */
  private takeStepMetrics(): DshInvocationMetrics | undefined {
    const startedAt = this.stepStartedAt
    if (startedAt === undefined) return undefined
    const now = Date.now()
    const metrics: DshInvocationMetrics = {
      ...(this.firstTokenAt !== undefined ? { timeFirstTokenMs: this.firstTokenAt - startedAt } : {}),
      timeCompletionMs: now - startedAt,
      ...(this.thinkingMs > 0 ? { timeThinkingMs: this.thinkingMs } : {})
    }
    this.resetStepTiming()
    return metrics
  }

  private handleToolCall(data: Record<string, unknown>): void {
    const toolCallId = String(data.callId ?? '')
    const toolName = String(data.name ?? '')
    if (!toolCallId || this.startedTools.has(toolCallId)) return
    this.startedTools.set(toolCallId, toolName)
    this.sink.enqueue({
      type: 'tool-input-start',
      toolCallId,
      toolName,
      providerExecuted: true,
      dynamic: true,
      providerMetadata: toolProviderMetadata(toolName)
    })
    this.sink.enqueue({
      type: 'tool-input-available',
      toolCallId,
      toolName,
      input: parseToolArguments(data.arguments),
      providerExecuted: true,
      dynamic: true,
      providerMetadata: toolProviderMetadata(toolName)
    })
  }

  private handleToolResult(data: Record<string, unknown>): void {
    const message = isRecord(data.message) ? data.message : {}
    const block = Array.isArray(message.content) && isRecord(message.content[0]) ? message.content[0] : undefined
    const toolCallId = String(block?.toolCallId ?? '')
    if (!toolCallId) return
    // A result with no preceding tool/call (defensive) still needs its input parts.
    if (!this.startedTools.has(toolCallId)) {
      this.handleToolCall({ callId: toolCallId, name: 'unknown', arguments: '{}' })
    }
    const toolName = this.startedTools.get(toolCallId) ?? 'unknown'
    const output = block?.content ?? null
    if (data.error !== undefined || block?.isError === true) {
      this.sink.enqueue({
        type: 'tool-output-error',
        toolCallId,
        errorText: stringifyToolOutput(output),
        dynamic: true,
        providerExecuted: true,
        providerMetadata: toolProviderMetadata(toolName, isRecord(data.error) ? { error: data.error } : {})
      })
      return
    }
    this.sink.enqueue({
      type: 'tool-output-available',
      toolCallId,
      output,
      dynamic: true,
      providerExecuted: true,
      providerMetadata: toolProviderMetadata(toolName)
    })
  }

  private handleAssistantMessage(data: Record<string, unknown>, seq: number): void {
    if (!isRecord(data.usage)) return
    const usage = data.usage as DshTokenUsageLike
    // dsh token counts are DISJOINT: billed input = input + cacheRead + cacheWrite.
    const promptTokens = numeric(usage.inputTokens) + numeric(usage.cacheReadTokens) + numeric(usage.cacheWriteTokens)
    const completionTokens = numeric(usage.outputTokens)
    this.turnUsage.promptTokens += promptTokens
    this.turnUsage.completionTokens += completionTokens
    this.turnUsage.totalTokens += promptTokens + completionTokens
    if (usage.reasoningTokens !== undefined) {
      this.turnUsage.thoughtsTokens += numeric(usage.reasoningTokens)
      this.turnUsage.hasReasoning = true
    }
    this.sink.enqueue({
      type: 'message-metadata',
      messageMetadata: {
        totalTokens: this.turnUsage.totalTokens,
        stats: {
          inputTokens: this.turnUsage.promptTokens,
          outputTokens: this.turnUsage.completionTokens,
          totalTokens: this.turnUsage.totalTokens,
          ...(this.turnUsage.hasReasoning
            ? { outputTokenDetails: { reasoningTokens: this.turnUsage.thoughtsTokens } }
            : {})
        }
      }
    })
    const message = isRecord(data.message) ? data.message : undefined
    const source = message && isRecord(message.source) ? message.source : undefined
    const metrics = this.takeStepMetrics()
    this.sink.onAssistantUsage({
      turn: numeric(data.turn),
      seq,
      usage,
      ...(typeof source?.model === 'string' ? { model: source.model } : {}),
      ...(metrics ? { metrics } : {})
    })
  }

  /** `maxRetries` is absent only in the retry plugin's `always` mode, which this composition never selects. */
  private handleRetry(data: Record<string, unknown>): void {
    const failure = isRecord(data.failure) ? data.failure : {}
    this.sink.onApiRetry({
      attempt: numeric(data.retry),
      maxRetries: numeric(data.maxRetries),
      retryDelayMs: numeric(data.delayMs),
      errorStatus: typeof failure.status === 'number' ? failure.status : null,
      errorCategory: typeof failure.code === 'string' ? failure.code : 'UNKNOWN'
    })
  }

  private handleCompactionStart(data: Record<string, unknown>): void {
    const compactionId = String(data.compactionId ?? '')
    if (!compactionId) return
    const trigger = data.sourceCommandId !== undefined ? 'manual' : 'auto'
    this.activeCompactions.set(compactionId, {
      startedAt: Date.now(),
      turn: typeof data.turn === 'number' ? data.turn : null,
      trigger
    })
    this.sink.onCompaction({ type: 'compaction-start', trigger })
  }

  private handleCompactionSummary(data: Record<string, unknown>, seq: number): void {
    const state = this.activeCompactions.get(String(data.compactionId ?? ''))
    if (!state) return
    if (typeof data.shadowedTokenCount === 'number') state.shadowedTokenCount = data.shadowedTokenCount
    if (!isRecord(data.usage)) return
    const usage = data.usage as DshTokenUsageLike
    if (typeof usage.outputTokens === 'number') state.summaryTokens = usage.outputTokens
    // The summarize call is real provider spend but never an `assistant/message`,
    // so record the invocation here; it stays out of the turn's message-metadata.
    this.sink.onAssistantUsage({
      turn: state.turn ?? 0,
      seq,
      usage,
      ...(typeof data.model === 'string' ? { model: data.model } : {})
    })
  }

  private handleCompactionEnd(data: Record<string, unknown>): void {
    const compactionId = String(data.compactionId ?? '')
    const state = this.activeCompactions.get(compactionId)
    this.activeCompactions.delete(compactionId)
    const error = typeof data.error === 'string' && data.error ? data.error : undefined
    if (error !== undefined) {
      this.sink.onCompaction({ type: 'compaction-error', error })
      return
    }
    const completedAt = Date.now()
    // Region-scope metrics (tokens shadowed vs summary size); the anchor UI renders
    // only the delta, which is exactly what this fold saved.
    const metrics =
      state?.shadowedTokenCount !== undefined && state.summaryTokens !== undefined
        ? { preTokens: state.shadowedTokenCount, postTokens: state.summaryTokens }
        : {}
    this.sink.onCompaction({
      type: 'compaction-complete',
      anchor: {
        status: 'done',
        phase: 'agent-session',
        completedAt: new Date(completedAt).toISOString(),
        ...(state
          ? {
              trigger: state.trigger,
              startedAt: new Date(state.startedAt).toISOString(),
              durationMs: completedAt - state.startedAt
            }
          : {}),
        ...metrics
      }
    })
  }
}

interface TurnUsageTotals {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  thoughtsTokens: number
  hasReasoning: boolean
}

function emptyTurnUsage(): TurnUsageTotals {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, thoughtsTokens: 0, hasReasoning: false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** dsh keeps tool arguments as the raw model-produced JSON string; `{}` on any parse failure. */
function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    const text = output
      .filter((entry): entry is { type: 'text'; text: string } => isRecord(entry) && typeof entry.text === 'string')
      .map((entry) => entry.text)
      .join('\n')
    if (text) return text
  }
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}
