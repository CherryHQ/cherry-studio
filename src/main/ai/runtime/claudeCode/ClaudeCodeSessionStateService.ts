/**
 * Session-keyed live state for Claude Code connections.
 *
 * A warm-pooled query bakes its `canUseTool` + hooks at prewarm time, and the warm pool strips
 * closures from its signature — so those callbacks must resolve the CURRENT session state by id at
 * fire-time, never capture a per-build instance. This service owns that state: the approval-emitter
 * and steer holders a live connection binds, the shared tool-policy snapshot a mid-session agent
 * update refreshes in place, and the MCP catalog subscription that keeps snapshot + tool-card
 * metadata in sync with a live `tools/list_changed`.
 *
 * Container-managed singleton: one instance process-wide guarantees the fire-time lookup and the
 * settings build observe the same maps. `ClaudeCodeRuntimeDriver.teardownSession` is the ONLY
 * per-session dispose path; `onStop`/`onDestroy` sweep whatever shutdown leaves behind.
 */

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { createClaudeAgentToolPolicySnapshot } from '@main/ai/tools/adapters/claudeCode/agentTools'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import {
  BASH_HISTORY_LIMIT,
  BASH_RUN_BREAK_MARKER,
  bashNoProgressRunLength,
  type BashOutcome,
  fingerprintBashOutput,
  normalizeBashCommand
} from './bashNoProgress'
import { buildMcpToolMetadata } from './mcpCatalog'
import type { McpToolDisplayMetadata, SteerHolder, ToolApprovalEmitterHolder } from './types'

const logger = loggerService.withContext('ClaudeCodeSessionStateService')

export type ToolPolicySnapshot = Awaited<ReturnType<typeof createClaudeAgentToolPolicySnapshot>>

interface McpSessionCatalogState {
  agentId: string
  serverIds: Set<string>
  metadata: Record<string, McpToolDisplayMetadata>
  refreshSequence: number
  subscription?: { dispose(): void }
}

@Injectable('ClaudeCodeSessionStateService')
@ServicePhase(Phase.WhenReady)
export class ClaudeCodeSessionStateService extends BaseService {
  private readonly toolApprovalEmitters = new Map<string, ToolApprovalEmitterHolder>()
  private readonly steerHolders = new Map<string, SteerHolder>()
  private readonly toolPolicySnapshots = new Map<string, ToolPolicySnapshot>()
  private readonly mcpSessionCatalogStates = new Map<string, McpSessionCatalogState>()
  private readonly bashOutcomes = new Map<string, BashOutcome[]>()
  private readonly bashRewriteOrigins = new Map<string, Map<string, string>>()

  getToolApprovalEmitterHolder(sessionId: string): ToolApprovalEmitterHolder {
    let holder = this.toolApprovalEmitters.get(sessionId)
    if (!holder) {
      const nextHolder: ToolApprovalEmitterHolder = {
        dispose: () => {
          nextHolder.emit = undefined
          nextHolder.emitInput = undefined
          toolApprovalRegistry.abort(sessionId, 'stream-ended')
          // Evict so the map doesn't grow unbounded across sessions;
          // the holder is rebuilt lazily on the next settings build.
          if (this.toolApprovalEmitters.get(sessionId) === nextHolder) {
            this.toolApprovalEmitters.delete(sessionId)
          }
        }
      }
      holder = nextHolder
      this.toolApprovalEmitters.set(sessionId, holder)
    }
    return holder
  }

  /**
   * Non-creating read of the live approval-emitter holder. A warm-pooled query's baked `canUseTool`
   * resolves the emitter by id at fire-time and must NOT resurrect an evicted holder — `undefined`
   * means no live stream is bound, so the approval is denied.
   */
  peekToolApprovalEmitter(sessionId: string): ToolApprovalEmitterHolder | undefined {
    return this.toolApprovalEmitters.get(sessionId)
  }

  getSteerHolder(sessionId: string): SteerHolder {
    let holder = this.steerHolders.get(sessionId)
    if (!holder) {
      const nextHolder: SteerHolder = {
        pending: [],
        dispose: () => {
          nextHolder.pending = []
          if (this.steerHolders.get(sessionId) === nextHolder) this.steerHolders.delete(sessionId)
        }
      }
      holder = nextHolder
      this.steerHolders.set(sessionId, holder)
    }
    return holder
  }

  async ensureToolPolicySnapshot(
    sessionId: string,
    agent: Parameters<typeof createClaudeAgentToolPolicySnapshot>[0],
    options: Parameters<typeof createClaudeAgentToolPolicySnapshot>[1]
  ): Promise<ToolPolicySnapshot> {
    const existing = this.toolPolicySnapshots.get(sessionId)
    if (existing) {
      // Connect (including a warm-hit) refreshes the shared instance with the current agent so a
      // policy change made between prewarm and connect is honored on the running subprocess.
      await existing.update(agent)
      return existing
    }
    const snapshot = await createClaudeAgentToolPolicySnapshot(agent, options)
    this.toolPolicySnapshots.set(sessionId, snapshot)
    return snapshot
  }

  getToolPolicySnapshot(sessionId: string): ToolPolicySnapshot | undefined {
    return this.toolPolicySnapshots.get(sessionId)
  }

  /**
   * Bash outcome history is scoped per agent within the session: subagent (Task) hook events carry
   * `agent_id`, and a child's repeated calls must not poison the parent's run detection.
   */
  private bashScopeKey(sessionId: string, agentId?: string): string {
    return agentId ? `${sessionId} ${agentId}` : sessionId
  }

  recordBashOutcome(sessionId: string, command: string, output: unknown, failed: boolean, agentId?: string): void {
    const normalized = normalizeBashCommand(command)
    if (!normalized) return
    const key = this.bashScopeKey(sessionId, agentId)
    const history = this.bashOutcomes.get(key) ?? []
    history.push({ command: normalized, fingerprint: fingerprintBashOutput(output, failed) })
    if (history.length > BASH_HISTORY_LIMIT) history.shift()
    this.bashOutcomes.set(key, history)
  }

  getBashNoProgressRun(sessionId: string, command: string, agentId?: string): number | undefined {
    const history = this.bashOutcomes.get(this.bashScopeKey(sessionId, agentId))
    return history ? bashNoProgressRunLength(history, command) : undefined
  }

  /**
   * Ends any trailing no-progress run without recording output: a mutating tool changed the
   * workspace, so an unchanged verifier output afterwards is fresh evidence, not a stuck loop.
   * No-op when the scope has no Bash history — there is no run to break, and scopes that
   * never touch Bash should not grow this map.
   */
  recordBashRunBreak(sessionId: string, agentId?: string): void {
    const history = this.bashOutcomes.get(this.bashScopeKey(sessionId, agentId))
    if (!history?.length) return
    history.push({ command: BASH_RUN_BREAK_MARKER, fingerprint: '' })
    if (history.length > BASH_HISTORY_LIMIT) history.shift()
  }

  /** Drops a subagent's Bash history when the subagent stops; the parent scope is untouched. */
  disposeBashScope(sessionId: string, agentId: string): void {
    this.bashOutcomes.delete(this.bashScopeKey(sessionId, agentId))
  }

  /**
   * An rtk-rewritten Bash call reaches PostToolUse carrying the rewritten command while the guard
   * evaluated the original. Keyed by tool_use_id so the recorder files the outcome under the
   * command the guard will see on the next retry.
   */
  recordBashRewriteOrigin(sessionId: string, toolUseId: string, originalCommand: string): void {
    let origins = this.bashRewriteOrigins.get(sessionId)
    if (!origins) {
      origins = new Map()
      this.bashRewriteOrigins.set(sessionId, origins)
    }
    origins.set(toolUseId, originalCommand)
  }

  takeBashRewriteOrigin(sessionId: string, toolUseId: string): string | undefined {
    const origins = this.bashRewriteOrigins.get(sessionId)
    if (!origins) return undefined
    const original = origins.get(toolUseId)
    origins.delete(toolUseId)
    if (origins.size === 0) this.bashRewriteOrigins.delete(sessionId)
    return original
  }

  disposeToolPolicySnapshot(sessionId: string): void {
    this.toolPolicySnapshots.delete(sessionId)
    // Subagent scopes key as `${sessionId} ${agentId}` — sweep them with the parent.
    for (const key of [...this.bashOutcomes.keys()]) {
      if (key === sessionId || key.startsWith(`${sessionId} `)) this.bashOutcomes.delete(key)
    }
    this.bashRewriteOrigins.delete(sessionId)
    this.mcpSessionCatalogStates.get(sessionId)?.subscription?.dispose()
    this.mcpSessionCatalogStates.delete(sessionId)
  }

  registerMcpSessionCatalogSync(
    sessionId: string,
    agentId: string,
    mcpIds: readonly string[],
    metadata: Record<string, McpToolDisplayMetadata> | undefined
  ): void {
    this.mcpSessionCatalogStates.get(sessionId)?.subscription?.dispose()
    this.mcpSessionCatalogStates.delete(sessionId)
    if (!metadata || mcpIds.length === 0) return

    const serverIds = new Set(
      mcpIds.flatMap((mcpId) => {
        const server = mcpServerService.findByIdOrName(mcpId)
        return server ? [server.id] : []
      })
    )
    if (serverIds.size === 0) return

    const state: McpSessionCatalogState = {
      agentId,
      serverIds,
      metadata,
      refreshSequence: 0
    }
    state.subscription = application.get('McpCatalogService').onToolsCacheUpdated(({ serverId }) => {
      if (!state.serverIds.has(serverId)) return
      void this.refreshMcpSessionCatalogState(sessionId).catch((error) => {
        logger.warn('Failed to refresh live MCP session catalog', { sessionId, serverId, error })
      })
    })
    this.mcpSessionCatalogStates.set(sessionId, state)
  }

  private async refreshMcpSessionCatalogState(sessionId: string): Promise<void> {
    const state = this.mcpSessionCatalogStates.get(sessionId)
    if (!state) return
    const liveAgent = agentService.getAgent(state.agentId)
    if (!liveAgent) return
    const sequence = ++state.refreshSequence

    const [policyResult, metadataResult] = await Promise.allSettled([
      this.getToolPolicySnapshot(sessionId)?.update(liveAgent),
      buildMcpToolMetadata(liveAgent)
    ])
    if (this.mcpSessionCatalogStates.get(sessionId) !== state || sequence !== state.refreshSequence) return

    if (policyResult.status === 'rejected') {
      logger.warn('Failed to refresh MCP tool policy snapshot after catalog update', {
        sessionId,
        error: policyResult.reason
      })
    }
    if (metadataResult.status === 'rejected') {
      logger.warn('Failed to refresh MCP tool metadata after catalog update', {
        sessionId,
        error: metadataResult.reason
      })
      return
    }

    // In-place replace: the stream adapter and the built settings hold this object by reference.
    for (const key of Object.keys(state.metadata)) delete state.metadata[key]
    if (metadataResult.value) Object.assign(state.metadata, metadataResult.value)
  }

  private disposeAllSessionState(): void {
    for (const holder of [...this.toolApprovalEmitters.values()]) holder.dispose?.()
    this.toolApprovalEmitters.clear()
    for (const holder of [...this.steerHolders.values()]) holder.dispose()
    this.steerHolders.clear()
    this.toolPolicySnapshots.clear()
    this.bashOutcomes.clear()
    this.bashRewriteOrigins.clear()
    for (const state of [...this.mcpSessionCatalogStates.values()]) state.subscription?.dispose()
    this.mcpSessionCatalogStates.clear()
  }

  protected onStop(): Promise<void> {
    this.disposeAllSessionState()
    return Promise.resolve()
  }

  protected onDestroy(): Promise<void> {
    this.disposeAllSessionState()
    return Promise.resolve()
  }
}
