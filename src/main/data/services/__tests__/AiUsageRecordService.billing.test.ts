import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { createLanguageUsageMiddleware } from '@main/ai/hooks/billingHook'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import type { ProviderBilling } from '@shared/data/types/providerBilling'

const base = {
  input: { perMillionTokens: 2, currency: 'USD' as const },
  output: { perMillionTokens: 6, currency: 'USD' as const }
}
const billing: ProviderBilling = {
  defaultMultiplier: 2,
  scheduleEnabled: true,
  timeZone: 'UTC',
  periods: [{ id: 'night', name: 'Night', start: '22:00', end: '06:00', mode: 'multiplier', multiplier: 0.5 }]
}

describe('billing invocation contract', () => {
  const dbh = setupTestDatabase()
  afterEach(() => vi.useRealTimers())

  it('freezes each invocation across boundaries and edits, and retains immutable deduplicated history', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-10T21:59:00Z'))
    const config = structuredClone(billing)
    const middleware = createLanguageUsageMiddleware(() =>
      createAiUsageCaptureContext({ providerId: 'group', modelId: 'model', pricing: base, billing: config })
    )
    const result = {
      content: [],
      warnings: [],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 1_000_000 }, outputTokens: { total: 1_000_000 } }
    }
    await middleware.wrapGenerate!({
      doGenerate: async () => {
        config.defaultMultiplier = 10
        vi.setSystemTime(new Date('2026-10-10T22:01:00Z'))
        return result
      }
    } as never)
    await middleware.wrapGenerate!({ doGenerate: async () => result } as never)
    vi.setSystemTime(new Date('2026-10-11T06:00:00Z'))
    await middleware.wrapGenerate!({ doGenerate: async () => result } as never)
    const rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows.map((row) => row.cost)).toEqual([16, 4, 80])
    expect(rows.map((row) => row.pricingSnapshot?.billing?.reason)).toEqual(['default', 'period', 'default'])
    expect(rows[0].pricingSnapshot?.billing?.pricedAt).toBe('2026-10-10T21:59:00.000Z')
    aiUsageRecordService.recordInvocation({
      requestId: rows[0].requestId,
      context: createAiUsageCaptureContext({ providerId: 'group', modelId: 'model', pricing: base, billing: config }),
      modality: 'language',
      usage: { inputTokens: 9 },
      completedAt: Date.now()
    })
    expect(
      dbh.db
        .select()
        .from(aiUsageRecordTable)
        .all()
        .map((row) => row.cost)
    ).toEqual([16, 4, 80])
  })

  it('persists frozen peak estimates for external usage while prioritizing trusted provider cost', () => {
    const config: ProviderBilling = {
      ...billing,
      periods: [{ ...billing.periods[0], mode: 'multiplier', multiplier: 4 }]
    }
    const frozen = createAiUsageCaptureContext({
      providerId: 'group',
      modelId: 'model',
      pricing: base,
      billing: config,
      invocationStartedAt: null
    })
    config.defaultMultiplier = 100
    config.periods = []
    // External SDK completion forwards the connection's snapshot through the validated capture boundary.
    const capture = createAiUsageCaptureContext({
      providerId: 'group',
      modelId: 'model',
      pricingSnapshot: frozen.pricingSnapshot,
      trustProviderReportedCost: true,
      reportedCostCurrency: 'USD'
    })
    for (const [requestId, providerCost] of [
      ['reported', { amount: 0.7, currency: 'USD' as const }],
      ['unknown', undefined]
    ] as const) {
      aiUsageRecordService.recordInvocation({
        requestId,
        context: capture,
        modality: 'language',
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        providerCost,
        completedAt: Date.now()
      })
    }
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toMatchObject([
      { cost: 0.7, costSource: 'provider', costCurrency: 'USD' },
      {
        cost: 32,
        costSource: 'computed',
        costCurrency: 'USD',
        inputTokens: 1_000_000,
        pricingSnapshot: {
          inputPerMillionTokens: 8,
          outputPerMillionTokens: 24,
          billing: { reason: 'peak_fallback', multiplier: 4, periodId: 'night' }
        }
      }
    ])
    expect(capture.pricingSnapshot?.billing?.pricedAt).toBeUndefined()
    const fixed = createAiUsageCaptureContext({
      providerId: 'group',
      modelId: 'model',
      pricing: base,
      billing: { ...billing, scheduleEnabled: false },
      invocationStartedAt: null
    })
    expect(fixed.pricingSnapshot).toMatchObject({ inputPerMillionTokens: 4, outputPerMillionTokens: 12 })
  })
})
