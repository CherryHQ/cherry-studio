import { describe, expect, it } from 'vitest'

import { agentAuthorizationSchema, agentMethods, encodeAgentCommand } from '../src/agent'
import { connectionMethods, jsonRpcNotificationSchema, jsonRpcRequestSchema, negotiateProtocol } from '../src/index'

describe('remote contracts', () => {
  it('preserves null request IDs without treating a missing ID as a request', () => {
    const envelope = { jsonrpc: '2.0', method: 'connection.ping', params: { nonce: 'a' } }
    expect(jsonRpcRequestSchema.safeParse(envelope).success).toBe(false)
    expect(jsonRpcNotificationSchema.safeParse(envelope).success).toBe(true)
    expect(jsonRpcRequestSchema.parse({ ...envelope, id: null }).id).toBeNull()
    expect(jsonRpcNotificationSchema.safeParse({ ...envelope, id: null }).success).toBe(false)
  })

  it('selects only an explicitly offered and implemented whole protocol', () => {
    expect(negotiateProtocol({ protocolVersions: [1, 3] }, { protocolVersions: [1, 2] })).toEqual({
      ok: true,
      selection: { protocolVersion: 1 }
    })
    expect(negotiateProtocol({ protocolVersions: [3] }, { protocolVersions: [1, 2] }).ok).toBe(false)
    expect(() => negotiateProtocol({ protocolVersions: [] }, { protocolVersions: [1] })).toThrow()
  })

  it('rejects unknown mutation fields and noncanonical revisions', () => {
    const params = { commandId: 'c1', sessionId: 's1', text: 'hello', expectedIdleRevision: '7' }
    expect(agentMethods['agent.messages.send'].params.parse(params)).toEqual(params)
    expect(agentMethods['agent.messages.send'].params.safeParse({ ...params, steer: true }).success).toBe(false)
    expect(
      agentMethods['agent.messages.send'].params.safeParse({ ...params, expectedIdleRevision: '07' }).success
    ).toBe(false)
  })

  it('canonicalizes command identity without losing execution preconditions or Unicode', () => {
    const input = { commandId: 'c1', sessionId: 's1', text: '你好🌍', expectedIdleRevision: '7' }
    const encoded = encodeAgentCommand('agent.messages.send', input)
    expect(new TextDecoder().decode(encoded)).toBe(
      '{"method":"agent.messages.send","params":{"expectedIdleRevision":"7","sessionId":"s1","text":"你好🌍"}}'
    )
    expect(encodeAgentCommand('agent.messages.send', { ...input, commandId: 'other' })).toEqual(encoded)
    expect(encodeAgentCommand('agent.messages.send', { ...input, expectedIdleRevision: '8' })).not.toEqual(encoded)
    expect(() => encodeAgentCommand('agent.messages.send', { ...input, text: '\ud800' })).toThrow()
  })

  it('validates authorization results instead of accepting an arbitrary peer object', () => {
    const methods = connectionMethods(agentAuthorizationSchema)
    expect(
      methods['connection.authenticate'].result.safeParse({
        deviceId: 'd1',
        authorization: { domain: 'agent' },
        accessToken: 't',
        expiresAt: '2026-09-21T08:00:00Z'
      }).success
    ).toBe(false)
  })
})
