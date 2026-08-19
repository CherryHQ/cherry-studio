/**
 * Translate dsh `session.event` envelopes (`{type, seq, time, data}`) into
 * Cherry `UIMessageChunk`s plus connection callbacks.
 *
 * Maps only the content/tool/usage surface; turn lifecycle (`turn/end` →
 * turn-complete/error, resume tokens) is owned by `DshRuntimeConnection` via
 * the sink callbacks. Events are typed as dsh's `SessionEvent` union (cast
 * once at the connection's wire boundary); the union is open via declaration
 * merging, so unknown types fall through the `default:` branch.
 *
 * Mapping:
 * - `assistant/chunk` block-start/deltas/block-end → text and reasoning chunks
 * - `tool/call` → tool-input-start + tool-input-available (raw JSON args parsed defensively)
 * - `tool/result` → tool-output-available / tool-output-error
 * - terminal usage chunks → per-attempt accounting; `assistant/message` → successful-turn metadata
 * - `turn/end` → sink callback with the wire reason
 * - `compaction/start|summary|end` → host compaction runtime events via the sink
 * - `llm/retry` / `llm/retry-started` → failed-attempt accounting and retry timing
 * - content with no host-opened turn → autonomous-turn lifecycle (goal rounds)
 */
// The dsh-compaction-basic / dsh-llm-retry / dsh-plan-mode imports load their SessionEventMap merges.
import type {} from '@deepseek-ai/dsh-compaction-basic'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type { SessionEvent, SessionEventMap, TurnEndReason } from '@deepseek-ai/dsh-session'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentSessionApiRetryInfo } from '@shared/ai/agentSessionApiRetry'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { CherryUIMessageChunk } from '@shared/data/types/message'

import type { AgentRuntimeEvent } from '../types'

/** dsh transport tag consumed by the renderer's tool-part routing. */
export const DSH_TRANSPORT = AGENT_RUNTIME_CAPABILITIES.dsh.transport

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
  /** One provider attempt's token accounting; the connection owns invocation records. */
  onAssistantUsage(info: {
    turn: number
    seq: number
    usage: TokenUsage
    model?: string
    metrics?: DshInvocationMetrics
  }): void
  onTurnEnd(reason: TurnEndReason): void
  /** One scheduled provider retry (`llm/retry`); the host clears the status when content resumes. */
  onApiRetry(retry: AgentSessionApiRetryInfo): void
  /** Compaction lifecycle (`compaction/start|end`) mapped to host runtime events. */
  onCompaction(event: DshCompactionRuntimeEvent): void
  /** A runtime-started turn (goal round): `started` fires before the turn's first chunk,
   *  `finished` before its `onTurnEnd` — the host opens/settles a receive-only stream. */
  onAutonomousTurnState(state: 'started' | 'finished'): void
  /** Committed `plan/mode` fold (last one wins). `false` after an approved exit —
   *  the connection re-opens its policy since Cherry's stored mode is not rewritten. */
  onPlanMode(active: boolean): void
}

function toolProviderMetadata(toolName: string, extra: Record<string, unknown> = {}) {
  // Bridged MCP tools keep their `mcp__server__tool` wire name; report the MCP identity behind it
  // so the renderer routes them to the same cards it gives Claude Code's MCP results.
  const mcp = parseFunctionCallToolName(toolName)
  return {
    cherry: {
      transport: DSH_TRANSPORT,
      tool: mcp
        ? { type: 'mcp', name: mcp.toolPart, serverId: mcp.serverPart, serverName: mcp.serverPart }
        : { type: 'builtin', name: toolName }
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
  /** Terminal usage arrives before either assistant/message or retry/failure boundaries. */
  private pendingProviderUsage?: {
    turn: number
    step: number
    seq: number
    usage: TokenUsage
    metrics?: DshInvocationMetrics
  }
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

  handleEvent(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start':
        this.flushPendingProviderUsage()
        this.turnUsage = emptyTurnUsage()
        this.startedTools.clear()
        this.resetStepTiming()
        return
      case 'step/start':
        this.startProviderAttempt(event.data, true)
        return
      case 'assistant/chunk':
        this.ensureTurnOpen()
        this.handleAssistantChunk(event.data, event.seq)
        return
      case 'tool/call':
        this.ensureTurnOpen()
        this.handleToolCall(event.data)
        return
      case 'tool/result':
        this.ensureTurnOpen()
        this.handleToolResult(event.data)
        return
      case 'assistant/message':
        this.ensureTurnOpen()
        this.handleAssistantMessage(event.data, event.seq)
        return
      case 'turn/end': {
        this.flushPendingProviderUsage()
        // A turn that never carried content (a stale goal round rejected at pre-step)
        // has nothing to settle — surfacing it would fabricate an empty host turn.
        if (!this.turnActive) return
        this.turnActive = false
        if (this.autonomousTurn) {
          this.autonomousTurn = false
          // Ownership release must precede the terminal turn-complete (host contract).
          this.sink.onAutonomousTurnState('finished')
        }
        this.sink.onTurnEnd(event.data.reason)
        return
      }
      case 'llm/retry':
        this.flushPendingProviderUsage()
        this.handleRetry(event.data)
        return
      case 'llm/retry-started':
        this.startProviderAttempt(event.data, false)
        return
      case 'step/end':
        this.flushPendingProviderUsage()
        this.resetStepTiming()
        return
      case 'compaction/start':
        this.handleCompactionStart(event.data)
        return
      case 'compaction/summary':
        this.handleCompactionSummary(event.data, event.seq)
        return
      case 'compaction/end':
        this.handleCompactionEnd(event.data)
        return
      case 'plan/mode':
        this.sink.onPlanMode(event.data.active)
        return
      default:
        // user/message, todo/write, request/*, approval/*,
        // compaction/prune, session/end-seed, and merge-extended types the union
        // does not know: the unknown-event MUST-refuse rule applies to log
        // reconstruction (the runtime's job), not here.
        return
    }
  }

  private blockId(index: number): string {
    return `dsh-${this.turnSeq}-${index}`
  }

  private handleAssistantChunk(data: SessionEventMap['assistant/chunk'], seq: number): void {
    const stepKey = `${data.turn}:${data.step}`
    if (stepKey !== this.lastStepKey) {
      // Compatibility fallback for logs produced without a visible step/start.
      this.startProviderAttempt(data, true)
    }
    const chunk = data.chunk
    switch (chunk.type) {
      case 'block-start': {
        if (chunk.blockType === 'text') this.openBlock(chunk.index, 'text')
        else if (chunk.blockType === 'reasoning') this.openBlock(chunk.index, 'reasoning')
        return
      }
      case 'text-delta': {
        if (!this.openBlocks.has(chunk.index)) this.openBlock(chunk.index, 'text')
        this.firstTokenAt ??= Date.now()
        this.sink.enqueue({ type: 'text-delta', id: this.blockId(chunk.index), delta: chunk.text })
        return
      }
      case 'reasoning-delta': {
        if (!this.openBlocks.has(chunk.index)) this.openBlock(chunk.index, 'reasoning')
        this.firstTokenAt ??= Date.now()
        this.sink.enqueue({ type: 'reasoning-delta', id: this.blockId(chunk.index), delta: chunk.text })
        return
      }
      case 'block-end': {
        const kind = this.openBlocks.get(chunk.index)
        this.openBlocks.delete(chunk.index)
        if (kind === 'text') this.sink.enqueue({ type: 'text-end', id: this.blockId(chunk.index) })
        else if (kind === 'reasoning') {
          const openedAt = this.reasoningOpenedAt.get(chunk.index)
          this.reasoningOpenedAt.delete(chunk.index)
          if (openedAt !== undefined) this.thinkingMs += Date.now() - openedAt
          this.sink.enqueue({ type: 'reasoning-end', id: this.blockId(chunk.index) })
        }
        return
      }
      case 'usage':
        this.captureProviderUsage(data, seq, chunk.usage)
        return
      default:
        // tool-call-delta / finish surface through durable tool and message events.
        return
    }
  }

  private startProviderAttempt(data: { turn: number; step: number }, newStep: boolean): void {
    if (newStep) {
      this.flushPendingProviderUsage()
      const stepKey = `${data.turn}:${data.step}`
      if (stepKey !== this.lastStepKey) {
        this.lastStepKey = stepKey
        this.turnSeq += 1
        this.openBlocks.clear()
      }
    }
    this.resetStepTiming()
    this.stepStartedAt = Date.now()
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
    const openThinkingMs = [...this.reasoningOpenedAt.values()].reduce((total, openedAt) => total + now - openedAt, 0)
    const thinkingMs = this.thinkingMs + openThinkingMs
    const metrics: DshInvocationMetrics = {
      ...(this.firstTokenAt !== undefined ? { timeFirstTokenMs: this.firstTokenAt - startedAt } : {}),
      timeCompletionMs: now - startedAt,
      ...(thinkingMs > 0 ? { timeThinkingMs: thinkingMs } : {})
    }
    this.resetStepTiming()
    return metrics
  }

  private handleToolCall(data: Pick<SessionEventMap['tool/call'], 'callId' | 'name' | 'arguments'>): void {
    const toolCallId = data.callId
    const toolName = data.name
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

  private handleToolResult(data: SessionEventMap['tool/result']): void {
    const block = data.message.content[0]
    const toolCallId = block.toolCallId
    if (!toolCallId) return
    // A result with no preceding tool/call (defensive) still needs its input parts.
    if (!this.startedTools.has(toolCallId)) {
      this.handleToolCall({ callId: toolCallId, name: 'unknown', arguments: '{}' })
    }
    const toolName = this.startedTools.get(toolCallId) ?? 'unknown'
    const output = block.content
    if (data.error !== undefined || block.isError === true) {
      this.sink.enqueue({
        type: 'tool-output-error',
        toolCallId,
        errorText: stringifyToolOutput(output),
        dynamic: true,
        providerExecuted: true,
        providerMetadata: toolProviderMetadata(toolName, data.error ? { error: data.error } : {})
      })
      return
    }
    this.sink.enqueue({
      type: 'tool-output-available',
      toolCallId,
      output: normalizeToolOutput(output),
      dynamic: true,
      providerExecuted: true,
      providerMetadata: toolProviderMetadata(toolName)
    })
  }

  private handleAssistantMessage(data: SessionEventMap['assistant/message'], seq: number): void {
    const messageUsage = data.usage
    if (messageUsage) {
      // dsh token counts are DISJOINT: billed input = input + cacheRead + cacheWrite.
      const promptTokens =
        messageUsage.inputTokens + (messageUsage.cacheReadTokens ?? 0) + (messageUsage.cacheWriteTokens ?? 0)
      const completionTokens = messageUsage.outputTokens
      this.turnUsage.promptTokens += promptTokens
      this.turnUsage.completionTokens += completionTokens
      this.turnUsage.totalTokens += promptTokens + completionTokens
      if (messageUsage.reasoningTokens !== undefined) {
        this.turnUsage.thoughtsTokens += messageUsage.reasoningTokens
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
    }

    const pending = this.takePendingProviderUsage(data.turn, data.step)
    const usage = pending?.usage ?? messageUsage
    if (!usage) return
    const metrics = pending?.metrics ?? this.takeStepMetrics()
    this.sink.onAssistantUsage({
      turn: data.turn,
      seq: pending?.seq ?? seq,
      usage,
      model: data.message.source.model,
      ...(metrics ? { metrics } : {})
    })
  }

  private captureProviderUsage(data: { turn: number; step: number }, seq: number, usage: TokenUsage): void {
    this.flushPendingProviderUsage()
    const metrics = this.takeStepMetrics()
    this.pendingProviderUsage = {
      turn: data.turn,
      step: data.step,
      seq,
      usage,
      ...(metrics ? { metrics } : {})
    }
  }

  private takePendingProviderUsage(turn: number, step: number) {
    const pending = this.pendingProviderUsage
    if (!pending || pending.turn !== turn || pending.step !== step) return undefined
    this.pendingProviderUsage = undefined
    return pending
  }

  private flushPendingProviderUsage(): void {
    const pending = this.pendingProviderUsage
    if (!pending) return
    this.pendingProviderUsage = undefined
    this.sink.onAssistantUsage(pending)
  }

  /** `maxRetries` is absent only in the retry plugin's `always` mode, which this composition never selects. */
  private handleRetry(data: SessionEventMap['llm/retry']): void {
    this.sink.onApiRetry({
      attempt: data.retry,
      maxRetries: data.mode === 'normal' ? data.maxRetries : 0,
      retryDelayMs: data.delayMs,
      errorStatus: data.failure.status ?? null,
      errorCategory: data.failure.code
    })
  }

  private handleCompactionStart(data: SessionEventMap['compaction/start']): void {
    const trigger = data.sourceCommandId !== undefined ? 'manual' : 'auto'
    this.activeCompactions.set(data.compactionId, {
      startedAt: Date.now(),
      turn: data.turn,
      trigger
    })
    this.sink.onCompaction({ type: 'compaction-start', trigger })
  }

  private handleCompactionSummary(data: SessionEventMap['compaction/summary'], seq: number): void {
    const state = this.activeCompactions.get(data.compactionId)
    if (!state) return
    state.shadowedTokenCount = data.shadowedTokenCount
    if (!data.usage) return
    state.summaryTokens = data.usage.outputTokens
    // The summarize call is real provider spend but never an `assistant/message`,
    // so record the invocation here; it stays out of the turn's message-metadata.
    this.sink.onAssistantUsage({
      turn: state.turn ?? 0,
      seq,
      usage: data.usage,
      model: data.model
    })
  }

  private handleCompactionEnd(data: SessionEventMap['compaction/end']): void {
    const state = this.activeCompactions.get(data.compactionId)
    this.activeCompactions.delete(data.compactionId)
    const error = data.error || undefined
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

/** dsh keeps tool arguments as the raw model-produced JSON string; `{}` on any parse failure. */
function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * dsh wraps every tool result in MCP content blocks, so an all-text result hides its payload
 * inside a JSON string. Unwrap it the way the Claude Code adapter does, so downstream consumers
 * (tool cards, citation resolution, persisted projection) see one shape across runtimes.
 */
function normalizeToolOutput(output: ContentBlock[]): unknown {
  const texts = output.filter((entry): entry is Extract<ContentBlock, { type: 'text' }> => entry.type === 'text')
  if (texts.length === 0 || texts.length !== output.length) return output

  const text = texts.map((entry) => entry.text).join('\n')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function stringifyToolOutput(output: ContentBlock[]): string {
  const text = output
    .filter((entry): entry is Extract<ContentBlock, { type: 'text' }> => entry.type === 'text')
    .map((entry) => entry.text)
    .join('\n')
  if (text) return text
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}
