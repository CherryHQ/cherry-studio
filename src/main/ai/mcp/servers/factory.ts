import type { McpServer as McpProtocolServer } from '@modelcontextprotocol/server'

import { application } from '@application'
import { loggerService } from '@logger'
import type { McpServer } from '@shared/data/types/mcpServer'
import { type BuiltinMcpServerName, BuiltinMcpServerNames, isBuiltinMcpServerName } from '@shared/utils/mcp'

const logger = loggerService.withContext('McpFactory')

export interface BuiltinMcpEndpoint {
  createServer(): McpProtocolServer
  close(): Promise<void>
}

const statelessEndpoint = (createServer: () => McpProtocolServer): BuiltinMcpEndpoint => ({
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
    case BuiltinMcpServerNames.zonefoundry: {
      const apiKey = server.env?.ZONEFOUNDRY_API_KEY?.trim()
      return {
        ...server,
        type: 'streamableHttp',
        headers: apiKey ? { ...server.headers, Authorization: `Bearer ${apiKey}` } : { ...server.headers }
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
    case BuiltinMcpServerNames.memory:
      return (await import('./memory')).createMemoryEndpoint(envs.MEMORY_FILE_PATH)
    case BuiltinMcpServerNames.sequentialThinking:
      return (await import('./sequentialthinking')).createSequentialThinkingEndpoint()
    case BuiltinMcpServerNames.braveSearch: {
      const { createBraveSearchServer } = await import('./braveSearch')
      return statelessEndpoint(() => createBraveSearchServer(envs.BRAVE_API_KEY))
    }
    case BuiltinMcpServerNames.fetch: {
      const { createFetchServer } = await import('./fetch')
      return statelessEndpoint(createFetchServer)
    }
    case BuiltinMcpServerNames.filesystem: {
      const { createFileSystemServer, resolveFilesystemBaseDir } = await import('./filesystem')
      return statelessEndpoint(() => createFileSystemServer(resolveFilesystemBaseDir(args, envs)))
    }
    case BuiltinMcpServerNames.difyKnowledge: {
      const { createDifyKnowledgeServer } = await import('./difyKnowledge')
      return statelessEndpoint(() => createDifyKnowledgeServer(envs.DIFY_KEY, args))
    }
    case BuiltinMcpServerNames.python: {
      const { createPythonServer } = await import('./python')
      return statelessEndpoint(createPythonServer)
    }
    case BuiltinMcpServerNames.didiMcp: {
      const { createDiDiMcpServer } = await import('./didiMcp')
      return statelessEndpoint(() => createDiDiMcpServer(envs.DIDI_API_KEY))
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
