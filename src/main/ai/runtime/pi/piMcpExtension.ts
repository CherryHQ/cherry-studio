import { createHash } from 'node:crypto'

import type { ExtensionFactory, McpTransportFactory } from '@earendil-works/pi-coding-agent'
import { InMemoryTransport } from '@modelcontextprotocol/client'

import { BRIDGE_ORIGIN_META_KEY } from '@main/ai/agentSession/bridgeOrigin'
import { MCP_FORWARDING_TIMEOUT_MS } from '@main/ai/mcp/mcpRequestOptions'
import type { AgentMcpServer } from '@main/ai/runtime/agentMcpServers'

import type { loadPiSdk } from './piSdk'

/** Match Pi's native MCP identifiers for policy and stored disabled-tool lookups. */
export function buildPiMcpToolName(serverName: string, toolName: string, collides = false): string {
  const name = `mcp__${serverName}__${toolName}`.replace(/[^A-Za-z0-9_]/g, '_')
  if (name.length <= 64 && !collides) return name
  const hash = createHash('sha256').update(`${serverName}\0${toolName}`).digest('hex').slice(0, 8)
  return `${name.slice(0, 55)}_${hash}`
}

/** Cherry owns server configuration; Pi owns MCP discovery, tool execution, results and teardown. */
export function createPiMcpExtension(
  pi: Awaited<ReturnType<typeof loadPiSdk>>,
  servers: Record<string, AgentMcpServer>,
  logPath: string,
  resolveBridgeOrigin?: (sessionId: string) => string | undefined
): ExtensionFactory {
  // UUID namespaces prevent display-name collisions and keep stored tool policies stable on rename.
  const runtimeServers = new Map(Object.values(servers).map((server) => [server.id ?? server.name, server]))
  let sessionId: string | undefined
  return pi.createMcpExtension({
    logPath,
    loadConfig: (ctx) => {
      // The MCP client is instantiated per Pi session (root and every child share this factory).
      // Remember which one this instance serves so its tools/call requests can name their origin.
      sessionId = ctx.sessionManager.getSessionId()
      return {
      servers: [...runtimeServers.keys()].map((name) => ({
        name,
        scope: 'extension' as const,
        source: 'Cherry Studio',
        config: {
          command: 'cherry-in-memory',
          exposure: name === 'automation' ? ('direct' as const) : ('codemode' as const),
          timeout: MCP_FORWARDING_TIMEOUT_MS / 1000
        }
      })),
        errors: []
      }
    },
    createTransport: (entry) => {
      const server = runtimeServers.get(entry.name)!
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      return {
        async start() {
          await server.connect(serverTransport)
          await clientTransport.start()
        },
        send: (message) =>
          clientTransport.send(
            stampBridgeOrigin(message, sessionId, resolveBridgeOrigin) as Parameters<InMemoryTransport['send']>[0]
          ),
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


/**
 * Stamp the calling Pi session on a `tools/call` request. Root turns carry no origin; child
 * sessions name themselves so the host can resolve their spawning authority instead of crediting
 * them with whatever responder the shared root connection currently holds.
 */
export function stampBridgeOrigin<T>(
  message: T,
  sessionId: string | undefined,
  resolve: ((sessionId: string) => string | undefined) | undefined
): T {
  if (sessionId === undefined || resolve === undefined) return message
  const origin = resolve(sessionId)
  if (origin === undefined) return message
  if (typeof message !== 'object' || message === null) return message
  const request = message as { method?: unknown; params?: unknown }
  if (request.method !== 'tools/call' || typeof request.params !== 'object' || request.params === null) return message
  const params = request.params as { _meta?: unknown }
  return {
    ...(message as Record<string, unknown>),
    params: {
      ...(request.params as Record<string, unknown>),
      _meta: {
        ...(typeof params._meta === 'object' && params._meta !== null ? params._meta : {}),
        [BRIDGE_ORIGIN_META_KEY]: origin
      }
    }
  } as T
}
