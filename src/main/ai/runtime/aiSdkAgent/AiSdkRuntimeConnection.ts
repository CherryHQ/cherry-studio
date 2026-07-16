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

import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import type { AgentEntity, AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { findTokenLimit } from '@shared/utils/model'
import type { LanguageModelUsage } from 'ai'

import { Agent } from '../aiSdk'
import { AsyncEventQueue } from '../asyncEventQueue'
import { toolApprovalRegistry } from '../toolApproval/ToolApprovalRegistry'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeReconcileResult,
  AgentRuntimeUserInput
} from '../types'
import { buildAiSdkAgentParams } from './buildAiSdkAgentParams'
import { buildTurnMessages } from './sessionHistory'
import { adaptAgentChunk } from './streamAdapter'
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
   * One host turn = one AI SDK execution. Terminal behavior is exactly-once by
   * construction: `turn-complete` is pushed only after a clean stream drain, and
   * every throw before that point routes through `send`'s single error push.
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

    // Replay boundary requires the incoming user row to be durable (plan D4) —
    // this throws when it is not, failing the turn instead of double-sending.
    const messages = buildTurnMessages(this.input.sessionId, input)

    const built = await buildAiSdkAgentParams({
      agent,
      sessionId: this.input.sessionId,
      workspacePath,
      provider,
      model,
      requestId: this.input.trace?.turnId || undefined
    })

    const executor = new Agent({
      providerId: built.sdkConfig.providerId,
      providerSettings: built.sdkConfig.providerSettings,
      modelId: built.sdkConfig.modelId,
      // Workspace/MCP/skill tools land in the runtime's tool phase; the loop
      // core, replay, and terminal behavior are tool-set independent.
      tools: {},
      system: built.system,
      options: built.options
    })
    executor.on('onStepFinish', (step) => {
      if (step.usage) this.captureContextUsage(step.usage, model, built.sdkConfig.modelId)
    })

    const abort = new AbortController()
    this.activeTurnAbort = abort
    const reader = executor.stream(messages, abort.signal).getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const adapted = adaptAgentChunk(value)
        if (adapted) this.eventQueue.push({ type: 'chunk', chunk: adapted })
      }
    } finally {
      reader.releaseLock()
      if (this.activeTurnAbort === abort) this.activeTurnAbort = undefined
    }

    if (this.latestContextUsage) {
      this.eventQueue.push({ type: 'context-usage', usage: this.latestContextUsage })
    }
    this.eventQueue.push({ type: 'turn-complete' })
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
