import { describe, expect, it } from 'vitest'

import {
  agentAuthorizationSchema,
  agentMethods,
  agentModelOptionSchema,
  agentSessionUpdateParamsSchema,
  encodeAgentCommand,
  messageSchema,
  modelOverrideSchema,
  reasoningEffortSchema,
  workspaceFileChunkSchema,
  workspaceFileMetadataSchema
} from '../src/agent'
import { checkpointItemSchema } from '../src/agent/checkpoints'
import {
  connectionMethods,
  desktopProfileSchema,
  jsonRpcNotificationSchema,
  jsonRpcRequestSchema,
  negotiateProtocol,
  pairingMethods
} from '../src/index'

describe('remote contracts', () => {
  it('accepts explicit paged message summaries without admitting partial messages into recovery', () => {
    const method = agentMethods['agent.messages.list']
    const params = { sessionId: 's', historyRevision: '1', partsMode: 'paged' }
    expect(method.params.parse(params)).toEqual(params)
    expect(method.params.safeParse({ ...params, partsMode: 'truncated' }).success).toBe(false)
    const summary = { messageId: 'm', revision: '1', role: 'assistant', status: 'success', partsMode: 'paged' }
    expect(method.result.parse({ items: [summary], nextCursor: null }).items).toEqual([summary])
    expect(method.result.safeParse({ items: [{ ...summary, partIds: [] }], nextCursor: null }).success).toBe(false)
    expect(method.result.safeParse({ items: [{ ...summary, status: 'error' }], nextCursor: null }).success).toBe(false)
    expect(messageSchema.safeParse(summary).success).toBe(false)
    expect(checkpointItemSchema.safeParse({ kind: 'message', value: summary }).success).toBe(false)
    const legacy = { messageId: 'm', revision: '1', role: 'assistant', status: 'success', partIds: ['p'] }
    expect(method.result.parse({ items: [legacy], nextCursor: null }).items).toEqual([legacy])
    expect(method.params.parse({ sessionId: 's', historyRevision: '1' })).toEqual({
      sessionId: 's',
      historyRevision: '1'
    })
    const hello = connectionMethods(agentAuthorizationSchema)['connection.hello'].result
    expect(
      hello.parse({ protocolVersion: 1, limits: {}, heartbeatMs: 20000 }).agentMessageSummariesVersion
    ).toBeUndefined()
    expect(
      hello.parse({ protocolVersion: 1, limits: {}, heartbeatMs: 20000, agentMessageSummariesVersion: 1 })
        .agentMessageSummariesVersion
    ).toBe(1)
    expect(
      hello.safeParse({ protocolVersion: 1, limits: {}, heartbeatMs: 20000, agentMessageSummariesVersion: 0 }).success
    ).toBe(false)
  })

  it('keeps old hello replies compatible and bounds address handoff to approved domains and valid endpoints', () => {
    const methods = connectionMethods(agentAuthorizationSchema)
    expect(
      methods['connection.hello'].result.parse({ protocolVersion: 1, limits: {}, heartbeatMs: 20000 })
        .connectionEndpointsVersion
    ).toBeUndefined()
    const handoff = methods['connection.endpoints']
    expect(handoff.params.safeParse({ domain: 'admin' }).success).toBe(false)
    const endpoint = { host: 'desktop.example.com', port: 23333, security: 'ws' }
    expect(handoff.result.parse({ desktopIdentity: 'desktop', endpoints: [endpoint] }).endpoints).toEqual([endpoint])
    expect(handoff.result.safeParse({ desktopIdentity: 'desktop', endpoints: Array(33).fill(endpoint) }).success).toBe(
      false
    )
    expect(
      handoff.result.safeParse({
        desktopIdentity: 'desktop',
        endpoints: [{ ...endpoint, host: 'user:secret@desktop.example.com' }]
      }).success
    ).toBe(false)
  })
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

  it('validates agent.sessions.update params schema with trimming and bounds', () => {
    const valid = { commandId: 'c1', sessionId: 's1', title: 'Renamed Session' }
    expect(agentSessionUpdateParamsSchema.parse(valid)).toEqual(valid)
    expect(agentMethods['agent.sessions.update'].params.parse(valid)).toEqual(valid)

    // Trimming
    expect(
      agentSessionUpdateParamsSchema.parse({ commandId: 'c1', sessionId: 's1', title: '  Padded Title  ' }).title
    ).toBe('Padded Title')

    // Empty or whitespace only rejected
    expect(agentSessionUpdateParamsSchema.safeParse({ commandId: 'c1', sessionId: 's1', title: '' }).success).toBe(
      false
    )
    expect(agentSessionUpdateParamsSchema.safeParse({ commandId: 'c1', sessionId: 's1', title: '   ' }).success).toBe(
      false
    )

    // Exceeding 4096 chars rejected
    expect(
      agentSessionUpdateParamsSchema.safeParse({ commandId: 'c1', sessionId: 's1', title: 'x'.repeat(4097) }).success
    ).toBe(false)

    // Canonicalization of command
    const encoded = encodeAgentCommand('agent.sessions.update', valid)
    expect(new TextDecoder().decode(encoded)).toBe(
      '{"method":"agent.sessions.update","params":{"sessionId":"s1","title":"Renamed Session"}}'
    )
  })

  it('validates model option, override, and reasoning effort schemas across agent methods', () => {
    // reasoningEffortSchema
    expect(reasoningEffortSchema.parse('default')).toBe('default')
    expect(reasoningEffortSchema.parse('high')).toBe('high')
    expect(reasoningEffortSchema.safeParse('invalid-effort').success).toBe(false)

    // agentModelOptionSchema
    const modelOption = {
      modelId: 'gpt-4o',
      providerId: 'openai',
      name: 'GPT-4o',
      reasoningEfforts: ['default', 'low', 'high'] as const
    }
    expect(agentModelOptionSchema.parse(modelOption)).toEqual(modelOption)

    // modelOverrideSchema
    const override = { modelId: 'claude-3-5-sonnet-20241022', providerId: 'anthropic' }
    expect(modelOverrideSchema.parse(override)).toEqual(override)
    expect(modelOverrideSchema.safeParse({ modelId: 'only-model' }).success).toBe(false)

    // connection.hello advertises versions
    const hello = connectionMethods(agentAuthorizationSchema)['connection.hello'].result
    const helloParsed = hello.parse({
      protocolVersion: 1,
      limits: {},
      heartbeatMs: 20000,
      agentSessionRenameVersion: 1,
      agentModelSelectionVersion: 1
    })
    expect(helloParsed.agentSessionRenameVersion).toBe(1)
    expect(helloParsed.agentModelSelectionVersion).toBe(1)

    // agent.agents.list result schema accepts reasoningEffort and availableModels
    const agentListResult = agentMethods['agent.agents.list'].result.parse({
      items: [
        {
          agentId: 'a1',
          name: 'Test Agent',
          reasoningEffort: 'medium',
          availableModels: [modelOption]
        }
      ],
      nextCursor: null
    })
    expect(agentListResult.items[0].reasoningEffort).toBe('medium')
    expect(agentListResult.items[0].availableModels).toEqual([modelOption])

    // agent.sessions.create params accepts model and reasoningEffort
    const createParams = {
      commandId: 'c1',
      agentId: 'a1',
      workspaceId: 'w1',
      model: override,
      reasoningEffort: 'high' as const
    }
    expect(agentMethods['agent.sessions.create'].params.parse(createParams)).toEqual(createParams)

    // agent.messages.send params accepts model and reasoningEffort
    const sendParams = {
      commandId: 'c1',
      sessionId: 's1',
      text: 'hello',
      expectedIdleRevision: '1',
      model: override,
      reasoningEffort: 'low' as const
    }
    expect(agentMethods['agent.messages.send'].params.parse(sendParams)).toEqual(sendParams)
  })

  it('validates desktopProfileSchema, versions in hello, and desktopProfile in auth and pairing', () => {
    // desktopProfileSchema validation
    const profile = { name: 'Alice', avatar: '🦊' }
    expect(desktopProfileSchema.parse(profile)).toEqual(profile)
    expect(desktopProfileSchema.parse({ name: '  Bob  ' })).toEqual({ name: 'Bob' })
    expect(desktopProfileSchema.safeParse({ name: '' }).success).toBe(false)
    expect(desktopProfileSchema.safeParse({ name: 'a'.repeat(257) }).success).toBe(false)
    expect(desktopProfileSchema.safeParse({ avatar: 'x'.repeat(65_537) }).success).toBe(false)

    // connection.hello advertises desktopProfileVersion and agentFilesVersion
    const hello = connectionMethods(agentAuthorizationSchema)['connection.hello'].result
    const helloParsed = hello.parse({
      protocolVersion: 1,
      limits: {},
      heartbeatMs: 20000,
      desktopProfileVersion: 1,
      agentFilesVersion: 1
    })
    expect(helloParsed.desktopProfileVersion).toBe(1)
    expect(helloParsed.agentFilesVersion).toBe(1)

    // connection.authenticate result accepts desktopProfile
    const conn = connectionMethods(agentAuthorizationSchema)
    const authResult = conn['connection.authenticate'].result.parse({
      deviceId: 'd1',
      accessToken: 'token1',
      expiresAt: '2026-11-05T00:00:00.000Z',
      authorization: { domain: 'agent', grantId: 'g1' },
      desktopProfile: profile
    })
    expect(authResult.desktopProfile).toEqual(profile)

    // connection.refresh result accepts desktopProfile
    const refreshResult = conn['connection.refresh'].result.parse({
      accessToken: 'token2',
      expiresAt: '2026-11-05T00:00:00.000Z',
      authorization: { domain: 'agent', grantId: 'g1' },
      desktopProfile: profile
    })
    expect(refreshResult.desktopProfile).toEqual(profile)

    // pairing.get approved result accepts desktopProfile
    const pairing = pairingMethods(agentAuthorizationSchema)
    const pairingResult = pairing['pairing.get'].result.parse({
      status: 'approved',
      deviceId: 'd1',
      accessToken: 'token3',
      expiresAt: '2026-11-05T00:00:00.000Z',
      authorization: { domain: 'agent', grantId: 'g1' },
      desktopProfile: profile
    })
    expect(pairingResult.status === 'approved' && pairingResult.desktopProfile).toEqual(profile)
  })

  it('validates agent.files.get and agent.files.read schemas', () => {
    // agent.files.get params and result
    const getParams = { sessionId: 's1', path: 'src/main.ts' }
    expect(agentMethods['agent.files.get'].params.parse(getParams)).toEqual(getParams)

    const meta = {
      path: 'src/main.ts',
      name: 'main.ts',
      revision: '1730000000000',
      byteLength: 1024,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      updatedAt: '2026-11-05T00:00:00.000Z',
      mediaType: 'text/typescript'
    }
    expect(agentMethods['agent.files.get'].result.parse(meta)).toEqual(meta)
    expect(workspaceFileMetadataSchema.parse(meta)).toEqual(meta)

    // agent.files.read params and result
    const readParams = {
      sessionId: 's1',
      path: 'src/main.ts',
      expectedRevision: '1730000000000',
      offset: 0,
      length: 1024
    }
    expect(agentMethods['agent.files.read'].params.parse(readParams)).toEqual(readParams)

    // read params length bounded to 24_576
    expect(
      agentMethods['agent.files.read'].params.safeParse({
        ...readParams,
        length: 24_577
      }).success
    ).toBe(false)

    const chunk = {
      revision: '1730000000000',
      offset: 0,
      totalBytes: 1024,
      eof: true,
      encoding: 'base64' as const,
      data: 'SGVsbG8gV29ybGQ='
    }
    expect(agentMethods['agent.files.read'].result.parse(chunk)).toEqual(chunk)
    expect(workspaceFileChunkSchema.parse(chunk)).toEqual(chunk)
  })
})
