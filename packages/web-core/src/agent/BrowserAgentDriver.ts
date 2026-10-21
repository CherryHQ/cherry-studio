import { agentService } from '@data/services/AgentService'
import { prepareAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentSessionRuntimeDriver
} from '@main/ai/runtime/types'
import { PI_BUILTIN_TOOLS } from '@shared/ai/piBuiltinTools'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { BrowserAgentConnection } from './BrowserAgentConnection'

/** The browser tools (the Web `piBuiltinTools.ts`) as the agent editor lists them. */
const BROWSER_TOOLS: Tool[] = PI_BUILTIN_TOOLS.map(({ name, approval }) => ({
  id: name,
  name,
  origin: 'builtin',
  approval
}))

/**
 * The Web edition's agent runtime. It registers as `pi`, the type new agents default to, so the
 * agent UI, permission modes and tool cards work unchanged and agent rows match the desktop's.
 * It has no resume token, steering, compaction or fork; the host queues follow-ups as next turns.
 */
export class BrowserAgentDriver implements AgentSessionRuntimeDriver {
  readonly type = 'pi'
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
    if (!session.agentId) throw new Error(`Agent session ${session.id} has no agent`)
    if (!agentService.getAgent(session.agentId)?.model) {
      throw new Error(`Agent ${session.agentId} has no model configured`)
    }
    await prepareAgentSessionWorkspaceDirectory(session)
  }

  async listAvailableTools(): Promise<Tool[]> {
    return BROWSER_TOOLS
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    return new BrowserAgentConnection(input)
  }
}
