import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { prepareAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import { isAgentSessionForkUnavailableReason } from '@shared/ai/agentSessionFork'
import { DSH_BUILTIN_TOOLS } from '@shared/ai/dshBuiltinTools'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { AgentSessionForkError, type RuntimeForkInput } from '../forkCheckpoint'
import type { AgentRuntimeConnectInput, AgentRuntimeConnection, AgentSessionRuntimeDriver } from '../types'
import { buildDshCherryToolName, DSH_AUTO_APPROVED_BRIDGED_TOOLS } from './DshCherryToolBridge'
import { forkDshSession } from './dshFork'
import { DshRuntimeConnection } from './DshRuntimeConnection'
import { assertDshProviderUsable } from './modelInjection'

export class DshRuntimeDriver implements AgentSessionRuntimeDriver {
  private readonly forkSources = new Map<string, DshRuntimeConnection>()

  async fork(input: RuntimeForkInput) {
    let events: unknown[] | undefined
    try {
      if (input.checkpoint.runtime === 'dsh')
        events = await this.forkSources.get(input.sourceSessionId)?.snapshotForFork(input.checkpoint.boundary)
    } catch (error) {
      input.signal.throwIfAborted()
      if (error instanceof AgentSessionForkError) throw error
      const reason =
        error instanceof Error && isAgentSessionForkUnavailableReason(error.message)
          ? error.message
          : 'checkpoint_failed'
      throw new AgentSessionForkError(reason, error instanceof Error ? error.message : reason)
    }
    input.signal.throwIfAborted()
    return forkDshSession(input, events)
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
}
