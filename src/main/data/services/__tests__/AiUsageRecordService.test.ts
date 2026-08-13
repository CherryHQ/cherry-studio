import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import {
  aiUsageRecordService,
  mergeMessageRuntimeStats,
  mergeMessageUsageProjection,
  type RecordAiInvocationInput
} from '@data/services/AiUsageRecordService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { createLanguageUsageMiddleware } from '@main/ai/hooks/billingHook'
import { gatewayUsageNormalizeFeature } from '@main/ai/runtime/aiSdk/params/features/gatewayUsageNormalize'
import { createAiUsageCaptureContext, createAiUsagePricingSnapshot } from '@main/ai/utils/usageCapture'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import type { LanguageModelMiddleware } from 'ai'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({
  notifyDataApiDataChangeMock: vi.fn()
}))

vi.mock('@data/dataApiDataChange', () => ({
  notifyDataApiDataChange: notifyDataApiDataChangeMock
}))

const messageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function context(
  overrides: Partial<Parameters<typeof createAiUsageCaptureContext>[0]> = {}
): ReturnType<typeof createAiUsageCaptureContext> {
  return createAiUsageCaptureContext({
    providerId: 'provider-1',
    providerName: 'Provider One',
    modelId: 'model-1',
    modelName: 'Model One',
    pricingSnapshot: {
      currency: 'USD',
      inputPerMillionTokens: 1,
      outputPerMillionTokens: 2,
      capturedAt: '2026-07-28T00:00:00.000Z'
    },
    credentialReceipt: {
      attribution: 'explicit',
      id: 'key-1',
      label: 'Primary',
      masked: 'sk-****0001'
    },
    source: { type: 'assistant', id: 'assistant-1', name: 'Assistant', icon: '🍒' },
    messageRef: { kind: 'chat', id: messageId },
    ...overrides
  })
}

function invocation(overrides: Partial<RecordAiInvocationInput> = {}): RecordAiInvocationInput {
  return {
    requestId: 'request-1',
    context: context(),
    modality: 'language',
    usage: { inputTokens: 1_000_000, outputTokens: 500_000, totalTokens: 1_500_000 },
    metrics: { timeFirstTokenMs: 20, timeCompletionMs: 120, timeThinkingMs: 40 },
    completedAt: 1_000,
    ...overrides
  }
}

async function getGatewayUsageNormalizeMiddleware(): Promise<LanguageModelMiddleware> {
  const [plugin] = gatewayUsageNormalizeFeature.contributeModelAdapters!({} as never)
  if (!plugin) throw new Error('gateway usage plugin was not contributed')
  const requestContext = { middlewares: [] as LanguageModelMiddleware[] }
  await plugin.configureContext!(requestContext as never)
  const middleware = requestContext.middlewares[0]
  if (!middleware) throw new Error('gateway usage middleware was not registered')
  return middleware
}

describe('AiUsageRecordService', () => {
  const dbh = setupTestDatabase()

  it('replaces projection fields while preserving message-owned stats', () => {
    expect(
      mergeMessageUsageProjection(
        {
          totalTokens: 999,
          requestCount: 9,
          contextTokens: 11,
          timeCompletionMs: 750
        },
        {
          totalTokens: 12,
          requestCount: 1
        }
      )
    ).toEqual({
      totalTokens: 12,
      requestCount: 1,
      contextTokens: 11,
      timeCompletionMs: 750
    })
  })

  beforeEach(() => {
    notifyDataApiDataChangeMock.mockClear()
    dbh.db
      .insert(assistantTable)
      .values({
        id: 'assistant-1',
        name: 'Assistant',
        prompt: '',
        emoji: '🍒',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()
    dbh.db
      .insert(topicTable)
      .values({
        id: 'topic-1',
        assistantId: 'assistant-1',
        activeNodeId: null,
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('topic-1', [
          {
            id: messageId,
            topicId: 'topic-1',
            parentId: null,
            role: 'assistant',
            data: { parts: [] },
            status: 'success',
            stats: { timeFirstTokenMs: 300, timeCompletionMs: 900, timeThinkingMs: 200 },
            createdAt: 1_000,
            updatedAt: 1_000
          }
        ])
      )
      .run()
  })

  it('inserts one immutable invocation and materializes message usage without overwriting message timing', () => {
    aiUsageRecordService.recordInvocation(invocation())

    const row = dbh.db.select().from(aiUsageRecordTable).get()
    expect(row).toMatchObject({
      requestId: 'request-1',
      recordKind: 'invocation',
      requestCount: 1,
      messageKind: 'chat',
      messageId,
      providerId: 'provider-1',
      providerName: 'Provider One',
      modelId: 'model-1',
      modelName: 'Model One',
      apiKeyId: 'key-1',
      apiKeyAttribution: 'explicit',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cost: 2,
      costCurrency: 'USD',
      costSource: 'computed',
      timeFirstTokenMs: 20,
      timeCompletionMs: 120,
      timeThinkingMs: 40
    })

    const message = dbh.db.select().from(messageTable).where(eq(messageTable.id, messageId)).get()
    expect(message?.stats).toEqual({
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      totalTokens: 1_500_000,
      outputTokenDetails: { textTokens: 500_000 },
      requestCount: 1,
      estimatedRequestCount: 0,
      unpricedRequestCount: 0,
      costs: [
        {
          currency: 'USD',
          amount: 2,
          providerReportedRequestCount: 0,
          computedRequestCount: 1
        }
      ],
      providerPerformance: {
        measuredOutputTokens: 500_000,
        generationDurationMs: 100
      },
      timeFirstTokenMs: 300,
      timeCompletionMs: 900,
      timeThinkingMs: 200
    })
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledTimes(1)
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          endpoint: '/topics/:topicId/messages',
          routeParams: { topicId: 'topic-1' },
          entityIds: [messageId]
        })
      ])
    )
  })

  it('persists normalized gateway tokens and computed cost from a flat finish chunk', async () => {
    const capture = createLanguageUsageMiddleware(context())
    const gateway = await getGatewayUsageNormalizeMiddleware()
    const flatFinish = {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        totalTokens: 1_500_000,
        cachedInputTokens: 0
      }
    } as unknown as LanguageModelV3StreamPart
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue(flatFinish)
        controller.close()
      }
    })
    const wrapped = await capture.wrapStream!({
      doStream: () => gateway.wrapStream!({ doStream: async () => ({ stream }) } as never)
    } as never)

    const parts: LanguageModelV3StreamPart[] = []
    for await (const part of wrapped.stream) parts.push(part)

    expect(parts).toHaveLength(1)
    expect(dbh.db.select().from(aiUsageRecordTable).get()).toMatchObject({
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      totalTokens: 1_500_000,
      noCacheTokens: 1_000_000,
      cacheReadTokens: 0,
      cost: 2,
      costCurrency: 'USD',
      costSource: 'computed'
    })
  })

  it('keeps the first payload when a duplicate request id is delivered with different usage', () => {
    aiUsageRecordService.recordInvocation(invocation())
    aiUsageRecordService.recordInvocation(
      invocation({ usage: { inputTokens: 9, outputTokens: 9, totalTokens: 18 }, completedAt: 2_000 })
    )

    const rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ inputTokens: 1_000_000, outputTokens: 500_000, createdAt: 1_000 })
  })

  it('preserves explicit zero cost and groups mixed currencies in a stable message projection', () => {
    aiUsageRecordService.recordInvocations([
      invocation({
        requestId: 'provider-zero',
        context: context({ trustProviderReportedCost: true }),
        providerCost: { amount: 0, currency: 'USD' }
      }),
      invocation({
        requestId: 'computed-cny',
        context: context({
          pricingSnapshot: {
            currency: 'CNY',
            inputPerMillionTokens: 2,
            outputPerMillionTokens: 4,
            capturedAt: '2026-07-28T00:00:00.000Z'
          }
        })
      }),
      invocation({
        requestId: 'unpriced',
        context: context({ pricingSnapshot: null }),
        usage: undefined
      })
    ])

    expect(aiUsageRecordService.getMessageUsageProjection({ kind: 'chat', id: messageId })).toMatchObject({
      requestCount: 3,
      estimatedRequestCount: 0,
      unpricedRequestCount: 1,
      costs: [
        { currency: 'CNY', amount: 4, providerReportedRequestCount: 0, computedRequestCount: 1 },
        { currency: 'USD', amount: 0, providerReportedRequestCount: 1, computedRequestCount: 0 }
      ]
    })
  })

  it('prices cache buckets from the frozen snapshot without charging cached input twice', () => {
    aiUsageRecordService.recordInvocation(
      invocation({
        requestId: 'cache-priced',
        context: context({
          pricingSnapshot: {
            currency: 'USD',
            inputPerMillionTokens: 1,
            cacheReadPerMillionTokens: 0.5,
            outputPerMillionTokens: 2,
            capturedAt: '2026-07-28T00:00:00.000Z'
          }
        }),
        usage: { inputTokens: 1_000_000, cacheReadTokens: 400_000 }
      })
    )

    expect(
      dbh.db.select().from(aiUsageRecordTable).where(eq(aiUsageRecordTable.requestId, 'cache-priced')).get()
    ).toMatchObject({
      cost: 0.8,
      costSource: 'computed',
      costBreakdown: { input: 0.6, cacheRead: 0.2 }
    })
  })

  it('selects an input-token tier below, at, and above its inclusive threshold', () => {
    const pricingSnapshot = {
      currency: 'USD' as const,
      inputPerMillionTokens: 1,
      outputPerMillionTokens: 2,
      inputTokenTiers: [
        {
          minInputTokens: 1_000,
          inputPerMillionTokens: 10,
          outputPerMillionTokens: 20
        },
        {
          minInputTokens: 2_000,
          inputPerMillionTokens: 100,
          outputPerMillionTokens: 200
        }
      ],
      capturedAt: '2026-07-28T00:00:00.000Z'
    }
    aiUsageRecordService.recordInvocations([
      invocation({
        requestId: 'tier-below',
        context: context({ pricingSnapshot }),
        usage: { inputTokens: 999, outputTokens: 100 }
      }),
      invocation({
        requestId: 'tier-equal',
        context: context({ pricingSnapshot }),
        usage: { inputTokens: 1_000, outputTokens: 100 }
      }),
      invocation({
        requestId: 'tier-above',
        context: context({ pricingSnapshot }),
        usage: { inputTokens: 1_001, outputTokens: 100 }
      }),
      invocation({
        requestId: 'highest-tier-equal',
        context: context({ pricingSnapshot }),
        usage: { inputTokens: 2_000, outputTokens: 100 }
      }),
      invocation({
        requestId: 'highest-tier-above',
        context: context({ pricingSnapshot }),
        usage: { inputTokens: 2_001, outputTokens: 100 }
      })
    ])

    const rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows.find((row) => row.requestId === 'tier-below')?.cost).toBeCloseTo(0.001199)
    expect(rows.find((row) => row.requestId === 'tier-equal')?.cost).toBeCloseTo(0.012)
    expect(rows.find((row) => row.requestId === 'tier-above')?.cost).toBeCloseTo(0.01201)
    expect(rows.find((row) => row.requestId === 'highest-tier-equal')?.cost).toBeCloseTo(0.22)
    expect(rows.find((row) => row.requestId === 'highest-tier-above')?.cost).toBeCloseTo(0.2201)
  })

  it('uses the selected tier cache rates and all-in input count without double charging', () => {
    aiUsageRecordService.recordInvocation(
      invocation({
        requestId: 'tier-cache-priced',
        context: context({
          pricingSnapshot: {
            currency: 'USD',
            inputPerMillionTokens: 1,
            outputPerMillionTokens: 2,
            inputTokenTiers: [
              {
                minInputTokens: 1_000,
                inputPerMillionTokens: 10,
                outputPerMillionTokens: 20,
                cacheReadPerMillionTokens: 4,
                cacheWritePerMillionTokens: 6
              }
            ],
            capturedAt: '2026-07-28T00:00:00.000Z'
          }
        }),
        usage: { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 100 }
      })
    )

    const row = dbh.db
      .select()
      .from(aiUsageRecordTable)
      .where(eq(aiUsageRecordTable.requestId, 'tier-cache-priced'))
      .get()
    expect(row?.cost).toBeCloseTo(0.0098)
    expect(row?.costBreakdown).toEqual({ input: 0.006, cacheRead: 0.0012, cacheWrite: 0.0006, output: 0.002 })
  })

  it('derives the tier selection input count from the complete input breakdown', () => {
    aiUsageRecordService.recordInvocation(
      invocation({
        requestId: 'tier-derived-input',
        context: context({
          pricingSnapshot: {
            currency: 'USD',
            inputPerMillionTokens: 1,
            outputPerMillionTokens: 2,
            inputTokenTiers: [
              {
                minInputTokens: 1_000,
                inputPerMillionTokens: 10,
                outputPerMillionTokens: 20,
                cacheReadPerMillionTokens: 4,
                cacheWritePerMillionTokens: 6
              }
            ],
            capturedAt: '2026-07-28T00:00:00.000Z'
          }
        }),
        usage: { outputTokens: 100, noCacheTokens: 600, cacheReadTokens: 300, cacheWriteTokens: 100 }
      })
    )

    const row = dbh.db
      .select()
      .from(aiUsageRecordTable)
      .where(eq(aiUsageRecordTable.requestId, 'tier-derived-input'))
      .get()
    expect(row).toMatchObject({ costCurrency: 'USD', costSource: 'computed' })
    expect(row?.cost).toBeCloseTo(0.0098)
    expect(row?.costBreakdown).toEqual({ input: 0.006, cacheRead: 0.0012, cacheWrite: 0.0006, output: 0.002 })
  })

  it('does not guess the base rate when tiers exist but the all-in input count is missing', () => {
    aiUsageRecordService.recordInvocation(
      invocation({
        requestId: 'tier-missing-input',
        context: context({
          pricingSnapshot: {
            currency: 'USD',
            inputPerMillionTokens: 1,
            outputPerMillionTokens: 2,
            inputTokenTiers: [
              {
                minInputTokens: 1_000,
                inputPerMillionTokens: 10,
                outputPerMillionTokens: 20
              }
            ],
            capturedAt: '2026-07-28T00:00:00.000Z'
          }
        }),
        usage: { outputTokens: 100 }
      })
    )

    expect(
      dbh.db.select().from(aiUsageRecordTable).where(eq(aiUsageRecordTable.requestId, 'tier-missing-input')).get()
    ).toMatchObject({ cost: null, costCurrency: null, costSource: null })
  })

  it('keeps incomplete token pricing, pixel pricing, and untrusted provider cost unpriced', () => {
    aiUsageRecordService.recordInvocations([
      invocation({
        requestId: 'missing-output-price',
        context: context({
          pricingSnapshot: {
            currency: 'USD',
            inputPerMillionTokens: 1,
            capturedAt: '2026-07-28T00:00:00.000Z'
          }
        }),
        usage: { outputTokens: 10 }
      }),
      invocation({
        requestId: 'pixel-image',
        context: context({
          pricingSnapshot: {
            currency: 'USD',
            perImage: { price: 0.000001, unit: 'pixel' },
            capturedAt: '2026-07-28T00:00:00.000Z'
          }
        }),
        modality: 'image',
        usage: undefined,
        imageCount: 2
      }),
      invocation({
        requestId: 'untrusted-provider-cost',
        context: context({ pricingSnapshot: null, trustProviderReportedCost: false }),
        usage: undefined,
        providerCost: { amount: 99, currency: 'USD' }
      })
    ])

    const rows = dbh.db.select().from(aiUsageRecordTable).all()
    for (const requestId of ['missing-output-price', 'pixel-image', 'untrusted-provider-cost']) {
      expect(rows.find((row) => row.requestId === requestId)).toMatchObject({
        cost: null,
        costCurrency: null,
        costSource: null
      })
    }
  })

  it('counts logical requests separately from stored rows in stats and timeline', () => {
    aiUsageRecordService.recordLegacyAggregatesTx(dbh.db, [
      {
        requestId: `legacy:chat:${messageId}`,
        requestCount: 3,
        messageRef: { kind: 'chat', id: messageId },
        usage: { inputTokens: 10, outputTokens: 5 },
        createdAt: 2_000
      }
    ])
    aiUsageRecordService.recordInvocation(invocation())

    const stats = aiUsageRecordService.stats({
      from: 0,
      to: 10_000,
      metric: 'requests',
      groupBy: 'provider',
      limit: 10
    })
    expect(stats.totals).toMatchObject({
      recordCount: 2,
      requestCount: 4,
      estimatedRequestCount: 3,
      unpricedRequestCount: 3
    })
    expect(
      aiUsageRecordService.timeline({
        from: 0,
        to: 10_000,
        metric: 'requests',
        limit: 10
      }).buckets[0]
    ).toMatchObject({ recordCount: 2, requestCount: 4, estimatedRequestCount: 3 })
  })

  it('retains provider and model snapshots after mutable configuration would be renamed or deleted', () => {
    const pricingSnapshot = {
      currency: 'USD' as const,
      perImage: { price: 0.02, unit: 'image' as const },
      capturedAt: '2026-07-28T00:00:00.000Z'
    }
    const frozen = context({ pricingSnapshot })
    pricingSnapshot.perImage.price = 99
    aiUsageRecordService.recordInvocation(invocation({ context: frozen }))

    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.pricingSnapshot?.perImage)).toBe(true)
    expect(dbh.db.select().from(aiUsageRecordTable).get()).toMatchObject({
      providerId: 'provider-1',
      providerName: 'Provider One',
      modelId: 'model-1',
      modelName: 'Model One',
      pricingSnapshot: {
        currency: 'USD',
        perImage: { price: 0.02, unit: 'image' }
      }
    })
  })

  it('captures per-image pricing currency from the frozen token tiers even when token rates are absent', () => {
    expect(
      createAiUsagePricingSnapshot(
        {
          input: { perMillionTokens: null, currency: 'CNY' },
          output: { perMillionTokens: null, currency: 'CNY' },
          perImage: { price: 0.02, unit: 'image' }
        },
        '2026-07-28T00:00:00.000Z'
      )
    ).toEqual({
      currency: 'CNY',
      perImage: { price: 0.02, unit: 'image' },
      capturedAt: '2026-07-28T00:00:00.000Z'
    })
  })

  it('does not invent a currency for tiered pricing without an explicit currency', () => {
    expect(
      createAiUsagePricingSnapshot(
        {
          input: { perMillionTokens: 1 },
          output: { perMillionTokens: 2 },
          inputTokenTiers: [
            {
              minInputTokens: 1_000,
              input: { perMillionTokens: 10 },
              output: { perMillionTokens: 20 }
            }
          ]
        },
        '2026-07-28T00:00:00.000Z'
      )
    ).toBeNull()
  })

  it('inherits the sole explicit currency across partial tier rates', () => {
    expect(
      createAiUsagePricingSnapshot(
        {
          input: { perMillionTokens: 1, currency: 'CNY' },
          output: { perMillionTokens: 2, currency: 'CNY' },
          inputTokenTiers: [
            {
              minInputTokens: 1_000,
              input: { perMillionTokens: 10 },
              output: { perMillionTokens: 20 }
            }
          ]
        },
        '2026-07-28T00:00:00.000Z'
      )
    ).toEqual({
      currency: 'CNY',
      inputPerMillionTokens: 1,
      outputPerMillionTokens: 2,
      inputTokenTiers: [
        {
          minInputTokens: 1_000,
          inputPerMillionTokens: 10,
          outputPerMillionTokens: 20
        }
      ],
      capturedAt: '2026-07-28T00:00:00.000Z'
    })
  })

  it('captures immutable input-token tiers and rejects mixed tier currencies', () => {
    const pricing = {
      input: { perMillionTokens: 1, currency: 'USD' as const },
      output: { perMillionTokens: 2, currency: 'USD' as const },
      inputTokenTiers: [
        {
          minInputTokens: 1_000,
          input: { perMillionTokens: 10, currency: 'USD' as const },
          output: { perMillionTokens: 20, currency: 'USD' as const },
          cacheRead: { perMillionTokens: 4, currency: 'USD' as const }
        }
      ]
    }
    const snapshot = createAiUsagePricingSnapshot(pricing, '2026-07-28T00:00:00.000Z')

    expect(snapshot).toEqual({
      currency: 'USD',
      inputPerMillionTokens: 1,
      outputPerMillionTokens: 2,
      inputTokenTiers: [
        {
          minInputTokens: 1_000,
          inputPerMillionTokens: 10,
          outputPerMillionTokens: 20,
          cacheReadPerMillionTokens: 4
        }
      ],
      capturedAt: '2026-07-28T00:00:00.000Z'
    })
    expect(Object.isFrozen(snapshot?.inputTokenTiers)).toBe(true)
    expect(
      createAiUsagePricingSnapshot(
        {
          ...pricing,
          inputTokenTiers: [
            {
              ...pricing.inputTokenTiers[0],
              output: { perMillionTokens: 20, currency: 'CNY' }
            }
          ]
        },
        '2026-07-28T00:00:00.000Z'
      )
    ).toBeNull()
  })

  it('drops invalid non-integer or non-finite record metrics without disrupting message state', () => {
    aiUsageRecordService.recordInvocation(
      invocation({
        usage: { inputTokens: 1.5, outputTokens: Number.POSITIVE_INFINITY },
        metrics: { timeCompletionMs: Number.NaN }
      })
    )

    expect(dbh.db.select().from(aiUsageRecordTable).all()).toEqual([])
    expect(dbh.db.select().from(messageTable).where(eq(messageTable.id, messageId)).get()?.stats).toEqual({
      timeFirstTokenMs: 300,
      timeCompletionMs: 900,
      timeThinkingMs: 200
    })
  })

  it('keeps provider-cost-only calls and derives per-row total tokens from partial usage', () => {
    aiUsageRecordService.recordInvocations([
      invocation({
        requestId: 'provider-cost-only',
        context: context({ trustProviderReportedCost: true }),
        usage: undefined,
        providerCost: { amount: 0.25, currency: 'USD' }
      }),
      invocation({
        requestId: 'partial-usage',
        context: context({ pricingSnapshot: null }),
        usage: { inputTokens: 7, outputTokens: 3 }
      })
    ])

    expect(aiUsageRecordService.getMessageUsageProjection({ kind: 'chat', id: messageId })).toMatchObject({
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 10,
      requestCount: 2,
      unpricedRequestCount: 1,
      costs: [{ currency: 'USD', amount: 0.25, providerReportedRequestCount: 1, computedRequestCount: 0 }]
    })
  })

  it('projects weighted provider performance from only measurable invocations', () => {
    aiUsageRecordService.recordInvocations([
      invocation({
        requestId: 'measured-step-1',
        usage: { outputTokens: 10 },
        metrics: { timeFirstTokenMs: 100, timeCompletionMs: 1_100 }
      }),
      invocation({
        requestId: 'measured-step-2',
        usage: { outputTokens: 20 },
        metrics: { timeCompletionMs: 2_000 }
      }),
      invocation({
        requestId: 'unmeasured-step',
        usage: { outputTokens: 30 },
        metrics: undefined
      })
    ])

    expect(aiUsageRecordService.getMessageUsageProjection({ kind: 'chat', id: messageId })).toMatchObject({
      outputTokens: 60,
      providerPerformance: {
        measuredOutputTokens: 30,
        generationDurationMs: 3_000
      }
    })
  })

  it('uses the same TTFT fallback expression for TPS ordering and keyset cursors', () => {
    aiUsageRecordService.recordInvocations([
      invocation({
        requestId: 'tps-20',
        usage: { outputTokens: 10 },
        metrics: { timeFirstTokenMs: 500, timeCompletionMs: 1_000 },
        completedAt: 1_001
      }),
      invocation({
        requestId: 'tps-30-fallback',
        usage: { outputTokens: 30 },
        metrics: { timeCompletionMs: 1_000 },
        completedAt: 1_002
      }),
      invocation({
        requestId: 'tps-100',
        usage: { outputTokens: 10 },
        metrics: { timeFirstTokenMs: 900, timeCompletionMs: 1_000 },
        completedAt: 1_003
      }),
      invocation({
        requestId: 'tps-null-output',
        usage: undefined,
        metrics: { timeCompletionMs: 1_000 },
        completedAt: 1_004
      }),
      invocation({
        requestId: 'tps-null-duration',
        usage: { outputTokens: 10 },
        metrics: undefined,
        completedAt: 1_005
      })
    ])

    const requestIds: string[] = []
    let cursor: string | undefined
    do {
      const page = aiUsageRecordService.list({
        limit: 2,
        sortBy: 'tokensPerSecond',
        sortOrder: 'desc',
        cursor
      })
      requestIds.push(...page.items.map((item) => item.requestId))
      cursor = page.nextCursor
    } while (cursor)

    expect(requestIds.slice(0, 3)).toEqual(['tps-100', 'tps-30-fallback', 'tps-20'])
    expect(requestIds).toHaveLength(5)
    expect(new Set(requestIds).size).toBe(5)
  })

  it('filters one message while preserving keyset pagination', () => {
    aiUsageRecordService.recordInvocations([
      invocation({ requestId: 'message-page-1', completedAt: 3_001 }),
      invocation({ requestId: 'message-page-2', completedAt: 3_002 }),
      invocation({
        requestId: 'different-message',
        context: context({ messageRef: { kind: 'chat', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }),
        completedAt: 3_003
      })
    ])

    const first = aiUsageRecordService.list({
      limit: 1,
      sortBy: 'createdAt',
      sortOrder: 'asc',
      messageKind: 'chat',
      messageId
    })
    const second = aiUsageRecordService.list({
      limit: 1,
      sortBy: 'createdAt',
      sortOrder: 'asc',
      messageKind: 'chat',
      messageId,
      cursor: first.nextCursor
    })

    expect(first.total).toBe(2)
    expect(first.items.map((item) => item.requestId)).toEqual(['message-page-1'])
    expect(second.items.map((item) => item.requestId)).toEqual(['message-page-2'])
    expect(second.nextCursor).toBeUndefined()
  })

  it('uses derived total tokens consistently for ordering and keyset cursors', () => {
    aiUsageRecordService.recordInvocations([
      invocation({
        requestId: 'tokens-derived-120',
        context: context({ messageRef: null, pricingSnapshot: null }),
        usage: { inputTokens: 100, outputTokens: 20 },
        completedAt: 2_001
      }),
      invocation({
        requestId: 'tokens-explicit-100',
        context: context({ messageRef: null, pricingSnapshot: null }),
        usage: { totalTokens: 100 },
        completedAt: 2_002
      }),
      invocation({
        requestId: 'tokens-unknown',
        context: context({ messageRef: null, pricingSnapshot: null }),
        usage: undefined,
        completedAt: 2_003
      })
    ])

    const requestIds: string[] = []
    let cursor: string | undefined
    do {
      const page = aiUsageRecordService.list({
        limit: 1,
        sortBy: 'totalTokens',
        sortOrder: 'desc',
        cursor
      })
      requestIds.push(...page.items.map((item) => item.requestId))
      cursor = page.nextCursor
    } while (cursor)

    expect(requestIds).toEqual(['tokens-derived-120', 'tokens-explicit-100', 'tokens-unknown'])
  })

  it('merges continuation timing without replacing record-owned performance or retaining scalar timing', () => {
    const merged = mergeMessageRuntimeStats(
      {
        outputTokens: 20,
        providerPerformance: { measuredOutputTokens: 20, generationDurationMs: 500 },
        timeFirstTokenMs: 100,
        runtimeTiming: {
          startedAt: 1_000,
          spans: [
            {
              id: 'tool:first',
              kind: 'tool-execution',
              toolCallId: 'first',
              startedAt: 1_500,
              completedAt: 2_000
            }
          ]
        }
      },
      {
        contextTokens: 321,
        runtimeTiming: {
          startedAt: 1_000,
          completedAt: 4_000,
          spans: [
            {
              id: 'tool:second',
              kind: 'tool-execution',
              toolCallId: 'second',
              startedAt: 3_000,
              completedAt: 3_500
            }
          ]
        }
      }
    )

    expect(merged).toMatchObject({
      outputTokens: 20,
      providerPerformance: { measuredOutputTokens: 20, generationDurationMs: 500 },
      contextTokens: 321,
      runtimeTiming: {
        startedAt: 1_000,
        completedAt: 4_000,
        spans: [{ id: 'tool:first' }, { id: 'tool:second' }]
      }
    })
    expect(merged).not.toHaveProperty('timeFirstTokenMs')
    expect(merged).not.toHaveProperty('timeCompletionMs')
  })
})
