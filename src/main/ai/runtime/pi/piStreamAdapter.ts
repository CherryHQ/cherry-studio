/**
 * Translate pi `AgentSessionEvent`s into Cherry `UIMessageChunk`s (plan D3).
 *
 * pi's event vocabulary differs from Claude Code's, so this is a fresh, smaller
 * adapter (not a reuse of the Claude `streamAdapter`). It maps only the
 * content/tool/usage surface; turn lifecycle (`agent_end` → `turn-complete`,
 * resume tokens, errors) is owned by `PiRuntimeConnection`.
 *
 * Mapping:
 * - `message_update` text/thinking deltas → text and reasoning chunks
 * - `tool_execution_start` → tool-input-start + tool-input-available
 * - `tool_execution_end` → tool-output-available / tool-output-error
 * - `turn_end` (assistant message) → `message-metadata` usage projection
 *
 * Tool parts are stamped with the pi runtime transport tag
 * (D8) so the renderer routes them to the generic pi tool card.
 */
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { CherryUIMessageChunk } from '@shared/data/types/message'

export interface PiStreamSink {
  enqueue(chunk: CherryUIMessageChunk): void
}

/** pi transport tag consumed by the renderer's tool-part routing (D8). */
export const PI_TRANSPORT = AGENT_RUNTIME_CAPABILITIES.pi.transport

function toolProviderMetadata(toolName: string, extra: Record<string, unknown> = {}) {
  return {
    cherry: {
      transport: PI_TRANSPORT,
      tool: { type: 'builtin', name: toolName }
    },
    pi: { toolName, ...extra }
  }
}

export class PiStreamAdapter {
  /** Bumped on every assistant `message_start` so content-part ids stay unique
   *  across the multiple assistant messages of a single multi-turn tool loop
   *  (pi resets `contentIndex` to 0 per message). */
  private messageSeq = 0
  private readonly startedTools = new Set<string>()
  /** Running token totals for the current turn (`agent_start` → `agent_end`).
   *  pi's `Usage` is per-assistant-message, but a Cherry turn spans N `turn_end`s
   *  (one per LLM response in the tool loop) that accumulate into a single message
   *  whose `message-metadata` is last-wins. Summing here makes the final chunk carry
   *  the whole turn's tokens instead of just the last LLM call — parity with the
   *  Claude driver, whose SDK `result` usage is already a turn total. */
  private turnUsage = emptyTurnUsage()

  constructor(private readonly sink: PiStreamSink) {}

  handleEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case 'agent_start':
        // New turn — reset the per-turn token accumulator.
        this.turnUsage = emptyTurnUsage()
        return
      case 'message_start':
        // User-role starts also bump this. Harmless: ids only need to be unique, and skipping a
        // sequence avoids reusing ids after a delivered steer's user message.
        this.messageSeq += 1
        return
      case 'message_update':
        this.handleAssistantDelta(event.assistantMessageEvent as AssistantMessageEventLike)
        return
      case 'tool_execution_start':
        this.handleToolStart(event.toolCallId, event.toolName, event.args)
        return
      case 'tool_execution_end':
        this.handleToolEnd(event.toolCallId, event.toolName, event.result, event.isError)
        return
      case 'turn_end':
        this.handleTurnEnd(event.message)
        return
      default:
        // tool_execution_update (no standard partial-output chunk in v1),
        // agent_end, compaction_*, retry, queue_update, etc. are lifecycle
        // events handled by the connection or intentionally ignored.
        return
    }
  }

  private textId(contentIndex: number): string {
    return `pi-${this.messageSeq}-text-${contentIndex}`
  }

  private reasoningId(contentIndex: number): string {
    return `pi-${this.messageSeq}-reasoning-${contentIndex}`
  }

  private handleAssistantDelta(event: AssistantMessageEventLike): void {
    switch (event.type) {
      case 'text_start':
        this.sink.enqueue({ type: 'text-start', id: this.textId(event.contentIndex) })
        return
      case 'text_delta':
        this.sink.enqueue({ type: 'text-delta', id: this.textId(event.contentIndex), delta: event.delta })
        return
      case 'text_end':
        this.sink.enqueue({ type: 'text-end', id: this.textId(event.contentIndex) })
        return
      case 'thinking_start':
        this.sink.enqueue({ type: 'reasoning-start', id: this.reasoningId(event.contentIndex) })
        return
      case 'thinking_delta':
        this.sink.enqueue({ type: 'reasoning-delta', id: this.reasoningId(event.contentIndex), delta: event.delta })
        return
      case 'thinking_end':
        this.sink.enqueue({ type: 'reasoning-end', id: this.reasoningId(event.contentIndex) })
        return
      default:
        // start/done/error and toolcall_* deltas — tool calls are surfaced via
        // the tool_execution_* events instead, which carry the executed args.
        return
    }
  }

  private handleToolStart(toolCallId: string, toolName: string, args: unknown): void {
    if (this.startedTools.has(toolCallId)) return
    this.startedTools.add(toolCallId)
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
      input: args ?? {},
      providerExecuted: true,
      dynamic: true,
      providerMetadata: toolProviderMetadata(toolName)
    })
  }

  private handleToolEnd(toolCallId: string, toolName: string, result: unknown, isError: boolean): void {
    // A tool result with no preceding start (defensive) still needs its input parts.
    if (!this.startedTools.has(toolCallId)) this.handleToolStart(toolCallId, toolName, {})
    if (isError) {
      this.sink.enqueue({
        type: 'tool-output-error',
        toolCallId,
        errorText: stringifyResult(result),
        dynamic: true,
        providerExecuted: true,
        providerMetadata: toolProviderMetadata(toolName)
      })
      return
    }
    this.sink.enqueue({
      type: 'tool-output-available',
      toolCallId,
      output: result ?? null,
      dynamic: true,
      providerExecuted: true,
      providerMetadata: toolProviderMetadata(toolName)
    })
  }

  private handleTurnEnd(message: unknown): void {
    const usage = extractAssistantUsage(message)
    if (!usage) return
    const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite
    const completionTokens = usage.output
    const totalTokens = usage.totalTokens && usage.totalTokens > 0 ? usage.totalTokens : promptTokens + completionTokens
    // Accumulate across the turn's LLM responses; emit the running total so the
    // last-wins `message-metadata` carries the whole turn, not just this response.
    this.turnUsage.promptTokens += promptTokens
    this.turnUsage.completionTokens += completionTokens
    this.turnUsage.totalTokens += totalTokens
    if (usage.reasoning !== undefined) {
      this.turnUsage.thoughtsTokens += usage.reasoning
      this.turnUsage.hasReasoning = true
    }
    this.sink.enqueue({
      type: 'message-metadata',
      messageMetadata: {
        totalTokens: this.turnUsage.totalTokens,
        promptTokens: this.turnUsage.promptTokens,
        completionTokens: this.turnUsage.completionTokens,
        ...(this.turnUsage.hasReasoning ? { thoughtsTokens: this.turnUsage.thoughtsTokens } : {})
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

/**
 * Structural shape of the pi-ai `AssistantMessageEvent` variants we consume.
 * The connection casts pi's full event to this before dispatch; unlisted
 * variants (start/done/error, toolcall_*) fall through the adapter's `default`.
 */
type AssistantMessageEventLike =
  | { type: 'text_start'; contentIndex: number }
  | { type: 'text_delta'; contentIndex: number; delta: string }
  | { type: 'text_end'; contentIndex: number }
  | { type: 'thinking_start'; contentIndex: number }
  | { type: 'thinking_delta'; contentIndex: number; delta: string }
  | { type: 'thinking_end'; contentIndex: number }
  | { type: 'start' | 'done' | 'error' | 'toolcall_start' | 'toolcall_delta' | 'toolcall_end' }

interface PiUsageLike {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning?: number
  totalTokens?: number
}

function extractAssistantUsage(message: unknown): PiUsageLike | undefined {
  if (typeof message !== 'object' || message === null) return undefined
  const record = message as { role?: unknown; usage?: unknown }
  if (record.role !== 'assistant') return undefined
  const usage = record.usage
  if (typeof usage !== 'object' || usage === null) return undefined
  const u = usage as Record<string, unknown>
  return {
    input: numeric(u.input),
    output: numeric(u.output),
    cacheRead: numeric(u.cacheRead),
    cacheWrite: numeric(u.cacheWrite),
    reasoning: typeof u.reasoning === 'number' ? u.reasoning : undefined,
    totalTokens: typeof u.totalTokens === 'number' ? u.totalTokens : undefined
  }
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringifyResult(result: unknown): string {
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}
