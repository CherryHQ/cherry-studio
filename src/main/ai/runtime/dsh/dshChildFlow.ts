/**
 * Subagent coordinator for one dsh runtime connection: admits descendant
 * sessions, binds each child to the root tool call that spawned it, projects
 * child session events into parented chunks, and maintains the background-task
 * surface (task events, REPLACE list, work state).
 *
 * Two signals feed admission and neither alone suffices: the SDK wire's
 * `subagent.started` fires only on `session/created` (never on a cold resume),
 * while the bridge's `subagent/lifecycle` fires per residency epoch but rides a
 * different pipe than `session.event`, so child events can race it. Unbound
 * child events are therefore buffered (bounded) until a binding arrives.
 *
 * Binding: the connection reports every spawn-capable tool call it streams
 * (`subagent`, `subagent_fork`, `send_message`) as a FIFO anchor. A child's
 * first epoch binds to the oldest anchor; later epochs (send_message wakes,
 * cold resumes) reuse the connection-persistent binding so one child's whole
 * conversation stays under the tool card that introduced it. Descendants of a
 * child flatten into their ancestor's flow.
 */
import type { BridgeNotificationMap } from '@cherrystudio/dsh-bridge'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import { loggerService } from '@logger'
import type { AgentSessionBackgroundTasks } from '@shared/ai/agentSessionBackgroundTasks'
import type { CherryUIMessageChunk } from '@shared/data/types/message'
import type { AgentTaskEventPartData } from '@shared/data/types/uiParts'

import { DSH_TRANSPORT } from './dshStreamAdapter'

const logger = loggerService.withContext('DshSubagentCoordinator')

/** Tool names whose call anchors a child conversation (spawn or wake). */
const CHILD_ANCHOR_TOOLS = new Set(['subagent', 'subagent_fork', 'send_message'])

/** Per-child cap for events buffered while a binding is still in flight. */
const MAX_UNBOUND_EVENTS = 1_000

type SubagentLifecycleEdge = BridgeNotificationMap['subagent/lifecycle']

export interface DshSubagentSink {
  /**
   * The live parent turn's identity, or null between turns. Captured when a child
   * item OPENS and passed back on every chunk of that item, so an item never
   * splits across two host streams: an opener-less chunk in a turn stream makes
   * the persistence accumulator terminate SILENTLY and the whole turn persists
   * empty (the 2026-08-15 settlement-wake incident).
   */
  currentTurnToken(): number | null
  /** Route one parented chunk under the turn token pinned at its item's open. */
  emitFlowChunk(rootToolCallId: string, chunk: CherryUIMessageChunk, turnToken: number | null): void
  /** One task lifecycle edge (host keeps latest per task; mid-turn it also lands as a data part). */
  emitTaskEvent(data: AgentTaskEventPartData, edgeId: string): void
  /** REPLACE list of children with a live residency epoch. */
  emitTasks(tasks: AgentSessionBackgroundTasks): void
  emitWorkState(active: boolean): void
  recordChildUsage(info: { childSessionId: string; turn: number; seq: number; usage: TokenUsage; model?: string }): void
}

interface ChildState {
  parentSessionId: string
  /** Root tool call this child's flow renders under; undefined until an anchor binds. */
  rootCallId?: string
  /** Spawn `description` (task title); carried by the binding anchor. */
  title?: string
  /** Live residency epoch (one Activation at a time per child). */
  activeRunId?: string
  projection?: DshChildProjection
  buffered: SessionEvent[]
  bufferOverflow: boolean
}

export class DshSubagentCoordinator {
  private readonly children = new Map<string, ChildState>()
  /** FIFO of spawn/wake tool calls awaiting their child epoch. */
  private readonly pendingAnchors: Array<{ callId: string; title?: string }> = []
  private workStateActive = false

  constructor(
    private readonly mainSessionId: string,
    private readonly sink: DshSubagentSink
  ) {}

  /** Observe one main-stream chunk: spawn-capable tool calls become binding anchors. */
  noteMainChunk(chunk: CherryUIMessageChunk): void {
    if (chunk.type !== 'tool-input-available' || !CHILD_ANCHOR_TOOLS.has(chunk.toolName)) return
    const description = (chunk.input as { description?: unknown } | null | undefined)?.description
    this.pendingAnchors.push({
      callId: chunk.toolCallId,
      ...(typeof description === 'string' && description ? { title: description } : {})
    })
  }

  /** SDK-wire `subagent.started` — same pipe as `session.event`, so it precedes child events. */
  handleSdkSubagentStarted(parentSessionId: string, childSessionId: string): void {
    this.bindChild(childSessionId, parentSessionId)
  }

  /** Bridge `subagent/lifecycle` — authoritative per-epoch edges (cold resumes included). */
  handleLifecycle(edge: SubagentLifecycleEdge): void {
    const child = this.bindChild(edge.childSessionId, edge.parentSessionId)
    if (edge.phase === 'start') {
      child.activeRunId = edge.runId
      this.publishTaskEdge(edge.childSessionId, child, 'started', edge.runId)
    } else {
      if (child.activeRunId === edge.runId || child.activeRunId === undefined) child.activeRunId = undefined
      this.publishTaskEdge(edge.childSessionId, child, 'ended', edge.runId, edge.stopReason)
    }
    this.publishTasks()
  }

  /** Whether this session id belongs to (or plausibly races) a descendant. */
  ownsSession(sessionId: string): boolean {
    return sessionId !== this.mainSessionId
  }

  /** Route one descendant `session.event`; unknown/unbound children buffer until bound. */
  handleChildEvent(sessionId: string, event: SessionEvent): void {
    const child = this.children.get(sessionId) ?? this.admit(sessionId, undefined)
    const projection = child.projection
    if (projection) {
      projection.handleEvent(event)
      return
    }
    if (child.buffered.length >= MAX_UNBOUND_EVENTS) {
      if (!child.bufferOverflow) {
        child.bufferOverflow = true
        logger.warn('dsh child session exceeded its unbound event buffer; dropping oldest', { sessionId })
      }
      child.buffered.shift()
    }
    child.buffered.push(event)
  }

  close(): void {
    for (const child of this.children.values()) child.buffered.length = 0
    this.children.clear()
    this.pendingAnchors.length = 0
    if (this.workStateActive) {
      this.workStateActive = false
      this.sink.emitWorkState(false)
    }
  }

  private admit(childSessionId: string, parentSessionId: string | undefined): ChildState {
    const existing = this.children.get(childSessionId)
    if (existing) return existing
    const child: ChildState = {
      parentSessionId: parentSessionId ?? '',
      buffered: [],
      bufferOverflow: false
    }
    this.children.set(childSessionId, child)
    return child
  }

  private bindChild(childSessionId: string, parentSessionId: string): ChildState {
    const child = this.admit(childSessionId, parentSessionId)
    if (!child.parentSessionId) child.parentSessionId = parentSessionId
    if (child.rootCallId === undefined) this.resolveRoot(childSessionId, child)
    return child
  }

  /** Bind to the connection-persistent root: an anchor for direct children, the ancestor's root below. */
  private resolveRoot(childSessionId: string, child: ChildState): void {
    if (!child.parentSessionId) return
    if (child.parentSessionId === this.mainSessionId) {
      const anchor = this.pendingAnchors.shift()
      if (!anchor) return
      child.rootCallId = anchor.callId
      if (anchor.title !== undefined) child.title = anchor.title
    } else {
      const parent = this.children.get(child.parentSessionId)
      if (parent?.rootCallId === undefined) return
      child.rootCallId = parent.rootCallId
      child.title = parent.title
    }
    this.activateProjection(childSessionId, child)
    // A newly bound ancestor may unblock buffered grandchildren.
    for (const [id, pending] of this.children) {
      if (pending.rootCallId === undefined && pending.parentSessionId === childSessionId) {
        this.resolveRoot(id, pending)
      }
    }
  }

  private activateProjection(childSessionId: string, child: ChildState): void {
    if (child.projection || child.rootCallId === undefined) return
    const projection = new DshChildProjection(childSessionId, child.rootCallId, this.sink)
    child.projection = projection
    const backlog = child.buffered
    child.buffered = []
    for (const event of backlog) projection.handleEvent(event)
  }

  private publishTaskEdge(
    childSessionId: string,
    child: ChildState,
    phase: 'started' | 'ended',
    runId: string,
    stopReason?: string
  ): void {
    // Task rows exist for direct children only; deeper descendants fold into their ancestor's flow.
    if (child.parentSessionId !== this.mainSessionId) return
    const status =
      phase === 'started'
        ? 'in_progress'
        : stopReason === 'completed'
          ? 'completed'
          : stopReason === 'aborted'
            ? 'stopped'
            : 'error'
    const data: AgentTaskEventPartData = {
      event: phase === 'started' ? 'started' : 'updated',
      taskId: childSessionId,
      ...(child.rootCallId !== undefined ? { toolUseId: child.rootCallId } : {}),
      status,
      taskType: 'subagent',
      ...(child.title !== undefined ? { title: child.title } : {}),
      ...(status === 'error' && stopReason !== undefined ? { error: `subagent run ended: ${stopReason}` } : {})
    }
    this.sink.emitTaskEvent(data, `${runId}-${phase}`)
  }

  private publishTasks(): void {
    const tasks: AgentSessionBackgroundTasks = []
    let activeEpochs = 0
    for (const [sessionId, child] of this.children) {
      if (child.activeRunId === undefined) continue
      activeEpochs += 1
      if (child.parentSessionId !== this.mainSessionId) continue
      tasks.push({
        id: sessionId,
        type: 'subagent',
        description: child.title ?? sessionId,
        ...(child.rootCallId !== undefined ? { toolCallId: child.rootCallId } : {})
      })
    }
    this.sink.emitTasks(tasks)
    const active = activeEpochs > 0
    if (active !== this.workStateActive) {
      this.workStateActive = active
      this.sink.emitWorkState(active)
    }
  }
}

/**
 * Slim per-child projection: content and tool events become parented chunks;
 * turn/step/compaction lifecycle stays child-internal. Mirrors the main
 * adapter's block-id discipline with a child-scoped prefix so ids never collide
 * with the main stream (or another child) inside one assistant message.
 */
class DshChildProjection {
  private turnSeq = 0
  private lastStepKey?: string
  private readonly openBlocks = new Map<number, 'text' | 'reasoning'>()
  private readonly startedTools = new Map<string, string>()
  /** Destination pinned when a content block opened, keyed by block id. */
  private readonly blockTurnTokens = new Map<string, number | null>()
  /** Destination pinned when a tool call's input was emitted, keyed by call id. */
  private readonly toolTurnTokens = new Map<string, number | null>()
  private readonly idPrefix: string

  constructor(
    private readonly childSessionId: string,
    private readonly rootCallId: string,
    private readonly sink: DshSubagentSink
  ) {
    this.idPrefix = `dsh-c${childSessionId.slice(0, 8)}`
  }

  handleEvent(event: SessionEvent): void {
    switch (event.type) {
      case 'assistant/chunk':
        this.handleAssistantChunk(event.data)
        return
      case 'tool/call':
        this.handleToolCall(event.data)
        return
      case 'tool/result':
        this.handleToolResult(event.data)
        return
      case 'assistant/message': {
        const usage = event.data.usage
        if (usage) {
          this.sink.recordChildUsage({
            childSessionId: this.childSessionId,
            turn: event.data.turn,
            seq: event.seq,
            usage,
            model: event.data.message.source.model
          })
        }
        return
      }
      default:
        // turn/step lifecycle, compaction, todo etc. stay child-internal; the
        // parent-facing outcome arrives via the subagent tool result / notices.
        return
    }
  }

  private emit(chunk: CherryUIMessageChunk, turnToken: number | null): void {
    this.sink.emitFlowChunk(this.rootCallId, chunk, turnToken)
  }

  private blockId(index: number): string {
    return `${this.idPrefix}-${this.turnSeq}-${index}`
  }

  private contentMetadata() {
    return {
      cherry: { transport: DSH_TRANSPORT, parentToolCallId: this.rootCallId },
      dsh: { childSessionId: this.childSessionId }
    }
  }

  private toolMetadata(toolName: string, extra: Record<string, unknown> = {}) {
    return {
      cherry: {
        transport: DSH_TRANSPORT,
        parentToolCallId: this.rootCallId,
        tool: { type: 'builtin', name: toolName }
      },
      dsh: { toolName, childSessionId: this.childSessionId, ...extra }
    }
  }

  private handleAssistantChunk(data: SessionEventMap['assistant/chunk']): void {
    const stepKey = `${data.turn}:${data.step}`
    if (stepKey !== this.lastStepKey) {
      this.lastStepKey = stepKey
      this.turnSeq += 1
      this.openBlocks.clear()
    }
    const chunk = data.chunk
    switch (chunk.type) {
      case 'block-start':
        if (chunk.blockType === 'text' || chunk.blockType === 'reasoning') {
          this.openBlock(chunk.index, chunk.blockType)
        }
        return
      case 'text-delta':
        if (!this.openBlocks.has(chunk.index)) this.openBlock(chunk.index, 'text')
        this.emit(
          { type: 'text-delta', id: this.blockId(chunk.index), delta: chunk.text },
          this.blockToken(chunk.index)
        )
        return
      case 'reasoning-delta':
        if (!this.openBlocks.has(chunk.index)) this.openBlock(chunk.index, 'reasoning')
        this.emit(
          { type: 'reasoning-delta', id: this.blockId(chunk.index), delta: chunk.text },
          this.blockToken(chunk.index)
        )
        return
      case 'block-end': {
        const kind = this.openBlocks.get(chunk.index)
        this.openBlocks.delete(chunk.index)
        const token = this.blockToken(chunk.index)
        this.blockTurnTokens.delete(this.blockId(chunk.index))
        if (kind === 'text') this.emit({ type: 'text-end', id: this.blockId(chunk.index) }, token)
        else if (kind === 'reasoning') this.emit({ type: 'reasoning-end', id: this.blockId(chunk.index) }, token)
        return
      }
      default:
        return
    }
  }

  private blockToken(index: number): number | null {
    return this.blockTurnTokens.get(this.blockId(index)) ?? null
  }

  private openBlock(index: number, kind: 'text' | 'reasoning'): void {
    this.openBlocks.set(index, kind)
    const token = this.sink.currentTurnToken()
    this.blockTurnTokens.set(this.blockId(index), token)
    this.emit(
      {
        type: kind === 'text' ? 'text-start' : 'reasoning-start',
        id: this.blockId(index),
        providerMetadata: this.contentMetadata()
      },
      token
    )
  }

  private handleToolCall(data: Pick<SessionEventMap['tool/call'], 'callId' | 'name' | 'arguments'>): void {
    const toolCallId = data.callId
    if (!toolCallId || this.startedTools.has(toolCallId)) return
    this.startedTools.set(toolCallId, data.name)
    const token = this.sink.currentTurnToken()
    this.toolTurnTokens.set(toolCallId, token)
    this.emit(
      {
        type: 'tool-input-start',
        toolCallId,
        toolName: data.name,
        providerExecuted: true,
        dynamic: true,
        providerMetadata: this.toolMetadata(data.name)
      },
      token
    )
    this.emit(
      {
        type: 'tool-input-available',
        toolCallId,
        toolName: data.name,
        input: parseChildToolArguments(data.arguments),
        providerExecuted: true,
        dynamic: true,
        providerMetadata: this.toolMetadata(data.name)
      },
      token
    )
  }

  private handleToolResult(data: SessionEventMap['tool/result']): void {
    const block = data.message.content[0]
    const toolCallId = block.toolCallId
    if (!toolCallId) return
    if (!this.startedTools.has(toolCallId)) {
      this.handleToolCall({ callId: toolCallId, name: 'unknown', arguments: '{}' })
    }
    const toolName = this.startedTools.get(toolCallId) ?? 'unknown'
    // The result follows its input's pinned destination — a result landing in a
    // stream that never saw the input silently kills that stream's accumulator.
    const token = this.toolTurnTokens.get(toolCallId) ?? null
    this.toolTurnTokens.delete(toolCallId)
    if (data.error !== undefined || block.isError === true) {
      this.emit(
        {
          type: 'tool-output-error',
          toolCallId,
          errorText: stringifyChildToolOutput(block.content),
          dynamic: true,
          providerExecuted: true,
          providerMetadata: this.toolMetadata(toolName, data.error ? { error: data.error } : {})
        },
        token
      )
      return
    }
    this.emit(
      {
        type: 'tool-output-available',
        toolCallId,
        output: block.content,
        dynamic: true,
        providerExecuted: true,
        providerMetadata: this.toolMetadata(toolName)
      },
      token
    )
  }
}

function parseChildToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function stringifyChildToolOutput(output: SessionEventMap['tool/result']['message']['content'][0]['content']): string {
  const text = output
    .filter((entry): entry is Extract<(typeof output)[number], { type: 'text' }> => entry.type === 'text')
    .map((entry) => entry.text)
    .join('\n')
  if (text) return text
  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}
