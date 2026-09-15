import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool
} from '@modelcontextprotocol/sdk/types.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refreshTools: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: () => ({ refreshTools: mocks.refreshTools }) }
}))
vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { findByIdOrName: vi.fn() }
}))

const { buildMcpToolDefinitions } = await import('../piMcpToolAdapter')

// The adapter's execute never reads the pi-only execution context; a stub satisfies the signature.
const stubCtx = {} as ExtensionContext

const slowTool: Tool = {
  name: 'slow-tool',
  description: 'a slow tool',
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
}

/**
 * Real-chain behavior tests over a real in-memory transport, driven by fake timers: the SDK
 * client's request timer actually runs, so a regression to the 60s default fires it and turns
 * these red (#20266). Outcomes are asserted, never the RequestOptions shape (#20297 review).
 */
describe('buildMcpToolDefinitions forwarding behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createServer(call: (extra: { signal: AbortSignal }) => Promise<CallToolResult>): McpServer {
    const server = new McpServer({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } })
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [slowTool] }))
    server.server.setRequestHandler(CallToolRequestSchema, async (_request, extra) => call(extra))
    return server
  }

  async function buildBridge(call: (extra: { signal: AbortSignal }) => Promise<CallToolResult>) {
    return buildMcpToolDefinitions({ 'srv-1': { name: 'srv-1', instance: createServer(call) } })
  }

  it('completes a tool call that outlasts the SDK 60s default timeout (#20266)', async () => {
    const bridge = await buildBridge(async () => {
      await new Promise((resolve) => setTimeout(resolve, 65_000))
      return { content: [{ type: 'text', text: 'slow but done' }] }
    })

    const completion = expect(
      bridge.tools[0].execute('call-1', { value: 'x' }, undefined, undefined, stubCtx)
    ).resolves.toMatchObject({ content: [{ type: 'text', text: 'slow but done' }] })
    await vi.advanceTimersByTimeAsync(65_000)
    await completion
    await bridge.close()
  })

  it('forwards abort into a slow tool call', async () => {
    const bridge = await buildBridge(
      (extra) =>
        new Promise<CallToolResult>((_, reject) => {
          extra.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
            once: true
          })
        })
    )
    const controller = new AbortController()

    const rejection = expect(
      bridge.tools[0].execute('call-1', { value: 'x' }, controller.signal, undefined, stubCtx)
    ).rejects.toThrow(/abort/i)
    // Let the request reach the server handler before aborting it.
    await vi.advanceTimersByTimeAsync(5)
    controller.abort()
    await rejection
    await bridge.close()
  })
})
