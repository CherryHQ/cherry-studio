import '@data/services/ProviderRegistryService'
import { resolve } from 'node:path'

import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { tool, type UIMessageChunk } from 'ai'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { application } from '@application'
import { aiUsageRecordHandlers } from '@data/api/handlers/aiUsageRecords'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { ProviderBilling } from '@shared/data/types/providerBilling'

import { AiService } from '../AiService'
import type * as CustomFetchModule from '../utils/customFetch'

const { transport } = vi.hoisted(() => ({ transport: vi.fn<typeof fetch>() }))
vi.mock('../utils/customFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof CustomFetchModule>()),
  customFetch: transport
}))

const billing: ProviderBilling = {
  defaultMultiplier: 2,
  scheduleEnabled: true,
  timeZone: '+08:00',
  periods: [{ id: 'night', name: '22:00–06:00', start: '22:00', end: '06:00', mode: 'multiplier', multiplier: 0.5 }]
}
const pricing = {
  input: { perMillionTokens: 2, currency: 'USD' as const },
  output: { perMillionTokens: 6, currency: 'USD' as const }
}
const request = {
  uniqueModelId: 'billing-group::model' as const,
  conversation: { id: 'billing-test' },
  contextOwner: 'caller' as const,
  apiKeyOverride: 'test-only-key',
  prompt: 'Return ok',
  requestOptions: { maxRetries: 0 }
}

function completion(
  usage: Record<string, unknown> = { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 }
) {
  return Response.json({
    id: 'billing-completion',
    object: 'chat.completion',
    created: 1,
    model: 'model',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage
  })
}

function cacheCompletion(usage: Record<string, unknown>, mode: 'generate' | 'stream') {
  if (mode === 'generate') return completion(usage)
  const chunks = [
    { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage }
  ]
  return new Response(
    chunks
      .map(
        (chunk) =>
          `data: ${JSON.stringify({ id: 'cache-test', object: 'chat.completion.chunk', created: 1, model: 'model', ...chunk })}\n\n`
      )
      .join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } }
  )
}

describe('provider billing through AiService and the real SDK', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      key === 'feature.provider_registry.data'
        ? resolve('packages/provider-registry/data', filename ?? '')
        : key === 'app.root'
          ? resolve(filename ?? '')
          : getPath(key, filename)
    )
    transport.mockReset()
    MockMainPreferenceServiceUtils.resetMocks()
    BaseService.resetInstances()
    vi.useFakeTimers({ toFake: ['Date'] })
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'billing-group',
        name: 'Billing group',
        orderKey: 'a0',
        isEnabled: true,
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://billing.test/v1' } },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        providerSettings: { billing }
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'billing-group::model',
        providerId: 'billing-group',
        modelId: 'model',
        name: 'Model',
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
        supportsStreaming: true,
        isEnabled: true,
        pricing,
        orderKey: 'a0'
      })
      .run()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each(['generate', 'stream'] as const)(
    'retains nested cache accounting through %s, journal analytics and projections',
    async (mode) => {
      vi.setSystemTime(new Date('2026-11-16T12:00:00Z'))
      providerService.update('billing-group', {
        providerSettings: { billing: { defaultMultiplier: 1, scheduleEnabled: false, timeZone: 'UTC', periods: [] } }
      })
      dbh.db
        .update(userModelTable)
        .set({
          pricing: {
            ...pricing,
            cacheRead: { perMillionTokens: 0.2, currency: 'USD' },
            cacheWrite: { perMillionTokens: 2.5, currency: 'USD' }
          }
        })
        .where(eq(userModelTable.id, request.uniqueModelId))
        .run()
      const messageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      const messageTiming = { timeFirstTokenMs: 300, timeCompletionMs: 900, timeThinkingMs: 200 }
      dbh.db.insert(topicTable).values({ id: 'cache-topic', orderKey: 'a0' }).run()
      dbh.db
        .insert(messageTable)
        .values(
          withRoot('cache-topic', [
            {
              id: messageId,
              topicId: 'cache-topic',
              parentId: null,
              role: 'assistant',
              data: { parts: [] },
              status: 'success',
              stats: messageTiming,
              createdAt: Date.now(),
              updatedAt: Date.now()
            }
          ])
        )
        .run()
      const service = new (AiService as unknown as new () => AiService)()
      for (const details of [{ cache_creation_tokens: 155712 }, { cache_read_tokens: 155712 }]) {
        transport.mockImplementationOnce(async () =>
          cacheCompletion(
            {
              prompt_tokens: 155720,
              completion_tokens: 20,
              total_tokens: 155740,
              prompt_tokens_details: details
            },
            mode
          )
        )
        if (mode === 'generate') {
          expect((await service.generateText(request)).text).toBe('ok')
        } else {
          const result = await service.streamText({
            ...request,
            messageId,
            trigger: 'submit-message',
            conversation: { id: 'cache-topic', topicId: 'cache-topic' },
            messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Return ok' }] }],
            requestOptions: { maxRetries: 0, signal: new AbortController().signal }
          })
          if (result.kind !== 'chunks') throw new Error('Expected provider chunks')
          const chunks: UIMessageChunk[] = []
          for await (const chunk of result.stream) chunks.push(chunk)
          expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'ok' }))
        }
      }

      const rows = dbh.db.select().from(aiUsageRecordTable).all()
      expect(rows).toHaveLength(2)
      expect(rows[0]).toMatchObject({
        noCacheTokens: 8,
        cacheReadTokens: 0,
        cacheWriteTokens: 155712,
        cost: expect.closeTo(0.389416, 12),
        costCurrency: 'USD',
        costSource: 'computed',
        costBreakdown: { input: 0.000016, cacheWrite: 0.38928, output: 0.00012 },
        pricingSnapshot: {
          inputPerMillionTokens: 2,
          cacheReadPerMillionTokens: 0.2,
          cacheWritePerMillionTokens: 2.5,
          outputPerMillionTokens: 6,
          billing: { multiplier: 1 }
        }
      })
      expect(rows[1]).toMatchObject({
        noCacheTokens: 8,
        cacheReadTokens: 155712,
        cacheWriteTokens: null,
        cost: expect.closeTo(0.0312784, 12),
        costCurrency: 'USD',
        costSource: 'computed',
        costBreakdown: { input: 0.000016, cacheRead: expect.closeTo(0.0311424, 12), output: 0.00012 }
      })
      const query = {
        from: Date.now() - 1000,
        to: Date.now() + 1000,
        metric: 'cost',
        currency: 'USD',
        groupBy: 'provider',
        limit: 10
      } as const
      const statsResult = await aiUsageRecordHandlers['/ai-usage-records/stats'].GET({ query })
      const stats = 'data' in statsResult ? statsResult.data : statsResult
      expect(stats.totals).toMatchObject({
        requestCount: 2,
        totalNoCacheTokens: 16,
        totalCacheReadTokens: 155712,
        totalCacheWriteTokens: 155712,
        totalCost: expect.closeTo(0.4206944, 12)
      })
      const timelineResult = await aiUsageRecordHandlers['/ai-usage-records/timeline'].GET({ query })
      const timeline = 'data' in timelineResult ? timelineResult.data : timelineResult
      expect(timeline.buckets).toHaveLength(1)
      expect(timeline.buckets[0]).toMatchObject({
        totalCost: expect.closeTo(0.4206944, 12),
        totalCacheReadTokens: 155712,
        totalCacheWriteTokens: 155712
      })
      if (mode === 'stream') {
        expect(rows.map((row) => [row.messageKind, row.messageId])).toEqual([
          ['chat', messageId],
          ['chat', messageId]
        ])
        const message = dbh.db.select().from(messageTable).where(eq(messageTable.id, messageId)).get()
        expect(message?.stats).toMatchObject({
          ...messageTiming,
          inputTokens: 311440,
          outputTokens: 40,
          totalTokens: 311480,
          requestCount: 2,
          inputTokenDetails: { noCacheTokens: 16, cacheReadTokens: 155712, cacheWriteTokens: 155712 },
          costs: [
            {
              currency: 'USD',
              amount: expect.closeTo(0.4206944, 12),
              computedRequestCount: 2,
              providerReportedRequestCount: 0
            }
          ]
        })
      }

      aiUsageRecordService.recordInvocation({
        requestId: rows[0].requestId,
        context: createAiUsageCaptureContext({
          providerId: 'billing-group',
          modelId: 'model',
          pricingSnapshot: rows[0].pricingSnapshot
        }),
        modality: 'language',
        usage: { inputTokens: 155720, noCacheTokens: 155720, cacheWriteTokens: 0, outputTokens: 20 },
        completedAt: Date.now()
      })
      expect(dbh.db.select().from(aiUsageRecordTable).all()).toEqual(rows)
    }
  )

  it.each([0, 0.42])('keeps trusted provider cost %s ahead of computed cache pricing', async (cost) => {
    dbh.db
      .update(userProviderTable)
      .set({
        presetProviderId: 'openrouter'
      })
      .where(eq(userProviderTable.providerId, 'billing-group'))
      .run()
    expect(providerService.getByProviderId('billing-group').reportsActualCost).toBe(true)
    transport.mockImplementationOnce(async () =>
      completion({
        prompt_tokens: 155720,
        completion_tokens: 20,
        total_tokens: 155740,
        prompt_tokens_details: { cached_tokens: 0, cache_creation_tokens: 155712 },
        cost,
        currency: 'USD'
      })
    )
    const service = new (AiService as unknown as new () => AiService)()
    await service.generateText(request)

    expect(dbh.db.select().from(aiUsageRecordTable).get()).toMatchObject({
      noCacheTokens: 8,
      cacheWriteTokens: 155712,
      cost,
      costCurrency: 'USD',
      costSource: 'provider',
      costBreakdown: null
    })
  })

  it('leaves the whole cost tuple null when a nonzero write has no effective rate', async () => {
    dbh.db
      .update(userModelTable)
      .set({ pricing: { input: { perMillionTokens: null, currency: 'USD' }, output: pricing.output } })
      .where(eq(userModelTable.id, request.uniqueModelId))
      .run()
    transport.mockImplementationOnce(async () =>
      completion({
        prompt_tokens: 155712,
        completion_tokens: 20,
        prompt_tokens_details: { cache_creation_tokens: 155712 }
      })
    )
    const service = new (AiService as unknown as new () => AiService)()
    await service.generateText(request)

    expect(dbh.db.select().from(aiUsageRecordTable).get()).toMatchObject({
      noCacheTokens: 0,
      cacheWriteTokens: 155712,
      cost: null,
      costCurrency: null,
      costSource: null,
      costBreakdown: null
    })
  })

  it('automatically prices official requests, freezes the boundary, and preserves user overrides', async () => {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'deepseek',
        presetProviderId: 'deepseek',
        name: 'DeepSeek',
        orderKey: 'a1',
        isEnabled: true,
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.deepseek.com' } }
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'deepseek::deepseek-flash',
        providerId: 'deepseek',
        modelId: 'deepseek-flash',
        presetModelId: 'deepseek-flash',
        orderKey: 'a1',
        isEnabled: true,
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      })
      .run()
    const service = new (AiService as unknown as new () => AiService)()
    const officialRequest = { ...request, uniqueModelId: 'deepseek::deepseek-flash' as const }
    vi.setSystemTime(new Date('2026-11-16T11:59:59+08:00'))
    transport
      .mockImplementationOnce(async () => {
        vi.setSystemTime(new Date('2026-11-16T12:00:01+08:00'))
        return completion()
      })
      .mockImplementation(async () => completion())
    await service.generateText(officialRequest)
    await service.generateText(officialRequest)
    let rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows.map((row) => row.cost).sort()).toEqual([expect.closeTo(0.00075, 12), expect.closeTo(0.0015, 12)])
    expect(rows.map((row) => row.pricingSnapshot?.billing?.multiplier).sort()).toEqual([0.5, 1])
    expect(providerService.getByProviderId('deepseek').settings.billing).toBeUndefined()

    providerService.update('deepseek', {
      providerSettings: { billing: { defaultMultiplier: 2, scheduleEnabled: false, timeZone: '+08:00', periods: [] } }
    })
    await service.generateText(officialRequest)
    expect(
      dbh.db
        .select()
        .from(aiUsageRecordTable)
        .all()
        .map((row) => row.cost)
    ).toEqual(expect.arrayContaining([expect.closeTo(0.003, 12)]))
    providerService.update('deepseek', { providerSettings: { billing: null } })
    dbh.db.update(userModelTable).set({ pricing }).where(eq(userModelTable.id, 'deepseek::deepseek-flash')).run()
    expect(modelService.getByKey('deepseek', 'deepseek-flash').hasCustomPricing).toBe(true)
    await service.generateText(officialRequest)
    rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows.map((row) => row.cost)).toContain(0.008)
    expect(rows.filter((row) => row.pricingSnapshot?.billing?.source === 'deepseek')).toHaveLength(2)
  })

  it('uses frozen peak pricing when invocation time is unknown while preserving trusted reported costs', () => {
    vi.setSystemTime(new Date('2026-10-11T23:00:00+08:00'))
    const provider = providerService.getByProviderId('billing-group')
    const model = modelService.getByKey('billing-group', 'model')
    const context = createAiUsageCaptureContext({
      providerId: provider.id,
      modelId: model.id,
      pricing: model.pricing,
      billing: provider.settings?.billing,
      invocationStartedAt: null,
      trustProviderReportedCost: true,
      reportedCostCurrency: 'USD'
    })
    providerService.update('billing-group', { providerSettings: { billing: { defaultMultiplier: 100 } } })
    for (const providerCost of [undefined, { amount: 0.7, currency: 'USD' as const }]) {
      aiUsageRecordService.recordInvocation({
        requestId: providerCost ? 'unknown-time:reported' : 'unknown-time:computed',
        context,
        modality: 'language',
        usage: { inputTokens: 1000, outputTokens: 1000 },
        providerCost,
        completedAt: Date.now()
      })
    }
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toMatchObject([
      { cost: 0.016, costSource: 'computed', pricingSnapshot: { billing: { reason: 'peak_fallback', multiplier: 2 } } },
      { cost: 0.7, costSource: 'provider', costCurrency: 'USD' }
    ])
    expect(context.pricingSnapshot?.billing?.pricedAt).toBeUndefined()
  })

  it('keeps request-start prices across midnight and configuration changes', async () => {
    const service = new (AiService as unknown as new () => AiService)()
    vi.setSystemTime(new Date('2026-10-11T21:59:59.999+08:00'))
    transport.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-10-12T00:00:01+08:00'))
      providerService.update('billing-group', { providerSettings: { billing: { defaultMultiplier: 10 } } })
      return completion()
    })
    expect((await service.generateText(request)).text).toBe('ok')
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toMatchObject([
      {
        cost: 0.016,
        costSource: 'computed',
        pricingSnapshot: { billing: { multiplier: 2, pricedAt: '2026-10-11T13:59:59.999Z' } }
      }
    ])
  })

  it('keeps streaming costs frozen until the finish event after midnight', async () => {
    const service = new (AiService as unknown as new () => AiService)()
    vi.setSystemTime(new Date('2026-10-11T23:59:59.999+08:00'))
    transport.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-10-12T06:00:01+08:00'))
      const chunks = [
        { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: null }] },
        {
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 }
        }
      ]
      return new Response(
        chunks
          .map(
            (chunk) =>
              `data: ${JSON.stringify({ id: 'stream-test', object: 'chat.completion.chunk', created: 1, model: 'model', ...chunk })}\n\n`
          )
          .join('') + 'data: [DONE]\n\n',
        {
          headers: { 'content-type': 'text/event-stream' }
        }
      )
    })
    const stream = await service.streamText({
      ...request,
      trigger: 'submit-message',
      conversation: { id: 'stream-test', topicId: 'stream-test' },
      messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Return ok' }] }],
      requestOptions: { maxRetries: 0, signal: new AbortController().signal }
    })
    const chunks: UIMessageChunk[] = []
    if (stream.kind !== 'chunks') throw new Error('Expected provider chunks')
    for await (const chunk of stream.stream) chunks.push(chunk)
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'ok' }))
    const rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      cost: 0.004,
      costSource: 'computed',
      pricingSnapshot: { billing: { multiplier: 0.5 } }
    })
  })

  it('reprices the next tool-loop invocation at the hour boundary', async () => {
    const service = new (AiService as unknown as new () => AiService)()
    vi.setSystemTime(new Date('2026-10-11T21:59:59.999+08:00'))
    transport
      .mockImplementationOnce(async () => {
        const body = await completion().json()
        return Response.json({
          ...body,
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [{ id: 'call-next', type: 'function', function: { name: 'next', arguments: '{}' } }]
              }
            }
          ]
        })
      })
      .mockImplementationOnce(async (_url, init) => {
        expect(JSON.parse(String(init?.body)).messages).toContainEqual(
          expect.objectContaining({ role: 'tool', content: 'Continue' })
        )
        return completion()
      })
    const result = await service.generateText({
      ...request,
      contextOwner: 'cherry',
      callOverrides: {
        tools: {
          next: tool({
            inputSchema: z.object({}),
            execute: async () => {
              vi.setSystemTime(new Date('2026-10-11T22:00:00+08:00'))
              return 'Continue'
            }
          })
        }
      }
    })
    expect(result.text).toBe('ok')
    expect(
      dbh.db
        .select()
        .from(aiUsageRecordTable)
        .all()
        .map((row) => row.cost)
    ).toEqual([0.016, 0.004])
  })

  it('uses the fallback provider multiplier after a failed primary call without duplicate records', async () => {
    const service = new (AiService as unknown as new () => AiService)()
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'fallback-group',
        name: 'Fallback',
        orderKey: 'a1',
        isEnabled: true,
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://fallback.test/v1' } },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        providerSettings: { billing: { ...billing, scheduleEnabled: false, defaultMultiplier: 3 } }
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'fallback-group::fallback',
        providerId: 'fallback-group',
        modelId: 'fallback',
        name: 'Fallback',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        pricing,
        orderKey: 'a0'
      })
      .run()
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'chat.retry.enabled': true,
      'chat.retry.max_attempts': 1,
      'chat.retry.fallback_model_ids': ['fallback-group::fallback']
    })
    vi.setSystemTime(new Date('2026-10-11T21:59:59.999+08:00'))
    transport
      .mockImplementationOnce(async () => {
        vi.setSystemTime(new Date('2026-10-11T22:00:00+08:00'))
        return Response.json(
          { error: { message: 'Primary unavailable', type: 'invalid_request_error' } },
          { status: 400 }
        )
      })
      .mockImplementationOnce(async (url) => {
        expect(String(url)).toContain('fallback.test')
        return completion()
      })
    expect((await service.generateText({ ...request, contextOwner: 'cherry', requestOptions: {} })).text).toBe('ok')
    const rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      providerId: 'fallback-group',
      modelId: 'fallback',
      cost: 0.024,
      pricingSnapshot: { billing: { multiplier: 3 } }
    })
  })
})
