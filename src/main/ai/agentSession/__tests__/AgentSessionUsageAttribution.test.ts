import { setupTestDatabase } from '@test-helpers/db'
import { expect, it } from 'vitest'

import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import type { RecordAiInvocationInput } from '@data/services/AiUsageRecordService'
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
    capturedAt: '2026-10-27T00:00:00Z'
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
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(0)
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
