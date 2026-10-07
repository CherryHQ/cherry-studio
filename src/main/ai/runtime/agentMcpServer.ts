import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import type { McpServer, Server, Transport } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'

export interface AgentMcpServer {
  id?: string
  name: string
  /** Serves this server over `transport`; closing the transport ends it. */
  connect(transport: Transport): Promise<unknown>
}

/** One protocol instance per connection, so each runtime transport gets its own server. */
export function serveAgentMcpServer(createServer: () => McpServer | Server): AgentMcpServer['connect'] {
  return async (transport) => serveStdio(createServer, { transport })
}

/** In-process client for runtimes that consume agent servers as plain MCP tools. */
export async function connectAgentMcpClient(server: AgentMcpServer, clientName: string): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: clientName, version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}
