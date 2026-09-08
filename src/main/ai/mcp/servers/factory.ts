import { loggerService } from '@logger'
import type { Server } from '@modelcontextprotocol/server'
import type { McpServer } from '@shared/data/types/mcpServer'
import { type BuiltinMcpServerName, BuiltinMcpServerNames } from '@shared/utils/mcp'

import BraveSearchServer from './braveSearch'
import { BrowserServer } from './browser'
import DiDiMcpServer from './didiMcp'
import DifyKnowledgeServer from './difyKnowledge'
import FetchServer from './fetch'
import { FileSystemServer, resolveFilesystemBaseDir } from './filesystem'
import MemoryServer from './memory'
import PythonServer from './python'
import ThinkingServer from './sequentialthinking'

const logger = loggerService.withContext('McpFactory')

export interface BuiltinMcpEndpoint {
  createServer(): Server
  close(): Promise<void>
}

const statelessEndpoint = (createServer: () => Server): BuiltinMcpEndpoint => ({
  createServer,
  close: async () => undefined
})

export function resolveBuiltinExternalMcpServer(server: McpServer): McpServer {
  if (server.name !== BuiltinMcpServerNames.qveris) return server

  const apiKey = server.env?.QVERIS_API_KEY?.trim()
  if (!apiKey) throw new Error('QVeris MCP requires the QVERIS_API_KEY environment variable')
  return {
    ...server,
    headers: { ...server.headers, Authorization: `Bearer ${apiKey}` }
  }
}

export function createBuiltinMcpEndpoint(
  name: BuiltinMcpServerName,
  args: string[] = [],
  envs: Record<string, string> = {}
): BuiltinMcpEndpoint {
  logger.debug(`[MCP] Creating builtin MCP endpoint: ${name}`, { args, envNames: Object.keys(envs) })
  switch (name) {
    case BuiltinMcpServerNames.memory: {
      const envPath = envs.MEMORY_FILE_PATH
      const server = new MemoryServer(envPath)
      return {
        createServer: () => server.createServer(),
        close: async () => undefined
      }
    }
    case BuiltinMcpServerNames.sequentialThinking: {
      const server = new ThinkingServer()
      return {
        createServer: () => server.createServer(),
        close: async () => undefined
      }
    }
    case BuiltinMcpServerNames.braveSearch: {
      return statelessEndpoint(() => new BraveSearchServer(envs.BRAVE_API_KEY).server)
    }
    case BuiltinMcpServerNames.fetch: {
      const server = new FetchServer()
      return statelessEndpoint(() => server.createServer())
    }
    case BuiltinMcpServerNames.filesystem: {
      return statelessEndpoint(() => new FileSystemServer(resolveFilesystemBaseDir(args, envs)).server)
    }
    case BuiltinMcpServerNames.difyKnowledge: {
      const difyKey = envs.DIFY_KEY
      return statelessEndpoint(() => new DifyKnowledgeServer(difyKey, args).server)
    }
    case BuiltinMcpServerNames.python: {
      return statelessEndpoint(() => new PythonServer().server)
    }
    case BuiltinMcpServerNames.didiMcp: {
      const apiKey = envs.DIDI_API_KEY
      return statelessEndpoint(() => new DiDiMcpServer(apiKey).server)
    }
    case BuiltinMcpServerNames.browser: {
      const server = new BrowserServer()
      return {
        createServer: () => server.createServer(),
        close: () => server.close()
      }
    }
    default:
      throw new Error(`Unknown in-process MCP server: ${name}`)
  }
}
