import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { loggerService } from '@logger'
import { DOCTOR_TOOLS, type DoctorToolContext } from '@main/ai/agents/doctor/doctorTools'

import { createNeutralToolMcpServer } from './neutralToolMcpServer'

const logger = loggerService.withContext('DoctorServer')

/** In-process MCP server mounted only for the doctor built-in Agent; see `agents/doctor/doctorTools`. */
class DoctorServer {
  public mcpServer: McpServer

  constructor(sessionId: string) {
    const context: DoctorToolContext = { sessionId }
    this.mcpServer = createNeutralToolMcpServer(
      { name: 'doctor', version: '1.0.0' },
      [...DOCTOR_TOOLS],
      context,
      logger
    )
  }
}

export default DoctorServer
