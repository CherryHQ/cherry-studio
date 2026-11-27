import type { CallToolResult, McpServer, Tool } from '@modelcontextprotocol/server'
import { vi } from 'vitest'

import { createInProcessMcpConnection } from '../../connections/InProcessMcpConnection'
import type { McpConnection } from '../../connections/McpConnection'

/** Runs `run` against a builtin server over the same in-process wire production uses. */
async function withConnection<T>(createServer: () => McpServer, run: (connection: McpConnection) => Promise<T>) {
  const connection = await createInProcessMcpConnection({
    appVersion: 'test',
    endpoint: { createServer, close: async () => undefined },
    events: {
      toolsChanged: vi.fn(),
      promptsChanged: vi.fn(),
      resourcesChanged: vi.fn(),
      resourceUpdated: vi.fn(),
      log: vi.fn()
    },
    connectTimeoutMs: 10_000
  })
  try {
    return await run(connection)
  } finally {
    await connection.close()
  }
}

export function callBuiltinTool(
  createServer: () => McpServer,
  name: string,
  args: Record<string, unknown> = {}
): Promise<CallToolResult> {
  return withConnection(createServer, (connection) =>
    connection.callTool(name, args, { signal: new AbortController().signal, timeoutMs: 10_000 })
  )
}

export function listBuiltinTools(createServer: () => McpServer): Promise<Tool[]> {
  return withConnection(createServer, (connection) => connection.listTools('refresh'))
}

export function toolText(result: CallToolResult): string {
  return result.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
}
