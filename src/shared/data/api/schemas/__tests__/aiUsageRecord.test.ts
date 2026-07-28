import { describe, expect, it } from 'vitest'

import {
  AI_USAGE_RECORD_AGGREGATE_DEFAULT_LIMIT,
  AI_USAGE_RECORD_MAX_RANGE_DAYS,
  AiUsageRecordListQuerySchema,
  AiUsageRecordStatsQuerySchema,
  AiUsageRecordTimelineQuerySchema
} from '../aiUsageRecord'

const DAY_MS = 24 * 60 * 60 * 1000
const to = Date.UTC(2026, 6, 1)
const from = to - 30 * DAY_MS

describe('AI usage record query contracts', () => {
  it('applies bounded aggregate defaults', () => {
    expect(AiUsageRecordStatsQuerySchema.parse({ groupBy: 'provider', from, to })).toEqual({
      groupBy: 'provider',
      from,
      to,
      metric: 'tokens',
      limit: AI_USAGE_RECORD_AGGREGATE_DEFAULT_LIMIT
    })
  })

  it('requires a currency for monetary ranking and sorting', () => {
    expect(AiUsageRecordStatsQuerySchema.safeParse({ groupBy: 'provider', from, to, metric: 'cost' }).success).toBe(
      false
    )
    expect(AiUsageRecordListQuerySchema.safeParse({ sortBy: 'cost' }).success).toBe(false)

    expect(
      AiUsageRecordStatsQuerySchema.safeParse({
        groupBy: 'provider',
        from,
        to,
        metric: 'cost',
        currency: 'USD'
      }).success
    ).toBe(true)
    expect(AiUsageRecordListQuerySchema.safeParse({ sortBy: 'cost', costCurrency: 'CNY' }).success).toBe(true)
  })

  it('requires message kind and id together', () => {
    expect(AiUsageRecordListQuerySchema.safeParse({ messageKind: 'chat' }).success).toBe(false)
    expect(AiUsageRecordListQuerySchema.safeParse({ messageId: 'message-1' }).success).toBe(false)
    expect(
      AiUsageRecordListQuerySchema.safeParse({ messageKind: 'agent-session', messageId: 'message-1' }).success
    ).toBe(true)
  })

  it('rejects reversed and unbounded timeline ranges', () => {
    expect(AiUsageRecordTimelineQuerySchema.safeParse({ from: to, to: from }).success).toBe(false)
    expect(
      AiUsageRecordTimelineQuerySchema.safeParse({
        from,
        to: from + (AI_USAGE_RECORD_MAX_RANGE_DAYS * DAY_MS + 1)
      }).success
    ).toBe(false)
  })
})
