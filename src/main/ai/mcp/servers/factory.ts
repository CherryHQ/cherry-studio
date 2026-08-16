import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { getBinaryPath } from '@main/utils/binaryResolver'
import { sanitizeEnvForLogging } from '@main/utils/envRedaction'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { McpServer } from '@shared/data/types/mcpServer'
import { type BuiltinMcpServerName, BuiltinMcpServerNames } from '@shared/utils/mcp'

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

export async function createInMemoryMcpServer(
  name: string,
  args: string[] = [],
  envs: Record<string, string> = {}
): Promise<Server> {
  logger.debug(
    `[MCP] Creating in-memory MCP server: ${name} with args: ${args} and envs: ${JSON.stringify(sanitizeEnvForLogging(envs))}`
  )
  const create = inMemoryServers[name as BuiltinMcpServerName]
  if (!create) {
    throw new Error(`Unknown in-memory MCP server: ${name}`)
  }
  return create(args, envs)
}

/**
 * Extra env for servers that resolve packages from a custom registry: `@cherry/mcp-auto-install`
 * reads its registry file from the app's bin directory, which only exists at runtime.
 */
export async function getBuiltinRegistryEnv(server: McpServer): Promise<Record<string, string>> {
  if (!server.registryUrl || !server.name.includes('mcp-auto-install')) return {}
  const binPath = await getBinaryPath()
  await fs.mkdir(binPath, { recursive: true })
  return { MCP_REGISTRY_PATH: path.join(binPath, '..', 'config', 'mcp-registry.json') }
}
