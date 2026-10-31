import { InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'

import type { BuiltinMcpEndpoint } from '../servers/factory'
import { ClientMcpConnection } from './ClientMcpConnection'
import type { McpConnection, McpConnectionEvents } from './McpConnection'

export async function createInProcessMcpConnection({
  appVersion,
  endpoint,
  events,
  connectTimeoutMs
}: {
  appVersion: string
  endpoint: BuiltinMcpEndpoint
  events: McpConnectionEvents
  connectTimeoutMs: number
}): Promise<McpConnection> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const handle = serveStdio(() => endpoint.createServer(), { transport: serverTransport, legacy: 'reject' })
  const connection = new ClientMcpConnection(
    { name: 'Cherry Studio', version: appVersion },
    {
      capabilities: {
        elicitation: { form: {}, url: {} },
        sampling: {},
        roots: {}
      },
      versionNegotiation: {
        mode: { pin: '2026-07-28' },
        probe: { timeoutMs: 10_000, maxRetries: 0 }
      }
    },
    events
  )

  try {
    await connection.connect(clientTransport, { timeout: connectTimeoutMs })
    if (connection.era !== 'modern') {
      throw new Error(`Builtin MCP endpoint negotiated unexpected ${connection.era} era`)
    }
  } catch (error) {
    await connection.close().catch(() => undefined)
    await handle.close().catch(() => undefined)
    await endpoint.close().catch(() => undefined)
    throw error
  }

  // ClientMcpConnection runs hooks after client.close(), preserving the
  // required client → serveStdio → activation-backend shutdown order.
  connection.addCloseHook(() => handle.close())
  connection.addCloseHook(() => endpoint.close())
  return connection
}
