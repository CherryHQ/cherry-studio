import { createHash } from 'node:crypto'

import type { ExtensionFactory, McpTransportFactory } from '@earendil-works/pi-coding-agent'
import { InMemoryTransport } from '@modelcontextprotocol/client'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { MCP_FORWARDING_TIMEOUT_MS } from '@main/ai/mcp/mcpRequestOptions'
import type { AgentMcpServer } from '@main/ai/runtime/agentMcpServer'

import type { loadPiSdk } from './piSdk'

const logger = loggerService.withContext('PiMcpExtension')

/** Match Pi's native MCP identifiers for policy and stored disabled-tool lookups. */
export function buildPiMcpToolName(serverName: string, toolName: string, collides = false): string {
  const name = `mcp__${serverName}__${toolName}`.replace(/[^A-Za-z0-9_]/g, '_')
  if (name.length <= 64 && !collides) return name
  const hash = createHash('sha256').update(`${serverName}\0${toolName}`).digest('hex').slice(0, 8)
  return `${name.slice(0, 55)}_${hash}`
}

export async function warmMcpToolCatalogs(mcpIds: readonly string[]): Promise<void> {
  const catalog = application.get('McpCatalogService')
  const serverIds = new Set<string>()
  for (const idOrName of mcpIds) {
    const server = mcpServerService.findByIdOrName(idOrName)
    if (!server) {
      logger.warn('Skipping unresolvable MCP server referenced by agent', { idOrName })
      continue
    }
    serverIds.add(server.id)
  }
  await Promise.allSettled([...serverIds].map((serverId) => catalog.refreshTools(serverId)))
}

/** Cherry owns server configuration; Pi owns MCP discovery, tool execution, results and teardown. */
export function createPiMcpExtension(
  pi: Awaited<ReturnType<typeof loadPiSdk>>,
  servers: Record<string, AgentMcpServer>,
  logPath: string
): ExtensionFactory {
  // UUID namespaces prevent display-name collisions and keep stored tool policies stable on rename.
  const runtimeServers = new Map(Object.values(servers).map((server) => [server.id ?? server.name, server]))
  return pi.createMcpExtension({
    logPath,
    loadConfig: () => ({
      servers: [...runtimeServers.keys()].map((name) => ({
        name,
        scope: 'extension' as const,
        source: 'Cherry Studio',
        config: {
          command: 'cherry-in-memory',
          exposure: 'codemode' as const,
          timeout: MCP_FORWARDING_TIMEOUT_MS / 1000
        }
      })),
      errors: []
    }),
    createTransport: (entry) => {
      const server = runtimeServers.get(entry.name)!
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      return {
        async start() {
          await server.connect(serverTransport)
          await clientTransport.start()
        },
        send: (message) => clientTransport.send(message as Parameters<InMemoryTransport['send']>[0]),
        close: () => clientTransport.close(),
        onMessage(listener) {
          clientTransport.onmessage = (message) => listener(message as Parameters<typeof listener>[0])
          return () => {
            clientTransport.onmessage = undefined
          }
        },
        onError(listener) {
          clientTransport.onerror = listener
          return () => {
            clientTransport.onerror = undefined
          }
        },
        onClose(listener) {
          clientTransport.onclose = listener
          return () => {
            clientTransport.onclose = undefined
          }
        }
      } satisfies ReturnType<McpTransportFactory>
    }
  })
}
