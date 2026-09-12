import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

import { application } from '@application'
import { loggerService } from '@logger'
import type { McpServer } from '@shared/data/types/mcpServer'
import { type BuiltinMcpServerName, BuiltinMcpServerNames } from '@shared/utils/mcp'
import { redactRecord } from '@shared/utils/redaction'

const logger = loggerService.withContext('McpFactory')

type InMemoryServerLoader = (args: string[], envs: Record<string, string>) => Promise<Server>

const inMemoryServers: Partial<Record<BuiltinMcpServerName, InMemoryServerLoader>> = {
  [BuiltinMcpServerNames.memory]: async (_args, envs) => {
    const { default: MemoryServer } = await import('./memory')
    return new MemoryServer(envs.MEMORY_FILE_PATH).server
  },
  [BuiltinMcpServerNames.sequentialThinking]: async () => {
    const { default: ThinkingServer } = await import('./sequentialthinking')
    return new ThinkingServer().server
  },
  [BuiltinMcpServerNames.braveSearch]: async (_args, envs) => {
    const { default: BraveSearchServer } = await import('./braveSearch')
    return new BraveSearchServer(envs.BRAVE_API_KEY).server
  },
  [BuiltinMcpServerNames.fetch]: async () => {
    const { default: FetchServer } = await import('./fetch')
    return new FetchServer().server
  },
  [BuiltinMcpServerNames.filesystem]: async (args, envs) => {
    const { FileSystemServer, resolveFilesystemBaseDir } = await import('./filesystem')
    return new FileSystemServer(resolveFilesystemBaseDir(args, envs)).server
  },
  [BuiltinMcpServerNames.difyKnowledge]: async (args, envs) => {
    const { default: DifyKnowledgeServer } = await import('./difyKnowledge')
    return new DifyKnowledgeServer(envs.DIFY_KEY, args).server
  },
  [BuiltinMcpServerNames.python]: async () => {
    const { default: PythonServer } = await import('./python')
    return new PythonServer().server
  },
  [BuiltinMcpServerNames.didiMcp]: async (_args, envs) => {
    const { default: DiDiMcpServer } = await import('./didiMcp')
    return new DiDiMcpServer(envs.DIDI_API_KEY).server
  },
  [BuiltinMcpServerNames.browser]: async () => {
    const { BrowserServer } = await import('./browser')
    return new BrowserServer().server
  }
}

/** Whether this name has an in-process implementation; anything else must connect for itself. */
export function hasInMemoryImplementation(name: string): boolean {
  return name in inMemoryServers
}

export async function createInMemoryMcpServer(
  name: string,
  args: string[] = [],
  envs: Record<string, string> = {}
): Promise<Server> {
  logger.debug(
    `[MCP] Creating in-memory MCP server: ${name} with args: ${args} and envs: ${JSON.stringify(redactRecord(envs))}`
  )
  const create = inMemoryServers[name as BuiltinMcpServerName]
  if (!create) {
    throw new Error(`Unknown in-memory MCP server: ${name}`)
  }
  return create(args, envs)
}

/**
 * Headers a builtin HTTP server derives from its own config: QVeris authenticates with the
 * API key the user configures as an env var, so it cannot be stored as a static header.
 */
export function getBuiltinHttpHeaders(server: McpServer): Record<string, string> {
  if (server.installSource !== 'builtin' || server.name !== BuiltinMcpServerNames.qveris) return {}

  const apiKey = server.env?.QVERIS_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('QVeris MCP requires the QVERIS_API_KEY environment variable')
  }
  return { Authorization: `Bearer ${apiKey}` }
}

/**
 * Extra env for servers that resolve packages from a custom registry: `@cherry/mcp-auto-install`
 * reads its catalog from a file whose location only exists at runtime.
 */
export function getBuiltinRegistryEnv(server: McpServer): Record<string, string> {
  if (
    server.installSource !== 'builtin' ||
    server.name !== BuiltinMcpServerNames.mcpAutoInstall ||
    !server.registryUrl
  ) {
    return {}
  }
  return { MCP_REGISTRY_PATH: application.getPath('feature.mcp.registry_file') }
}
