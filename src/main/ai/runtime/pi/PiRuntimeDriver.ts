import path from 'node:path'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { prepareAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import { PI_BUILTIN_TOOLS } from '@shared/ai/piBuiltinTools'
import type { Tool } from '@shared/ai/tool'
import { buildFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { listEntries, reclaimStale } from '../orphanSessionReclaim'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentSessionRuntimeDriver,
  OrphanSessionReclaimOptions
} from '../types'
import { assertPiProviderUsable } from './modelInjection'
import { PiRuntimeConnection } from './PiRuntimeConnection'

export class PiRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'pi'
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new Error(`pi agent session ${session.id} has no workspace configured`)
    }
    if (!session.agentId) {
      throw new Error(`pi agent session ${session.id} has no agent`)
    }
    const agent = agentService.getAgent(session.agentId)
    if (!agent?.model) {
      throw new Error(`pi agent ${session.agentId} has no model configured`)
    }
    await prepareAgentSessionWorkspaceDirectory(session)
    // Side-effect free: dispatch validation must not consume API-key rotation;
    // the concrete key is selected only when the runtime connection starts.
    await assertPiProviderUsable(agent.model)
  }

  async listAvailableTools(mcpIds: string[]): Promise<Tool[]> {
    const builtins: Tool[] = PI_BUILTIN_TOOLS.map((tool) => ({
      id: tool.name,
      name: tool.name,
      origin: 'builtin',
      approval: tool.approval
    }))
    // Bridged MCP tools, read cache-only from the same catalog the session bridge uses
    // (piMcpToolAdapter warms it). Third-party, so they prompt in the default mode.
    const catalog = application.get('McpCatalogService')
    const mcpTools: Tool[] = mcpIds.flatMap((idOrName) => {
      const server = mcpServerService.findByIdOrName(idOrName)
      if (!server) return []
      return catalog.listTools(server.id, { includeDisabled: false }).map((tool) => ({
        id: buildFunctionCallToolName(server.name, tool.name),
        name: tool.name,
        origin: 'mcp' as const,
        approval: 'prompt' as const,
        sourceId: server.id,
        sourceName: server.name
      }))
    })
    return [...builtins, ...mcpTools]
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    return new PiRuntimeConnection(input).start()
  }

  /**
   * pi keeps one flat `{timestamp}_{resumeToken}.jsonl` per session generation
   * (see `resolveResumeTokenSessionFile`), so the token is the stem after the
   * FIRST `_` — the timestamp pi owns has none, but a token legally can. Every
   * generation of a claimed token is kept — the connection resumes from the newest.
   */
  async reclaimOrphanSessions(
    keptResumeTokens: ReadonlySet<string>,
    options: OrphanSessionReclaimOptions
  ): Promise<{ removed: string[] }> {
    const sessionDir = application.getPath('feature.agents.pi.sessions')
    const removed: string[] = []

    for (const entry of await listEntries(sessionDir)) {
      if (!entry.isFile()) continue
      const token = piResumeTokenOf(entry.name)
      if (!token || keptResumeTokens.has(token)) continue
      const target = path.resolve(sessionDir, entry.name)
      if (await reclaimStale(target, options)) removed.push(target)
    }

    return { removed }
  }
}

/**
 * `{timestamp}_{resumeToken}.jsonl` → the token, or null when the name is not pi's.
 * Splits on the FIRST `_`: pi's timestamp prefix is dash-only, but `_` is a legal
 * token character, so splitting on the last one truncates the token and would
 * make a still-claimed session look orphaned.
 */
function piResumeTokenOf(fileName: string): string | null {
  if (!fileName.endsWith('.jsonl')) return null
  const stem = fileName.slice(0, -'.jsonl'.length)
  const separator = stem.indexOf('_')
  if (separator < 0) return null
  const token = stem.slice(separator + 1)
  return token.length > 0 ? token : null
}
