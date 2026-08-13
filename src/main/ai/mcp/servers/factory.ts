import { loggerService } from '@logger'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { type BuiltinMcpServerName, BuiltinMcpServerNames } from '@shared/utils/mcp'

const logger = loggerService.withContext('McpFactory')

export async function createInMemoryMcpServer(
  name: BuiltinMcpServerName,
  args: string[] = [],
  envs: Record<string, string> = {}
): Promise<Server> {
  logger.debug(`[MCP] Creating in-memory MCP server: ${name} with args: ${args} and envs: ${JSON.stringify(envs)}`)
  switch (name) {
    case BuiltinMcpServerNames.memory: {
      const { default: MemoryServer } = await import('./memory')
      const envPath = envs.MEMORY_FILE_PATH
      return new MemoryServer(envPath).server
    }
    case BuiltinMcpServerNames.sequentialThinking: {
      const { default: ThinkingServer } = await import('./sequentialthinking')
      return new ThinkingServer().server
    }
    case BuiltinMcpServerNames.braveSearch: {
      const { default: BraveSearchServer } = await import('./braveSearch')
      return new BraveSearchServer(envs.BRAVE_API_KEY).server
    }
    case BuiltinMcpServerNames.fetch: {
      const { default: FetchServer } = await import('./fetch')
      return new FetchServer().server
    }
    case BuiltinMcpServerNames.filesystem: {
      const { FileSystemServer, resolveFilesystemBaseDir } = await import('./filesystem')
      return new FileSystemServer(resolveFilesystemBaseDir(args, envs)).server
    }
    case BuiltinMcpServerNames.difyKnowledge: {
      const { default: DifyKnowledgeServer } = await import('./difyKnowledge')
      const difyKey = envs.DIFY_KEY
      return new DifyKnowledgeServer(difyKey, args).server
    }
    case BuiltinMcpServerNames.python: {
      const { default: PythonServer } = await import('./python')
      return new PythonServer().server
    }
    case BuiltinMcpServerNames.didiMcp: {
      const { default: DiDiMcpServer } = await import('./didiMcp')
      const apiKey = envs.DIDI_API_KEY
      return new DiDiMcpServer(apiKey).server
    }
    case BuiltinMcpServerNames.browser: {
      const { BrowserServer } = await import('./browser')
      return new BrowserServer().server
    }
    default:
      throw new Error(`Unknown in-memory MCP server: ${name}`)
  }
}
