import type { McpSdkServerConfigWithInstance, McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { BuiltinMCPServerNames, type MCPServer } from '@types'

type AgentMcpApiConfig = {
  host: string
  port: string | number
  apiKey: string
}

type BuildAgentMcpServerConfigOptions = {
  mcpIds: string[]
  cwd: string
  apiConfig: AgentMcpApiConfig
  getServerById: (id: string) => Promise<Pick<MCPServer, 'id' | 'name'> | null>
  createFilesystemServer: (cwd: string) => McpSdkServerConfigWithInstance['instance']
}

export async function buildAgentMcpServerConfig({
  mcpIds,
  cwd,
  apiConfig,
  getServerById,
  createFilesystemServer
}: BuildAgentMcpServerConfigOptions): Promise<{
  mcpServers: Record<string, McpServerConfig>
  strictMcpConfig: boolean
}> {
  const mcpServers: Record<string, McpServerConfig> = {}

  for (const mcpId of mcpIds) {
    const server = await getServerById(mcpId)

    if (server?.name === BuiltinMCPServerNames.filesystem) {
      mcpServers[mcpId] = {
        type: 'sdk',
        name: mcpId,
        instance: createFilesystemServer(cwd)
      }
      continue
    }

    mcpServers[mcpId] = {
      type: 'http',
      url: `http://${apiConfig.host}:${apiConfig.port}/v1/mcps/${mcpId}/mcp`,
      headers: {
        Authorization: `Bearer ${apiConfig.apiKey}`
      }
    }
  }

  return {
    mcpServers,
    strictMcpConfig: mcpIds.length > 0
  }
}
