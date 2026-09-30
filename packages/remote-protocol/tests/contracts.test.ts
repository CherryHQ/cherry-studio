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

  it('accepts old catalogs and preserves bounded Unicode avatar text', () => {
    const result = agentMethods['agent.agents.list'].result
    expect(result.parse({ items: [{ agentId: 'a', name: 'Agent' }], nextCursor: null }).items[0].emoji).toBeUndefined()
    expect(
      result.parse({ items: [{ agentId: 'a', name: 'Agent', emoji: '🧑🏽‍💻' }], nextCursor: null }).items[0].emoji
    ).toBe('🧑🏽‍💻')
    for (const emoji of ['', ' ', 'x'.repeat(65), '\ud800']) {
      expect(result.safeParse({ items: [{ agentId: 'a', name: 'Agent', emoji }], nextCursor: null }).success).toBe(
        false
      )
    }
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

describe('question and workspace command contracts', () => {
  const target = {
    commandId: 'c',
    sessionId: 's',
    interactionId: 'i',
    expectedRevision: '1',
    expectedExecutionId: 'e',
    inputDigest: 'a'.repeat(64)
  }
  it('keeps answers in command identity and rejects mixed or oversized response shapes', () => {
    const params = { ...target, response: { kind: 'answer' as const, answers: { '目录？': '项目🌍' } } }
    const schema = agentMethods['agent.interactions.respond'].params
    expect(schema.parse(params)).toEqual(params)
    expect(schema.safeParse({ ...params, decision: 'approve' }).success).toBe(false)
    expect(schema.safeParse({ ...target, response: { kind: 'approve', answers: { q: 'x' } } }).success).toBe(false)
    expect(schema.safeParse({ ...target, response: { kind: 'answer', answers: {} } }).success).toBe(false)
    expect(
      schema.safeParse({ ...target, response: { kind: 'answer', answers: { q: 'x'.repeat(8193) } } }).success
    ).toBe(false)
    expect(encodeAgentCommand('agent.interactions.respond', params)).not.toEqual(
      encodeAgentCommand('agent.interactions.respond', {
        ...params,
        response: { kind: 'answer', answers: { '目录？': 'different' } }
      })
    )
    expect(schema.parse({ ...target, decision: 'approve' })).toEqual({ ...target, decision: 'approve' })
  })
  it('separates registered and system creation without accepting paths or ambiguous destinations', () => {
    const schema = agentMethods['agent.sessions.create'].params
    const base = { commandId: 'c', agentId: 'a' }
    for (const destination of [
      { workspace: { kind: 'system' } },
      { workspace: { kind: 'registered', id: 'w' } },
      { workspaceId: 'w' }
    ])
      expect(schema.parse({ ...base, ...destination })).toEqual({ ...base, ...destination })
    for (const destination of [
      {},
      { workspace: { kind: 'system', path: '/tmp' } },
      { workspace: { kind: 'registered' } },
      { workspaceId: 'w', workspace: { kind: 'system' } }
    ])
      expect(schema.safeParse({ ...base, ...destination }).success).toBe(false)
    expect(
      agentMethods['agent.workspaces.list'].result.parse({ items: [], nextCursor: null }).systemWorkspace
    ).toBeUndefined()
  })
})
