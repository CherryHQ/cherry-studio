import { loggerService } from '@logger'
import { memoryTool, type MemoryToolContext } from '@main/ai/agents/tools/memoryTools'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { createNeutralToolMcpServer } from './neutralToolMcpServer'

const logger = loggerService.withContext('McpServer:WorkspaceMemory')

/**
 * Claude SDK MCP server exposing the cross-session workspace-memory tool. A thin
 * wrapper over the runtime-neutral definition in
 * `@main/ai/agents/tools/memoryTools`; the pi runtime consumes the same
 * definition via its own adapter.
 *
 * Distinct from the built-in `memory.ts` knowledge-graph server, which is a
 * user-opt-in MCP that stores entity/relation graphs in a global JSON file
 * rather than in the agent's workspace.
 */
class WorkspaceMemoryServer {
  public mcpServer: McpServer

  constructor(agentId: string, workspacePath: string) {
    const ctx: MemoryToolContext = { agentId, workspacePath }
    this.mcpServer = createNeutralToolMcpServer({ name: 'agent-memory', version: '1.0.0' }, [memoryTool], ctx, logger)
  }
}

export default WorkspaceMemoryServer
