import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type { McpServer, Server, Transport } from '@modelcontextprotocol/server'
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio'

type Connectable<TResult> = { connect(transport: Transport): Promise<TResult> }

/** Serves a server factory the way agent runtimes do: one protocol instance per transport. */
export function serveMcpTestServer(createServer: () => McpServer | Server): Connectable<StdioServerHandle>['connect'] {
  return async (transport) => serveStdio(createServer, { transport })
}

/** Connects a real in-memory client to a server factory or anything exposing `connect(transport)`. */
export async function connectMcpTestClient<TResult>(
  target: (() => McpServer | Server) | Connectable<TResult>
): Promise<Client> {
  const connect = typeof target === 'function' ? serveMcpTestServer(target) : target.connect
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1.0.0' })
  await connect(serverTransport)
  await client.connect(clientTransport)
  return client
}
