/**
 * Agent-session connection for the `ai-sdk` runtime.
 *
 * Cherry owns the session; each `send()` runs ONE AI SDK execution built from
 * a durable context snapshot (plan D2): tuple-bounded SQLite replay plus the
 * incoming user row, assembled fresh every turn. The connection holds only
 * live turn state (abort handle), the latest measured context usage, and the
 * live policy/config snapshots reconcile patches — SQLite is the recovery
 * source, so there is never a resume token to emit.
 *
 * No `redirect()`: AI SDK v6 has no mid-turn user-input channel, so the host
 * queues live follow-ups and sends them as the next turn with
 * `systemReminder` semantics (plan D11).
 */

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import type { AgentEntity, AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { findTokenLimit } from '@shared/utils/model'
import type { LanguageModelUsage, ToolSet, UIMessage, UIMessageChunk } from 'ai'

import { buildAgentUserContent } from '../agentUserContent'
import type { SdkConfig } from '../aiSdk'
import { Agent } from '../aiSdk'
import { AsyncEventQueue } from '../asyncEventQueue'
import { parseManualCompactCommand } from '../compactCommand'
import type { DispatchDecision } from '../toolApproval/ToolApprovalRegistry'
import { toolApprovalRegistry } from '../toolApproval/ToolApprovalRegistry'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeUserInput
} from '../types'
import type { PendingApprovalRequest, SegmentStats, SettledApproval } from './approvalContinuation'
import { accumulateAssistantMessage, addSegmentStats, applyApprovalDecisions } from './approvalContinuation'
import { buildAiSdkAgentParams } from './buildAiSdkAgentParams'
import { AUTO_COMPACT_THRESHOLD_PERCENT, compactSession } from './compaction'
import { buildTurnMessages } from './sessionHistory'
import { adaptAgentChunk, stampApprovalRequestChunk } from './streamAdapter'
import { buildAgentToolSet } from './tools/buildAgentToolSet'
import { resolveAiSdkAgentModel, resolveAndAssertAiSdkAgentModel } from './validateModel'

const logger = loggerService.withContext('AiSdkRuntimeConnection')

export class AiSdkRuntimeConnection implements AgentRuntimeConnection {
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private closed = false
  /** Live tool policy, hot-patched by reconcile ahead of any rebuild verdict (plan D12).
   *  Read at tool fire-time once the runtime's tool phase lands. */
  private permissionMode: AgentPermissionMode = 'default'
  private disabledTools = new Set<string>()
  /** Spawn-frozen agent/workspace/model facts, excluding the live policy gate. */
  private connectionSignature?: string
  /** Latest measured occupancy; null until the first AI SDK step reports usage. */
  private latestContextUsage: AgentSessionContextUsage | null = null
  private activeTurnAbort?: AbortController
  /** Serializes reconciles so concurrent push/pull calls cannot interleave policy swaps. */
  private reconcileQueue: Promise<unknown> = Promise.resolve()

  readonly events = this.eventQueue

  constructor(private readonly input: AgentRuntimeConnectInput) {}

  async start(): Promise<this> {
    const session = agentSessionService.getById(this.input.sessionId)
    const workspacePath = session?.workspace?.path
    if (!session?.agentId || !workspacePath) {
      throw new Error(`ai-sdk agent session ${this.input.sessionId} has no agent or workspace configured`)
    }
    const agent = agentService.getAgent(session.agentId)
    if (!agent?.model) {
      throw new Error(`ai-sdk agent ${session.agentId} has no model configured`)
    }
    // Fail fast before the first turn; per-turn assembly re-resolves so key
    // rotation and provider edits stay live.
    resolveAndAssertAiSdkAgentModel(this.input.modelId)

    this.permissionMode = agent.configuration?.permission_mode ?? 'default'
    this.disabledTools = new Set(agent.disabledTools ?? [])
    this.connectionSignature = buildConnectionSignature(agent, workspacePath, this.input.modelId)
    return this
  }

  send(input: AgentRuntimeUserInput): void {
    void this.runTurn(input).catch((error) => {
      if (this.closed) return
      logger.error('ai-sdk agent turn failed', error as Error)
      this.eventQueue.push({ type: 'error', error })
    })
  }

  /**
   * One host turn = one or more AI SDK execution segments (plan D8). The SDK's
   * approval protocol is request → terminate → restart: a segment that ends
   * with pending approval requests is followed — inside this same turn — by a
   * continuation segment whose history carries the decisions, so approved
   * tools execute at its top. Terminal behavior is exactly-once by
   * construction: `turn-complete` is pushed only after the final segment
   * drains cleanly, and every throw before that point routes through `send`'s
   * single error push.
   */
  private async runTurn(input: AgentRuntimeUserInput): Promise<void> {
    const session = agentSessionService.getById(this.input.sessionId)
    const workspacePath = session?.workspace?.path
    if (!session?.agentId || !workspacePath) {
      throw new Error(`ai-sdk agent session ${this.input.sessionId} has no agent or workspace configured`)
    }
    const agent = agentService.getAgent(session.agentId)
    if (!agent) {
      throw new Error(`ai-sdk agent ${session.agentId} no longer exists`)
    }
    const { provider, model } = resolveAndAssertAiSdkAgentModel(this.input.modelId)

    // A manual `/compact [focus]` is its own host turn (plan D10, pi parity).
    // A `systemReminder` input is a re-queued steer, never a command.
    const manualCompact = input.systemReminder
      ? undefined
      : parseManualCompactCommand(buildAgentUserContent(input.message))
    if (manualCompact) {
      await this.runManualCompactTurn(input, manualCompact.instructions, { agent, workspacePath, provider, model })
      return
    }

    // Policy accessors are closures over the connection's live state, so a
    // reconcile hot-patch applies to the very next tool call (plan D7/D12).
    const { tools, skills } = await buildAgentToolSet({
      agent,
      workspacePath,
      policy: {
        getPermissionMode: () => this.permissionMode,
        isDisabled: (toolName) => this.disabledTools.has(toolName)
      }
    })

    const built = await buildAiSdkAgentParams({
      agent,
      sessionId: this.input.sessionId,
      workspacePath,
      provider,
      model,
      skills,
      requestId: this.input.trace?.turnId || undefined
    })

    const abort = new AbortController()
    this.activeTurnAbort = abort
    let statsBaseline: SegmentStats | null = null
    // The whole turn stays ONE assistant message: each continuation reduces
    // its chunks onto the previous segments' snapshot and REPLACES the
    // trailing assistant message instead of appending a second one.
    let assistantSnapshot: UIMessage | undefined
    try {
      // Pre-turn auto-compaction (plan D10): only a measured occupancy can trip
      // the threshold, and success resets the measurement — so at most one
      // attempt per turn, and never on a session's first turn.
      if (this.latestContextUsage && this.latestContextUsage.percentage >= AUTO_COMPACT_THRESHOLD_PERCENT) {
        await this.tryAutoCompact(input, built.sdkConfig, abort.signal)
        if (this.closed || abort.signal.aborted) return
      }

      // Replay boundary requires the incoming user row to be durable (plan D4) —
      // this throws when it is not, failing the turn instead of double-sending.
      // Built AFTER the compaction gate so the turn replays the fresh anchor.
      const turnMessages: UIMessage[] = buildTurnMessages(this.input.sessionId, input) as unknown as UIMessage[]
      let messages: UIMessage[] = turnMessages

      for (;;) {
        const segment = await this.runSegment({ built, tools, model, messages, signal: abort.signal, statsBaseline })
        if (this.closed || abort.signal.aborted) return
        if (segment.approvals.length === 0) break

        // A step's requests settle as a group before any continuation.
        const decisions = await Promise.all(segment.approvals.map((request) => request.decision))
        if (this.closed || abort.signal.aborted) return

        const settled: SettledApproval[] = segment.approvals.map((request, index) => ({
          request,
          decision: decisions[index]
        }))
        assistantSnapshot = applyApprovalDecisions(
          await accumulateAssistantMessage(segment.rawChunks, assistantSnapshot),
          settled
        )
        messages = [...turnMessages, assistantSnapshot]
        statsBaseline = segment.lastStats
      }
    } finally {
      if (this.activeTurnAbort === abort) this.activeTurnAbort = undefined
    }

    if (this.latestContextUsage) {
      this.eventQueue.push({ type: 'context-usage', usage: this.latestContextUsage })
    }
    this.eventQueue.push({ type: 'turn-complete' })
  }

  /**
   * A manual `/compact` runs no model turn: compaction events plus
   * `turn-complete` on success; a throw propagates to `send`'s single terminal
   * error (pi parity — the host settles the compacting state on either). A
   * no-op (nothing beyond the retained tail) completes without an anchor.
   */
  private async runManualCompactTurn(
    input: AgentRuntimeUserInput,
    focus: string,
    ctx: Pick<Parameters<typeof buildAiSdkAgentParams>[0], 'agent' | 'workspacePath' | 'provider' | 'model'>
  ): Promise<void> {
    // Agent system prompt, tools, and skills are irrelevant to summarization —
    // only the provider execution config is reused.
    const built = await buildAiSdkAgentParams({
      ...ctx,
      sessionId: this.input.sessionId,
      requestId: this.input.trace?.turnId || undefined
    })
    const abort = new AbortController()
    this.activeTurnAbort = abort
    this.eventQueue.push({ type: 'compaction-start', trigger: 'manual' })
    try {
      const anchor = await compactSession({
        sessionId: this.input.sessionId,
        boundaryMessageId: input.message.id,
        trigger: 'manual',
        focus: focus || undefined,
        sdkConfig: built.sdkConfig,
        modelId: this.input.modelId,
        preTokens: this.latestContextUsage?.totalTokens,
        signal: abort.signal
      })
      if (this.closed || abort.signal.aborted) return
      // Occupancy is unknown until the next measured step (pi parity).
      if (anchor) this.latestContextUsage = null
      this.eventQueue.push(anchor ? { type: 'compaction-complete', anchor } : { type: 'compaction-complete' })
      this.eventQueue.push({ type: 'turn-complete' })
    } finally {
      if (this.activeTurnAbort === abort) this.activeTurnAbort = undefined
    }
  }

  /**
   * Automatic threshold compaction is non-terminal by contract: on failure the
   * turn proceeds uncompacted and any context overflow surfaces as the turn's
   * own provider error — no silent truncation, no hidden retry loop.
   */
  private async tryAutoCompact(input: AgentRuntimeUserInput, sdkConfig: SdkConfig, signal: AbortSignal): Promise<void> {
    this.eventQueue.push({ type: 'compaction-start', trigger: 'auto' })
    try {
      const anchor = await compactSession({
        sessionId: this.input.sessionId,
        boundaryMessageId: input.message.id,
        trigger: 'auto',
        sdkConfig,
        modelId: this.input.modelId,
        preTokens: this.latestContextUsage?.totalTokens,
        signal
      })
      if (this.closed || signal.aborted) return
      if (anchor) this.latestContextUsage = null
      this.eventQueue.push(anchor ? { type: 'compaction-complete', anchor } : { type: 'compaction-complete' })
    } catch (error) {
      if (this.closed || signal.aborted) return
      logger.warn('ai-sdk auto compaction failed; continuing the turn uncompacted', { error })
      this.eventQueue.push({ type: 'compaction-error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Run one AI SDK execution and forward its adapted chunks. Approval
   * requests are intercepted rather than blind-forwarded (registry first,
   * card only when actually pending); a segment that gathered requests has
   * its `finish` suppressed so the host turn keeps one outer frame — only
   * the final segment's `finish` reaches the renderer.
   */
  private async runSegment(ctx: {
    built: Awaited<ReturnType<typeof buildAiSdkAgentParams>>
    tools: ToolSet
    model: Model
    messages: UIMessage[]
    signal: AbortSignal
    statsBaseline: SegmentStats | null
  }): Promise<{ approvals: PendingApprovalRequest[]; rawChunks: UIMessageChunk[]; lastStats: SegmentStats | null }> {
    // Per-segment Agent construction is deliberate: a continuation call
    // executes the approved tools of the previous segment at its top, so the
    // executor must be rebuilt around the continuation history.
    const executor = new Agent({
      providerId: ctx.built.sdkConfig.providerId,
      providerSettings: ctx.built.sdkConfig.providerSettings,
      modelId: ctx.built.sdkConfig.modelId,
      tools: ctx.tools,
      system: ctx.built.system,
      options: ctx.built.options
    })
    executor.on('onStepFinish', (step) => {
      if (step.usage) this.captureContextUsage(step.usage, ctx.model, ctx.built.sdkConfig.modelId)
    })

    const approvals: PendingApprovalRequest[] = []
    const rawChunks: UIMessageChunk[] = []
    const toolNames = new Map<string, string>()
    const toolInputs = new Map<string, unknown>()
    let lastStats = ctx.statsBaseline

    const reader = executor.stream(ctx.messages, ctx.signal).getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        rawChunks.push(value)

        if (value.type === 'tool-input-start') toolNames.set(value.toolCallId, value.toolName)
        if (value.type === 'tool-input-available') toolInputs.set(value.toolCallId, value.input)

        if (value.type === 'tool-approval-request') {
          approvals.push(this.interceptApprovalRequest(value, toolNames, toolInputs, ctx.signal))
          continue
        }
        // Non-final `finish`: the SDK closes every segment with its own
        // finish, but pending approvals mean this turn continues.
        if (value.type === 'finish' && approvals.length > 0) continue

        let chunk: UIMessageChunk = value
        if (value.type === 'message-metadata') {
          const metadata = ctx.statsBaseline
            ? addSegmentStats(ctx.statsBaseline, value.messageMetadata as SegmentStats)
            : (value.messageMetadata as SegmentStats)
          chunk = { ...value, messageMetadata: metadata } as UIMessageChunk
          lastStats = metadata
        }
        const adapted = adaptAgentChunk(chunk)
        if (adapted) this.eventQueue.push({ type: 'chunk', chunk: adapted })
      }
    } finally {
      reader.releaseLock()
    }

    return { approvals, rawChunks, lastStats }
  }

  /**
   * Bridge one SDK approval request to the driver-neutral registry. Headless
   * turns (scheduled/channel runs) have no responder: deny synchronously,
   * emit no card, register nothing (plan D7). Interactive turns register
   * first and emit the stamped card only when actually pending — a duplicate
   * or already-aborted registration resolves itself.
   */
  private interceptApprovalRequest(
    request: Extract<UIMessageChunk, { type: 'tool-approval-request' }>,
    toolNames: ReadonlyMap<string, string>,
    toolInputs: ReadonlyMap<string, unknown>,
    signal: AbortSignal
  ): PendingApprovalRequest {
    const toolName = toolNames.get(request.toolCallId) ?? 'unknown'
    const base = { approvalId: request.approvalId, toolCallId: request.toolCallId, toolName }

    if (application.get('AgentSessionRuntimeService').isCurrentTurnHeadless(this.input.sessionId)) {
      return {
        ...base,
        decision: Promise.resolve({ approved: false, reason: 'Headless turn cannot answer approval prompts.' })
      }
    }

    const decision = new Promise<DispatchDecision>((resolve) => {
      const pending = toolApprovalRegistry.register({
        approvalId: request.approvalId,
        sessionId: this.input.sessionId,
        toolCallId: request.toolCallId,
        toolName,
        originalInput: (toolInputs.get(request.toolCallId) ?? {}) as Record<string, unknown>,
        signal,
        resolve
      })
      if (!pending) return
      this.eventQueue.push({ type: 'chunk', chunk: stampApprovalRequestChunk(request, toolName) })
    })
    return { ...base, decision }
  }

  /**
   * Security-first reconcile (plan D12): live policy is swapped before the
   * rebuild verdict, and a thrown reconcile is the host's fail-closed `failed`
   * path. Serialized so concurrent push/pull reconciles cannot interleave.
   */
  async reconcile(input: { modelId: UniqueModelId }): Promise<AgentRuntimeReconcileResult> {
    const run = this.reconcileQueue.then(() => this.reconcileOnce(input.modelId))
    this.reconcileQueue = run.catch(() => undefined)
    return run
  }

  private reconcileOnce(modelId: UniqueModelId): AgentRuntimeReconcileResult {
    const agent = agentService.getAgent(this.input.agentId)
    if (!agent?.model) return 'invalid'
    const session = agentSessionService.getById(this.input.sessionId)
    const workspacePath = session?.workspace?.path
    if (!workspacePath) return 'invalid'
    if (!isModelDerivable(modelId)) return 'invalid'

    const nextPermissionMode = agent.configuration?.permission_mode ?? 'default'
    const nextDisabledTools = new Set(agent.disabledTools ?? [])
    const policyChanged =
      nextPermissionMode !== this.permissionMode || !setsEqual(nextDisabledTools, this.disabledTools)
    this.permissionMode = nextPermissionMode
    this.disabledTools = nextDisabledTools

    if (buildConnectionSignature(agent, workspacePath, modelId) !== this.connectionSignature) return 'rebuild'
    return policyChanged ? 'patched' : 'current'
  }

  async getContextUsage(): Promise<AgentSessionContextUsage | null> {
    return this.latestContextUsage
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    // Settle any approval a future tool phase may have registered so no
    // renderer decision promise outlives the connection.
    toolApprovalRegistry.abort(this.input.sessionId, 'ai-sdk-session-closed')
    this.activeTurnAbort?.abort('ai-sdk-session-closed')
    this.activeTurnAbort = undefined
    this.eventQueue.close()
  }

  /**
   * Occupancy after each AI SDK step: the step's prompt tokens already include the
   * whole rebuilt history, so `input + output` is the live window occupancy. The
   * window size comes from the model row, falling back to the shared token-limit
   * table; without either the measurement is skipped rather than fabricated.
   */
  private captureContextUsage(usage: LanguageModelUsage, model: Model, sdkModelId: string): void {
    const maxTokens = model.contextWindow ?? findTokenLimit(sdkModelId)?.max
    if (!maxTokens || maxTokens <= 0) return
    const totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    if (totalTokens <= 0) return
    this.latestContextUsage = {
      categories: [],
      totalTokens,
      maxTokens,
      percentage: Math.min(100, (totalTokens / maxTokens) * 100),
      model: sdkModelId
    }
  }
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

/** Derivation only: a deleted model/provider row is `invalid`; a merely
 *  unusable one (e.g. key revoked) fails the next turn instead. */
function isModelDerivable(modelId: UniqueModelId): boolean {
  try {
    resolveAiSdkAgentModel(modelId)
    return true
  } catch {
    return false
  }
}

/**
 * Spawn-frozen inputs (plan D12): everything on the agent except the live
 * policy gate (permission mode, disabled tools), plus the session workspace
 * and the pinned model. Turns rebuild their params from live rows anyway, so
 * a rebuild here is cheap — but the verdict keeps the host's connection
 * bookkeeping (and the pinned modelId) honest.
 */
function buildConnectionSignature(agent: AgentEntity, workspacePath: string, modelId: UniqueModelId): string {
  const agentFacts = { ...agent, updatedAt: undefined, disabledTools: undefined }
  const configurationFacts = { ...agent.configuration, permission_mode: undefined }
  return JSON.stringify({
    agent: { ...agentFacts, configuration: configurationFacts },
    workspacePath,
    modelId
  })
}
