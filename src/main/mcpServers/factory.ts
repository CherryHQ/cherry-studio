import { loggerService } from '@logger'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { BuiltinMCPServerName, MCPServer } from '@types'
import { BuiltinMCPServerNames } from '@types'

import BraveSearchServer from './brave-search'
import BrowserServer from './browser'
import DiDiMcpServer from './didi-mcp'
import DifyKnowledgeServer from './dify-knowledge'
import FetchServer from './fetch'
import FileSystemServer from './filesystem'
import HubServer from './hub'
import MemoryServer from './memory'
import PythonServer from './python'
import ThinkingServer from './sequentialthinking'

const logger = loggerService.withContext('MCPFactory')

interface HubServerDependencies {
  mcpService: {
    listTools(_: null, server: MCPServer): Promise<unknown[]>
    callTool(
      _: null,
      args: { server: MCPServer; name: string; args: unknown; callId?: string }
    ): Promise<{ content: Array<{ type: string; text?: string }> }>
  }
  mcpServersGetter: () => MCPServer[]
}

let hubServerDependencies: HubServerDependencies | null = null

export function setHubServerDependencies(deps: HubServerDependencies): void {
  hubServerDependencies = deps
}

export function createInMemoryMCPServer(
  name: BuiltinMCPServerName,
  args: string[] = [],
  envs: Record<string, string> = {}
): Server {
  logger.debug(`[MCP] Creating in-memory MCP server: ${name} with args: ${args} and envs: ${JSON.stringify(envs)}`)
  switch (name) {
    case BuiltinMCPServerNames.memory: {
      const envPath = envs.MEMORY_FILE_PATH
      return new MemoryServer(envPath).server
    }
    case BuiltinMCPServerNames.sequentialThinking: {
      return new ThinkingServer().server
    }
    case BuiltinMCPServerNames.braveSearch: {
      return new BraveSearchServer(envs.BRAVE_API_KEY).server
    }
    case BuiltinMCPServerNames.fetch: {
      return new FetchServer().server
    }
    case BuiltinMCPServerNames.filesystem: {
      return new FileSystemServer(envs.WORKSPACE_ROOT).server
    }
    case BuiltinMCPServerNames.difyKnowledge: {
      const difyKey = envs.DIFY_KEY
      return new DifyKnowledgeServer(difyKey, args).server
    }
    case BuiltinMCPServerNames.python: {
      return new PythonServer().server
    }
    case BuiltinMCPServerNames.didiMCP: {
      const apiKey = envs.DIDI_API_KEY
      return new DiDiMcpServer(apiKey).server
    }
    case BuiltinMCPServerNames.browser: {
      return new BrowserServer().server
    }
    case BuiltinMCPServerNames.hub: {
      if (!hubServerDependencies) {
        throw new Error('Hub server dependencies not set. Call setHubServerDependencies first.')
      }
      return new HubServer(hubServerDependencies.mcpService, hubServerDependencies.mcpServersGetter).server
    }
    default:
      throw new Error(`Unknown in-memory MCP server: ${name}`)
  }
}
