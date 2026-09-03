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

  recordBashOutcome(sessionId: string, command: string, output: unknown, failed: boolean): void {
    const normalized = normalizeBashCommand(command)
    if (!normalized) return
    const history = this.bashOutcomes.get(sessionId) ?? []
    history.push({ command: normalized, fingerprint: fingerprintBashOutput(output, failed) })
    if (history.length > BASH_HISTORY_LIMIT) history.shift()
    this.bashOutcomes.set(sessionId, history)
  }

  getBashNoProgressRun(sessionId: string, command: string): number | undefined {
    const history = this.bashOutcomes.get(sessionId)
    return history ? bashNoProgressRunLength(history, command) : undefined
  }

  disposeToolPolicySnapshot(sessionId: string): void {
    this.toolPolicySnapshots.delete(sessionId)
    this.bashOutcomes.delete(sessionId)
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
