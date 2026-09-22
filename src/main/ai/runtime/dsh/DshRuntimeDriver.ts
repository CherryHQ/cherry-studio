import path from 'node:path'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { prepareAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import { isAgentSessionForkFailureReason } from '@shared/ai/agentSessionFork'
import { DSH_BUILTIN_TOOLS } from '@shared/ai/dshBuiltinTools'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { AgentSessionForkError, type RuntimeForkInput } from '../fork'
import { listEntries, reclaimStale } from '../orphanSessionReclaim'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentSessionRuntimeDriver,
  OrphanSessionReclaimOptions
} from '../types'
import { buildDshCherryToolName, DSH_AUTO_APPROVED_BRIDGED_TOOLS } from './DshCherryToolBridge'
import { forkDshSession } from './dshFork'
import { DshRuntimeConnection } from './DshRuntimeConnection'
import { parseDshForkCheckpoint } from './forkCheckpoint'
import { assertDshProviderUsable } from './modelInjection'

export class DshRuntimeDriver implements AgentSessionRuntimeDriver {
  private readonly forkSources = new Map<string, DshRuntimeConnection>()

  async fork(input: RuntimeForkInput) {
    input.signal.throwIfAborted()
    parseDshForkCheckpoint(input.checkpoint)
    try {
      await this.forkSources.get(input.sourceSessionId)?.flushForFork(input.signal)
    } catch (error) {
      input.signal.throwIfAborted()
      if (error instanceof AgentSessionForkError) throw error
      const reason =
        error instanceof Error && isAgentSessionForkFailureReason(error.message) ? error.message : 'operation_failed'
      throw new AgentSessionForkError(reason, error instanceof Error ? error.message : reason)
    }
    input.signal.throwIfAborted()
    return forkDshSession(input)
  }
  readonly type = 'dsh'
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new Error(`dsh agent session ${session.id} has no workspace configured`)
    }
    if (!session.agentId) {
      throw new Error(`dsh agent session ${session.id} has no agent`)
    }
    const agent = agentService.getAgent(session.agentId)
    if (!agent?.model) {
      throw new Error(`dsh agent ${session.agentId} has no model configured`)
    }
    await prepareAgentSessionWorkspaceDirectory(session)
    // Side-effect free: dispatch validation must not consume API-key rotation;
    // the concrete key is selected only when the runtime connection starts.
    await assertDshProviderUsable(agent.model)
  }

  async listAvailableTools(mcpIds: string[]): Promise<Tool[]> {
    const builtins: Tool[] = DSH_BUILTIN_TOOLS.map((tool) => ({
      id: tool.name,
      name: tool.name,
      origin: 'builtin',
      approval: tool.approval
    }))
    // Host-bridged MCP tools, read cache-only from the same catalog the session bridge uses.
    const catalog = application.get('McpCatalogService')
    const mcpTools: Tool[] = mcpIds.flatMap((idOrName) => {
      const server = mcpServerService.findByIdOrName(idOrName)
      if (!server) return []
      return catalog.listTools(server.id, { includeDisabled: false }).map((tool) => {
        const id = buildDshCherryToolName(server.name, tool.name)
        return {
          id,
          name: tool.name,
          origin: 'mcp' as const,
          approval: DSH_AUTO_APPROVED_BRIDGED_TOOLS.has(id) ? ('auto' as const) : ('prompt' as const),
          sourceId: server.id,
          sourceName: server.name
        }
      })
    })
    return [...builtins, ...mcpTools]
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    const connection = new DshRuntimeConnection(input, () => {
      if (this.forkSources.get(input.sessionId) === connection) this.forkSources.delete(input.sessionId)
    })
    this.forkSources.set(input.sessionId, connection)
    try {
      await connection.start()
      return connection
    } catch (error) {
      if (this.forkSources.get(input.sessionId) === connection) this.forkSources.delete(input.sessionId)
      throw error
    }
  }

  /**
   * dsh lays sessions out as `{root}/{projectKey(cwd)}/{sessionId}/session.jsonl`.
   * `assertValidDshResumeToken` restricts Cherry's tokens to the charset the
   * backend's `encodeSegment` leaves literal, so the session directory name is
   * the token verbatim.
   *
   * Reclaim whole project directories, never individual sessions: subagent runs
   * get their own session directories under ids Cherry never records, and they
   * share the parent's cwd — so "no claimed session in this project" is the only
   * safe signal that the whole group is dead. (Reading each session's own header
   * is not an option: the backend defaults to zstd-compressed logs.)
   */
  async reclaimOrphanSessions(
    keptResumeTokens: ReadonlySet<string>,
    options: OrphanSessionReclaimOptions
  ): Promise<{ removed: string[] }> {
    const sessionsRoot = application.getPath('feature.agents.dsh.sessions')
    const removed: string[] = []

    for (const projectEntry of await listEntries(sessionsRoot)) {
      if (!projectEntry.isDirectory()) continue
      const projectDir = path.resolve(sessionsRoot, projectEntry.name)
      const sessionDirs = (await listEntries(projectDir)).filter((entry) => entry.isDirectory())
      if (sessionDirs.length === 0) continue
      if (sessionDirs.some((entry) => keptResumeTokens.has(entry.name))) continue
      if (await reclaimStale(projectDir, options)) removed.push(projectDir)
    }

    return { removed }
  }
}
