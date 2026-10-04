import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server'

import type { BuiltinMcpEndpoint } from '../servers/factory'
import { ClientMcpConnection } from './ClientMcpConnection'
import type { McpConnection, McpConnectionEvents } from './McpConnection'

const IN_PROCESS_MCP_URL = new URL('http://cherry.internal/mcp')

export async function fetchInProcessMcpRequest(
  handler: McpHttpHandler,
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const request = input instanceof Request && !init ? input : new Request(input, init)
  const signal = init?.signal ?? request.signal
  const response = await handler.fetch(request)
  if (!response.body) return response
  // Native fetch cancels its response stream when aborted; the in-process bridge must do the same.
  return new Response(response.body.pipeThrough(new TransformStream(), { signal }), response)
}

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
  const handler = createMcpHandler(() => endpoint.createServer(), {
    legacy: 'reject'
  })
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

  const transport = new StreamableHTTPClientTransport(IN_PROCESS_MCP_URL, {
    fetch: (input, init) => fetchInProcessMcpRequest(handler, input, init)
  })

  try {
    await connection.connect(transport, { timeout: connectTimeoutMs })
    if (connection.era !== 'modern') {
      throw new Error(`Builtin MCP endpoint negotiated unexpected ${connection.era} era`)
    }
  } catch (error) {
    await connection.close().catch(() => undefined)
    await handler.close().catch(() => undefined)
    await endpoint.close().catch(() => undefined)
    throw error
  }

  // ClientMcpConnection runs hooks after client.close(), preserving the
  // required client → handler → activation-backend shutdown order.
  connection.addCloseHook(() => handler.close())
  connection.addCloseHook(() => endpoint.close())
  return connection
}
