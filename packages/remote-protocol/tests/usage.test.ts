import { createHash } from 'node:crypto'

import { expect, it } from 'vitest'

import {
  messageSchema,
  agentMethods,
  applyAgentEvents,
  encodeAgentCheckpointPage,
  installAgentCheckpoint,
  type AgentCheckpointPage,
  type AgentProjection
} from '../src/agent'

const integrity = { sha256: (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex') }
const usage = {
  inputTokens: 10,
  outputTokens: 0,
  totalTokens: 10,
  cacheReadTokens: 4,
  durationMs: 200,
  costs: [{ currency: 'USD', amount: 0.002, providerReportedRequestCount: 0, computedRequestCount: 1 }]
}
const message = {
  messageId: 'm',
  revision: '1',
  role: 'assistant' as const,
  status: 'success' as const,
  partIds: [],
  usage,
  model: { modelId: 'model', providerId: 'provider', name: 'Historic model' }
}

it('preserves measured zero and absent usage while rejecting invalid metrics', () => {
  expect(messageSchema.parse(message).usage).toEqual(usage)
  expect(messageSchema.parse({ ...message, usage: undefined }).usage).toBeUndefined()
  for (const outputTokens of [-1, Infinity, NaN])
    expect(messageSchema.safeParse({ ...message, usage: { outputTokens } }).success).toBe(false)
  expect(messageSchema.safeParse({ ...message, usage: { costs: Array(33).fill(usage.costs[0]) } }).success).toBe(false)
})

it('keeps usage across serialized event replay and checkpoint recovery', () => {
  const state: AgentProjection = {
    cursor: { sessionId: 's', streamEpoch: 'e', seq: '0' },
    session: {
      sessionId: 's',
      agentId: 'a',
      workspaceId: 'w',
      title: '',
      updatedAt: '2026-09-23T00:00:00Z',
      historyRevision: '0'
    },
    messages: {},
    parts: {},
    executions: {},
    interactions: {},
    tombstones: []
  }
  const result = applyAgentEvents(
    state,
    JSON.parse(
      JSON.stringify({
        subscriptionId: 'sub',
        sessionId: 's',
        streamEpoch: 'e',
        events: [
          {
            seq: '1',
            kind: 'message.created',
            payload: { ...message, revision: '0', status: 'pending', usage: undefined }
          },
          { seq: '2', kind: 'message.updated', payload: { baseRevision: '0', message } }
        ]
      })
    ),
    {},
    integrity
  )
  if (!result.ok) throw new Error(result.reason)
  expect(result.projection.messages.m.usage).toEqual(usage)
  const page: AgentCheckpointPage = {
    checkpointId: 'cp',
    pageIndex: 0,
    nextCursor: null,
    pageDigest: '0'.repeat(64),
    items: [
      { kind: 'session', value: state.session },
      { kind: 'message', value: result.projection.messages.m }
    ]
  }
  const bytes = encodeAgentCheckpointPage(page)
  page.pageDigest = integrity.sha256(bytes)
  const descriptor = {
    checkpointId: 'cp',
    cursor: result.cursor,
    historyRevision: '0',
    pageCount: 1,
    byteLength: String(bytes.length),
    sha256: page.pageDigest,
    expiresAt: '2026-09-23T00:05:00Z'
  }
  const restored = installAgentCheckpoint(descriptor, JSON.parse(JSON.stringify([page])), {}, integrity)
  if (!restored.ok) throw new Error(restored.reason)
  expect(restored.projection.messages.m.usage).toEqual(usage)
  expect(restored.projection.messages.m.model).toEqual(message.model)
})

it('distinguishes an unconfigured agent from a legacy catalog and validates model summaries', () => {
  const catalog = agentMethods['agent.agents.list'].result
  const agent = { agentId: 'a', name: 'Agent' }
  expect(catalog.parse({ items: [agent], nextCursor: null }).items[0].model).toBeUndefined()
  expect(catalog.parse({ items: [{ ...agent, model: null }], nextCursor: null }).items[0].model).toBeNull()
  expect(catalog.parse({ items: [{ ...agent, model: message.model }], nextCursor: null }).items[0].model).toEqual(
    message.model
  )
  expect(messageSchema.safeParse({ ...message, model: { ...message.model, name: '' } }).success).toBe(false)
})
