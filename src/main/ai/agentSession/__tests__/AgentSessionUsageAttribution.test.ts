import { setupTestDatabase } from '@test-helpers/db'
import { expect, it } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { aiUsageRecordService, type RecordAiInvocationInput } from '@data/services/AiUsageRecordService'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'

import { AgentSessionUsageAttribution } from '../AgentSessionUsageAttribution'

const dbh = setupTestDatabase()
const invocation = (id: string): RecordAiInvocationInput => ({
  requestId: id,
  context: createAiUsageCaptureContext({
    providerId: 'provider',
    modelId: 'model',
    credentialReceipt: { attribution: 'explicit', id: 'captured-key', masked: 'key-****', label: 'Captured' },
    pricing: { input: { perMillionTokens: 1, currency: 'USD' }, output: { perMillionTokens: 2, currency: 'USD' } },
    capturedAt: '2026-10-27T00:00:00Z',
    agentSessionId: 'root-session'
  }),
  modality: 'language',
  usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  completedAt: 1234
})

// A completed gateway request can precede the native steer receipt; neither order may charge the old reply.
it.each([true, false])('joins by native response ID with frozen attribution (usage first: %s)', (usageFirst) => {
  const attribution = new AgentSessionUsageAttribution()
  const first = invocation('call-1')
  const second = invocation('call-2')
  const recordFirst = attribution.capture('native-1')
  const recordSecond = attribution.capture('native-2')
  if (usageFirst) {
    recordSecond(second)
    recordFirst(first)
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toMatchObject([
      { agentSessionId: 'root-session', messageId: null },
      { agentSessionId: 'root-session', messageId: null }
    ])
  }
  attribution.bind('native-1', '11111111-1111-4111-8111-111111111111')
  attribution.bind('native-2', '22222222-2222-4222-8222-222222222222')
  if (!usageFirst) {
    recordSecond(second)
    recordFirst(first)
  }
  attribution.bind('native-2', '22222222-2222-4222-8222-222222222222')
  attribution.close()
  const rows = dbh.db.select().from(aiUsageRecordTable).all()
  expect(rows).toHaveLength(2)
  expect(rows.find((row) => row.requestId === 'call-1')).toMatchObject({
    messageId: '11111111-1111-4111-8111-111111111111'
  })
  expect(rows.find((row) => row.requestId === 'call-2')).toMatchObject({
    messageId: '22222222-2222-4222-8222-222222222222'
  })
  expect(first.context.messageRef).toBeNull()
  expect(
    rows.every((row) => row.apiKeyId === 'captured-key' && row.providerId === 'provider' && row.modelId === 'model')
  ).toBe(true)
  expect(rows.every((row) => row.costCurrency === 'USD' && Math.abs(row.cost! - 0.00014) < 1e-10)).toBe(true)
})

// Disconnect must retain real provider usage without guessing the last active message.
it('records unresolved and late completions without a message owner after close', () => {
  const attribution = new AgentSessionUsageAttribution()
  const late = attribution.capture('unobserved-response')
  late(invocation('before-close'))
  attribution.close()
  late(invocation('after-close'))
  const rows = dbh.db.select().from(aiUsageRecordTable).all()
  expect(rows).toHaveLength(2)
  expect(rows.every((row) => row.messageId === null)).toBe(true)
})

// A hidden auxiliary request must survive process loss before native response correlation.
it('persists session-owned auxiliary usage immediately and enriches child ownership once', () => {
  const attribution = new AgentSessionUsageAttribution()
  const record = attribution.capture('child-response')
  record(invocation('child-call'))
  const before = dbh.db.select().from(aiUsageRecordTable).get()!
  expect(before).toMatchObject({ agentSessionId: 'root-session', messageId: null, totalTokens: 120 })
  attribution.bind('child-response', 'child-message', 'child-session')
  attribution.bind('child-response', 'child-message', 'child-session')
  const after = dbh.db.select().from(aiUsageRecordTable).get()!
  expect(after).toEqual({
    ...before,
    agentSessionId: 'child-session',
    messageKind: 'agent-session',
    messageId: 'child-message'
  })
  expect(() => attribution.bind('child-response', 'different-message')).toThrow('another message')
  expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(1)
})

// Late native correlation must repair the message projection without charging a second request.
it('projects child fees once and keeps session-only auxiliary fees queryable', () => {
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: 'workspace', name: 'Workspace', path: '/workspace', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentSessionTable)
    .values({ id: 'child-session', workspaceId: 'workspace', name: 'Child', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentSessionMessageTable)
    .values({
      id: 'child-message',
      sessionId: 'child-session',
      role: 'assistant',
      data: { parts: [] },
      status: 'success'
    })
    .run()
  const attribution = new AgentSessionUsageAttribution()
  attribution.capture('response')(invocation('visible-call'))
  attribution.capture('auxiliary')(invocation('summary-call'))
  attribution.bind('response', 'child-message', 'child-session')
  attribution.bind('response', 'child-message', 'child-session')
  expect(dbh.db.select().from(agentSessionMessageTable).get()?.stats).toMatchObject({
    requestCount: 1,
    totalTokens: 120,
    inputTokens: 100,
    outputTokens: 20
  })
  expect(aiUsageRecordService.list({ agentSessionId: 'root-session', limit: 10 }).items).toMatchObject([
    { requestId: 'summary-call', messageId: null }
  ])
  expect(aiUsageRecordService.list({ agentSessionId: 'child-session', limit: 10 }).items).toMatchObject([
    { requestId: 'visible-call', messageId: 'child-message' }
  ])
  const rows = dbh.db.select().from(aiUsageRecordTable).all()
  expect(rows).toHaveLength(2)
  expect(rows.reduce((sum, row) => sum + row.totalTokens!, 0)).toBe(240)
})

// Best-effort analytics must not prevent a native reply when its initial record was unavailable.
it('does not recreate a missing invocation during late association', () => {
  const attribution = new AgentSessionUsageAttribution()
  attribution.capture('response')(invocation('call'))
  dbh.db.delete(aiUsageRecordTable).run()
  expect(() => attribution.bind('response', 'message', 'root-session')).not.toThrow()
  expect(dbh.db.select().from(aiUsageRecordTable).all()).toEqual([])
})
