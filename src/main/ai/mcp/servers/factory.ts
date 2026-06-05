import { loggerService } from '@logger'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { BuiltinMcpServerName } from '@types'
import { BuiltinMcpServerNames } from '@types'

import BraveSearchServer from './brave-search'
import BrowserServer from './browser'
import DiDiMcpServer from './didi-mcp'
import DifyKnowledgeServer from './dify-knowledge'
import FetchServer from './fetch'
import FileSystemServer from './filesystem'
import { resolveFilesystemBaseDir } from './filesystem/config'
import MemoryServer from './memory'
import PythonServer from './python'
import ThinkingServer from './sequentialthinking'

const logger = loggerService.withContext('MCPFactory')

export function createInMemoryMcpServer(
  name: BuiltinMcpServerName,
  args: string[] = [],
  envs: Record<string, string> = {}
): Server {
  logger.debug(`[MCP] Creating in-memory MCP server: ${name} with args: ${args} and envs: ${JSON.stringify(envs)}`)
  switch (name) {
    case BuiltinMcpServerNames.memory: {
      const envPath = envs.MEMORY_FILE_PATH
      return new MemoryServer(envPath).server
    }
    case BuiltinMcpServerNames.sequentialThinking: {
      return new ThinkingServer().server
    }
    case BuiltinMcpServerNames.braveSearch: {
      return new BraveSearchServer(envs.BRAVE_API_KEY).server
    }
    case BuiltinMcpServerNames.fetch: {
      return new FetchServer().server
    }
    case BuiltinMcpServerNames.filesystem: {
      return new FileSystemServer(resolveFilesystemBaseDir(args, envs)).server
    }
    case BuiltinMcpServerNames.difyKnowledge: {
      const difyKey = envs.DIFY_KEY
      return new DifyKnowledgeServer(difyKey, args).server
    }
    case BuiltinMcpServerNames.python: {
      return new PythonServer().server
    }
    case BuiltinMcpServerNames.didiMcp: {
      const apiKey = envs.DIDI_API_KEY
      return new DiDiMcpServer(apiKey).server
    }
    case BuiltinMcpServerNames.browser: {
      return new BrowserServer().server
    }
    default:
      throw new Error(`Unknown in-memory MCP server: ${name}`)
  }
}
