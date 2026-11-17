import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type { McpServer, Server, Transport } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'

type Connectable = { connect(transport: Transport): Promise<unknown> }

/** Serves a server factory the way agent runtimes do: one protocol instance per transport. */
export function serveMcpTestServer(createServer: () => McpServer | Server): Connectable['connect'] {
  return async (transport) => serveStdio(createServer, { transport })
}

/** Connects a real in-memory client to a server factory or anything exposing `connect(transport)`. */
export async function connectMcpTestClient(target: (() => McpServer | Server) | Connectable): Promise<Client> {
  const connect = typeof target === 'function' ? serveMcpTestServer(target) : target.connect
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1.0.0' })
  await connect(serverTransport)
  await client.connect(clientTransport)
  return client
}
