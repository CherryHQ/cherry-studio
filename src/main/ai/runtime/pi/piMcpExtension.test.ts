import type { McpExtensionOptions } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vitest'

import { BRIDGE_ORIGIN_META_KEY } from '@main/ai/agentSession/bridgeOrigin'

import { createPiMcpExtension, stampBridgeOrigin } from './piMcpExtension'

const mocks = vi.hoisted(() => ({
  clients: [] as Array<{ send: ReturnType<typeof vi.fn> }>
}))

vi.mock('@modelcontextprotocol/client', () => ({
  InMemoryTransport: {
    createLinkedPair: () => {
      const client = { send: vi.fn(), start: vi.fn(), close: vi.fn() }
      mocks.clients.push(client)
      return [client, { start: vi.fn(), close: vi.fn() }]
    }
  }
}))

const resolveChild = (sessionId: string) => (sessionId === 'root-session' ? undefined : sessionId)

describe('Pi MCP bridge origin', () => {
  it('stamps the calling child session on tools/call', () => {
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'session_read', arguments: {} } }
    expect(stampBridgeOrigin(request, 'child-session', resolveChild)).toEqual({
      ...request,
      params: {
        ...request.params,
        _meta: { [BRIDGE_ORIGIN_META_KEY]: 'child-session' }
      }
    })
  })

  it('leaves root turns and non-tool requests untouched', () => {
    const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x', arguments: {} } }
    expect(stampBridgeOrigin(call, 'root-session', resolveChild)).toBe(call)
    const list = { jsonrpc: '2.0', id: 2, method: 'tools/list' }
    expect(stampBridgeOrigin(list, 'child-session', resolveChild)).toBe(list)
  })

  it('keeps each transport bound to the session that loaded it', async () => {
    // Pi shares the extension options across sessions: a later session's loadConfig overwrote the
    // factory-wide id, so a surviving child's transport stamped the interactive session's origin.
    const options: McpExtensionOptions[] = []
    createPiMcpExtension(
      {
        createMcpExtension: (value: McpExtensionOptions) => {
          options.push(value)
          return () => {}
        }
      } as never,
      { automation: {} as never },
      '/tmp/mcp.log',
      resolveChild
    )
    const config = options[0]
    const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'session_read', arguments: {} } }
    const child = config.loadConfig!({ sessionManager: { getSessionId: () => 'child-session' } } as never)
    const childTransport = config.createTransport!(child.servers[0], '/tmp', undefined)
    const root = config.loadConfig!({ sessionManager: { getSessionId: () => 'root-session' } } as never)
    const rootTransport = config.createTransport!(root.servers[0], '/tmp', undefined)

    await childTransport.send(message as never)
    await rootTransport.send(message as never)

    expect(mocks.clients[0].send).toHaveBeenCalledWith({
      ...message,
      params: { ...message.params, _meta: { [BRIDGE_ORIGIN_META_KEY]: 'child-session' } }
    })
    expect(mocks.clients[1].send).toHaveBeenCalledWith(message)
  })

  it('preserves existing _meta while adding the origin', () => {
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'x', arguments: {}, _meta: { trace: 't-1' } }
    }
    expect(stampBridgeOrigin(request, 'child-session', resolveChild).params._meta).toEqual({
      trace: 't-1',
      [BRIDGE_ORIGIN_META_KEY]: 'child-session'
    })
  })
})
