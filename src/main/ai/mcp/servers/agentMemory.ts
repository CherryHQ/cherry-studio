import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { loggerService } from '@logger'
import { memoryTool, type MemoryToolContext } from '@main/ai/agents/tools/memoryTools'

import { createNeutralToolMcpServer } from './neutralToolMcpServer'

const logger = loggerService.withContext('McpServer:AgentMemory')

/** Claude SDK wrapper for the runtime-neutral, agent-data-backed memory tool. */
class AgentMemoryServer {
  public mcpServer: McpServer

  constructor(agentId: string, agentDataPath: string) {
    const context: MemoryToolContext = { agentId, agentDataPath }
    this.mcpServer = createNeutralToolMcpServer(
      { name: 'agent-memory', version: '1.0.0' },
      [memoryTool],
      context,
      logger
    )
  }
}

export default AgentMemoryServer
