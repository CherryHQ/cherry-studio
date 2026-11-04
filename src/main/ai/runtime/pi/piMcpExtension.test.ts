import { describe, expect, it } from 'vitest'

import { BRIDGE_ORIGIN_META_KEY } from '@main/ai/agentSession/bridgeOrigin'

import { stampBridgeOrigin } from './piMcpExtension'

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
