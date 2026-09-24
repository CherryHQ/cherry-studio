import type { Server } from '@modelcontextprotocol/server'

import { application } from '@application'
import { loggerService } from '@logger'
import type { McpServer } from '@shared/data/types/mcpServer'
import { type BuiltinMcpServerName, BuiltinMcpServerNames, isBuiltinMcpServerName } from '@shared/utils/mcp'

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
  if (server.installSource !== 'builtin' || !isBuiltinMcpServerName(server.name)) return server

  switch (server.name) {
    case BuiltinMcpServerNames.nowledgeMem:
      return {
        ...server,
        type: 'streamableHttp',
        baseUrl: 'http://127.0.0.1:14242/mcp',
        headers: { ...server.headers, APP: 'Cherry Studio' }
      }
    case BuiltinMcpServerNames.flomo:
      return {
        ...server,
        type: 'streamableHttp',
        baseUrl: 'https://flomoapp.com/mcp',
        headers: { ...server.headers, APP: 'Cherry Studio' }
      }
    case BuiltinMcpServerNames.qveris: {
      const apiKey = server.env?.QVERIS_API_KEY?.trim()
      if (!apiKey) throw new Error('QVeris MCP requires the QVERIS_API_KEY environment variable')
      return {
        ...server,
        type: 'streamableHttp',
        headers: { ...server.headers, Authorization: `Bearer ${apiKey}` }
      }
    }
    default:
      return server
  }
}

export async function createBuiltinMcpEndpoint(
  name: BuiltinMcpServerName,
  args: string[] = [],
  envs: Record<string, string> = {}
): Promise<BuiltinMcpEndpoint> {
  logger.debug(`[MCP] Creating builtin MCP endpoint: ${name}`, { args, envNames: Object.keys(envs) })
  switch (name) {
    case BuiltinMcpServerNames.memory: {
      const { default: MemoryServer } = await import('./memory')
      const envPath = envs.MEMORY_FILE_PATH
      const server = new MemoryServer(envPath)
      return {
        createServer: () => server.createServer(),
        close: async () => undefined
      }
    }
    case BuiltinMcpServerNames.sequentialThinking: {
      const { default: ThinkingServer } = await import('./sequentialthinking')
      const server = new ThinkingServer()
      return {
        createServer: () => server.createServer(),
        close: async () => server.close()
      }
    }
    case BuiltinMcpServerNames.braveSearch: {
      const { default: BraveSearchServer } = await import('./braveSearch')
      return statelessEndpoint(() => new BraveSearchServer(envs.BRAVE_API_KEY).server)
    }
    case BuiltinMcpServerNames.fetch: {
      const { default: FetchServer } = await import('./fetch')
      const server = new FetchServer()
      return statelessEndpoint(() => server.createServer())
    }
    case BuiltinMcpServerNames.filesystem: {
      const { FileSystemServer, resolveFilesystemBaseDir } = await import('./filesystem')
      return statelessEndpoint(() => new FileSystemServer(resolveFilesystemBaseDir(args, envs)).server)
    }
    case BuiltinMcpServerNames.difyKnowledge: {
      const { default: DifyKnowledgeServer } = await import('./difyKnowledge')
      const difyKey = envs.DIFY_KEY
      return statelessEndpoint(() => new DifyKnowledgeServer(difyKey, args).server)
    }
    case BuiltinMcpServerNames.python: {
      const { default: PythonServer } = await import('./python')
      return statelessEndpoint(() => new PythonServer().server)
    }
    case BuiltinMcpServerNames.didiMcp: {
      const { default: DiDiMcpServer } = await import('./didiMcp')
      const apiKey = envs.DIDI_API_KEY
      return statelessEndpoint(() => new DiDiMcpServer(apiKey).server)
    }
    case BuiltinMcpServerNames.browser: {
      return application.get('BrowserSessionService').createMcpEndpoint()
    }
    default:
      throw new Error(`Unknown in-memory MCP server: ${name}`)
  }
}

/**
 * Env that keeps `@cherry/mcp-auto-install` inside the Cherry tree: its Registry cache, and the
 * config file it writes to so a missed `dryRun` never lands in the user's other MCP clients.
 */
export function getBuiltinAutoInstallEnv(server: McpServer): Record<string, string> {
  if (server.installSource !== 'builtin' || server.name !== BuiltinMcpServerNames.mcpAutoInstall) {
    return {}
  }
  return {
    MCP_REGISTRY_PATH: application.getPath('feature.mcp.registry_file'),
    MCP_SETTINGS_PATH: application.getPath('feature.mcp.auto_install_settings_file')
  }
}

export function hasInMemoryImplementation(name: string): boolean {
  return [
    BuiltinMcpServerNames.memory,
    BuiltinMcpServerNames.sequentialThinking,
    BuiltinMcpServerNames.braveSearch,
    BuiltinMcpServerNames.fetch,
    BuiltinMcpServerNames.filesystem,
    BuiltinMcpServerNames.difyKnowledge,
    BuiltinMcpServerNames.python,
    BuiltinMcpServerNames.didiMcp,
    BuiltinMcpServerNames.browser
  ].some((builtin) => builtin === name)
}
