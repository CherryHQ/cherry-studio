import { loggerService } from '@logger'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { BuiltinMCPServerName, BuiltinMCPServerNames } from '@types'

import BraveSearchServer from './brave-search'
import DifyKnowledgeServer from './dify-knowledge'
import FetchServer from './fetch'
import FileSystemServer from './filesystem'
import MemoryServer from './memory'
import PythonServer from './python'
import ThinkingServer from './sequentialthinking'

const logger = loggerService.withContext('MCPFactory')

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
      return new FileSystemServer(args).server
    }
    case BuiltinMCPServerNames.difyKnowledge: {
      const difyKey = envs.DIFY_KEY
      return new DifyKnowledgeServer(difyKey, args).server
    }
    case BuiltinMCPServerNames.python: {
      return new PythonServer().server
    }
    default:
      throw new Error(`Unknown in-memory MCP server: ${name}`)
  }
}
