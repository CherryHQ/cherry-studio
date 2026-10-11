import '@data/services/ProviderRegistryService'
import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { tool, type UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { application } from '@application'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { buildDshProviderInjection } from '@main/ai/runtime/dsh/modelInjection'
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

function completion() {
  return Response.json({
    id: 'billing-completion',
    object: 'chat.completion',
    created: 1,
    model: 'model',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 }
  })
}

describe('provider billing through AiService and the real SDK', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      key === 'feature.provider_registry.data'
        ? resolve('packages/provider-registry/data', filename ?? '')
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

  it('records DSH usage with its frozen peak estimate even when completion is in the valley', () => {
    vi.setSystemTime(new Date('2026-10-11T23:00:00+08:00'))
    const injection = buildDshProviderInjection(
      providerService.getByProviderId('billing-group'),
      modelService.getByKey('billing-group', 'model'),
      'test-only-key'
    )
    const capture = injection.usageCapture
    if (capture.owner !== 'agent-sdk') throw new Error('Expected direct SDK capture')
    providerService.update('billing-group', { providerSettings: { billing: { defaultMultiplier: 100 } } })
    aiUsageRecordService.recordInvocation({
      requestId: 'dsh:peak-test',
      context: createAiUsageCaptureContext({
        providerId: capture.providerId,
        modelId: capture.frozenModels[0].modelId,
        pricingSnapshot: capture.frozenModels[0].pricingSnapshot
      }),
      modality: 'language',
      usage: { inputTokens: 1000, outputTokens: 1000 },
      completedAt: Date.now()
    })
    const [record] = dbh.db.select().from(aiUsageRecordTable).all()
    expect(record).toMatchObject({
      cost: 0.016,
      costSource: 'computed',
      costCurrency: 'USD',
      pricingSnapshot: { billing: { reason: 'peak_fallback', multiplier: 2 } }
    })
    expect(record.pricingSnapshot?.billing?.pricedAt).toBeUndefined()
  })

  it('uses saved billing at invocation start and preserves costs across midnight and configuration changes', async () => {
    const service = new (AiService as unknown as new () => AiService)()
    for (const [start, end, expected] of [
      ['2026-10-11T21:59:59.999+08:00', '2026-10-11T22:00:01+08:00', 0.016],
      ['2026-10-11T22:00:00+08:00', '2026-10-12T00:00:01+08:00', 0.004],
      ['2026-10-12T05:59:59.999+08:00', '2026-10-12T06:00:01+08:00', 0.004],
      ['2026-10-12T06:00:00+08:00', '2026-10-12T06:00:01+08:00', 0.016]
    ] as const) {
      providerService.update('billing-group', { providerSettings: { billing } })
      vi.setSystemTime(new Date(start))
      transport.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date(end))
        providerService.update('billing-group', {
          providerSettings: { billing: { defaultMultiplier: 10, periods: [] } }
        })
        return completion()
      })
      const result = await service.generateText(request)
      expect(result.text).toBe('ok')
      const row = dbh.db.select().from(aiUsageRecordTable).all().at(-1)!
      expect(row.cost).toBeCloseTo(expected)
      expect(row.costSource).toBe('computed')
      expect(row.pricingSnapshot?.billing?.pricedAt).toBe(new Date(start).toISOString())
    }
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(4)
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
    for await (const chunk of stream) chunks.push(chunk)
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
    expect((await service.generateText({ ...request, requestOptions: {} })).text).toBe('ok')
    const rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      providerId: 'fallback-group',
      modelId: 'fallback',
      cost: 0.024,
      pricingSnapshot: { billing: { multiplier: 3 } }
    })
  })

  it('reprices a transient retry at its own start and records only its successful usage', async () => {
    const service = new (AiService as unknown as new () => AiService)()
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'chat.retry.enabled': true,
      'chat.retry.max_attempts': 1,
      'chat.retry.backoff_enabled': false
    })
    vi.setSystemTime(new Date('2026-10-11T21:59:59.999+08:00'))
    transport
      .mockImplementationOnce(async () => {
        vi.setSystemTime(new Date('2026-10-11T22:00:00+08:00'))
        return Response.json({ error: { message: 'Retry', type: 'server_error' } }, { status: 503 })
      })
      .mockImplementationOnce(async () => completion())
    expect((await service.generateText({ ...request, requestOptions: {} })).text).toBe('ok')
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toMatchObject([
      { cost: 0.004, pricingSnapshot: { billing: { multiplier: 0.5, pricedAt: '2026-10-11T14:00:00.000Z' } } }
    ])
  })

  it('applies billing to embedding usage at the provider-call boundary', async () => {
    const service = new (AiService as unknown as new () => AiService)()
    vi.setSystemTime(new Date('2026-10-11T22:00:00+08:00'))
    transport.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-10-12T06:00:00+08:00'))
      return Response.json({
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [1, 2] }],
        model: 'model',
        usage: { prompt_tokens: 1000, total_tokens: 1000 }
      })
    })
    const result = await service.embedMany({ ...request, values: ['test'] })
    expect(result.embeddings).toEqual([[1, 2]])
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toMatchObject([
      { modality: 'embedding', inputTokens: 1000, cost: 0.001, pricingSnapshot: { billing: { multiplier: 0.5 } } }
    ])
  })

  it('records cache and tier prices matching the preview without double counting cached input', async () => {
    const service = new (AiService as unknown as new () => AiService)()
    modelService.update('billing-group', 'model', {
      pricing: {
        ...pricing,
        cacheRead: { perMillionTokens: 0.4, currency: 'USD' },
        inputTokenTiers: [
          {
            minInputTokens: 200000,
            input: { perMillionTokens: 4, currency: 'USD' },
            output: { perMillionTokens: 12, currency: 'USD' }
          }
        ]
      }
    })
    vi.setSystemTime(new Date('2026-10-11T22:00:00+08:00'))
    for (const inputTokens of [100000, 200000]) {
      transport.mockImplementationOnce(async () =>
        Response.json({
          ...(await completion().json()),
          usage: {
            prompt_tokens: inputTokens,
            completion_tokens: 10000,
            total_tokens: inputTokens + 10000,
            prompt_tokens_details: { cached_tokens: 40000 }
          }
        })
      )
      expect((await service.generateText(request)).text).toBe('ok')
    }
    const rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows.map((row) => row.cost)).toEqual([0.098, 0.46])
    expect(rows[0].costBreakdown).toMatchObject({ input: 0.06, cacheRead: 0.008, output: 0.03 })
    expect(rows[1].costBreakdown).toMatchObject({ input: 0.32, cacheRead: 0.08, output: 0.06 })
  })
})
