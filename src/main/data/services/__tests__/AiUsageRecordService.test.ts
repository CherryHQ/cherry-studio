import { resolve } from 'node:path'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { aiUsageRecordService } from '@data/services/aiUsageRecord'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { Message } from '@shared/data/types/message'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({
  notifyDataApiDataChangeMock: vi.fn()
}))

vi.mock('@data/dataApiDataChange', () => ({
  notifyDataApiDataChange: notifyDataApiDataChangeMock
}))

const DEFAULT_AGGREGATE_QUERY = {
  from: 0,
  to: Number.MAX_SAFE_INTEGER,
  metric: 'tokens',
  limit: 10
} as const

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    topicId: 'topic-1',
    parentId: null,
    role: 'assistant',
    data: { parts: [] },
    searchableText: '',
    status: 'success',
    siblingsGroupId: 0,
    modelId: 'openai::gpt-4o',
    stats: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      inputTokenDetails: { noCacheTokens: 60, cacheReadTokens: 30, cacheWriteTokens: 10 },
      cost: 0.0042,
      costCurrency: 'USD',
      costSource: 'computed',
      timeFirstTokenMs: 250,
      timeCompletionMs: 1250,
      timeThinkingMs: 100
    },
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
    ...overrides
  } as Message
}

async function seedAssistantTopic() {
  await application
    .get('DbService')
    .getDb()
    .insert(assistantTable)
    .values({
      id: 'assistant-1',
      name: 'Test Assistant',
      prompt: '',
      emoji: '🌟',
      settings: DEFAULT_ASSISTANT_SETTINGS,
      orderKey: generateOrderKeyBetween(null, null)
    })
  await application
    .get('DbService')
    .getDb()
    .insert(topicTable)
    .values({
      id: 'topic-1',
      assistantId: 'assistant-1',
      activeNodeId: null,
      orderKey: generateOrderKeyBetween(null, null)
    })
}

async function seedAgentSession() {
  await application
    .get('DbService')
    .getDb()
    .insert(agentTable)
    .values({
      id: 'agent-1',
      type: 'claude_code',
      name: 'Test Agent',
      instructions: '',
      model: null,
      configuration: { avatar: '🧠' },
      orderKey: generateOrderKeyBetween(null, null)
    })
  await application
    .get('DbService')
    .getDb()
    .insert(agentWorkspaceTable)
    .values({
      id: 'workspace-1',
      name: 'Test Workspace',
      path: '/tmp/test-workspace',
      type: 'user',
      orderKey: generateOrderKeyBetween(null, null)
    })
  await application
    .get('DbService')
    .getDb()
    .insert(agentSessionTable)
    .values({
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Test Session',
      workspaceId: 'workspace-1',
      orderKey: generateOrderKeyBetween(null, null)
    })
}

async function seedProvider(
  apiKeys: Array<{ id: string; key: string; label?: string; isEnabled: boolean }>,
  opts?: {
    providerId?: string
    authConfig?: { type: string } & Record<string, unknown>
    reportsActualCost?: boolean
  }
) {
  await application
    .get('DbService')
    .getDb()
    .insert(userProviderTable)
    .values({
      providerId: opts?.providerId ?? 'openai',
      name: 'Test Provider',
      orderKey: generateOrderKeyBetween(null, null),
      apiKeys,
      ...(opts?.authConfig ? { authConfig: opts.authConfig as never } : {}),
      ...(opts?.reportsActualCost !== undefined ? { apiFeatures: { reportsActualCost: opts.reportsActualCost } } : {})
    })
}

function localDateKey(value: number): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

describe('AiUsageRecordService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainCacheServiceUtils.resetMocks()
    notifyDataApiDataChangeMock.mockClear()
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.provider_registry.data' && filename) {
        return resolve('packages/provider-registry/data', filename)
      }
      return filename ? `/mock/${key}/${filename}` : `/mock/${key}`
    })
  })

  describe('recordFromMessage', () => {
    it('records token usage and cost, deriving providerId from modelId', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', label: 'Main', isEnabled: true }])
      await seedAssistantTopic()

      await aiUsageRecordService.recordFromMessage(makeMessage())

      const rows = await dbh.db.select().from(aiUsageRecordTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        topicId: 'topic-1',
        providerId: 'openai',
        providerName: 'Test Provider',
        sourceType: 'assistant',
        sourceId: 'assistant-1',
        sourceName: 'Test Assistant',
        sourceIcon: '🌟',
        modelId: 'openai::gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        noCacheTokens: 60,
        cacheReadTokens: 30,
        cacheWriteTokens: 10,
        cost: 0.0042,
        costCurrency: 'USD',
        costSource: 'computed',
        timeFirstTokenMs: 250,
        timeCompletionMs: 1250,
        timeThinkingMs: 100
      })
    })

    it('upserts by requestId — re-persists replace with cumulative totals', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])

      await aiUsageRecordService.recordFromMessage(makeMessage({ stats: { inputTokens: 10, outputTokens: 5 } }))
      await aiUsageRecordService.recordFromMessage(
        makeMessage({ stats: { inputTokens: 40, outputTokens: 20, totalTokens: 60 } })
      )

      const rows = await dbh.db.select().from(aiUsageRecordTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ inputTokens: 40, outputTokens: 20, totalTokens: 60 })
    })

    it.each([
      ['user role', makeMessage({ role: 'user' })],
      ['no usage signal', makeMessage({ stats: { timeCompletionMs: 100 } })],
      ['no stats', makeMessage({ stats: null })],
      ['no modelId', makeMessage({ modelId: null })]
    ])('skips messages with %s', async (_name, message) => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])

      await aiUsageRecordService.recordFromMessage(message)

      expect(await dbh.db.select().from(aiUsageRecordTable)).toHaveLength(0)
    })

    it('preserves an exact key attribution on re-persists while updating usage', async () => {
      // First persist: single enabled key → exact attribution.
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', label: 'Main', isEnabled: true }])
      await aiUsageRecordService.recordFromMessage(makeMessage({ stats: { inputTokens: 10, outputTokens: 5 } }))

      // Second persist resolves to 'none' (simulates pointer lost on restart):
      // wipe the provider so attribution degrades.
      await dbh.db.delete(userProviderTable)
      await aiUsageRecordService.recordFromMessage(makeMessage({ stats: { inputTokens: 40, outputTokens: 20 } }))

      const rows = await dbh.db.select().from(aiUsageRecordTable)
      expect(rows).toHaveLength(1)
      // Usage is last-write-wins; key identity keeps the original exact snapshot.
      expect(rows[0]).toMatchObject({
        inputTokens: 40,
        outputTokens: 20,
        providerName: 'Test Provider',
        apiKeyId: 'key-a',
        apiKeyLabel: 'Main',
        apiKeyAttribution: 'exact'
      })
    })

    it('upgrades a none attribution when a later persist resolves a key', async () => {
      // First persist with no provider → none.
      await aiUsageRecordService.recordFromMessage(makeMessage({ stats: { inputTokens: 10 } }))
      // Provider appears (e.g. attribution was unresolvable mid-restart).
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', label: 'Main', isEnabled: true }])
      await aiUsageRecordService.recordFromMessage(makeMessage({ stats: { inputTokens: 20 } }))

      const rows = await dbh.db.select().from(aiUsageRecordTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        inputTokens: 20,
        providerName: 'Test Provider',
        apiKeyId: 'key-a',
        apiKeyAttribution: 'exact'
      })
    })
  })

  describe('recordRequest (request collector)', () => {
    it('never rejects when a ledger write fails', async () => {
      await expect(
        aiUsageRecordService.recordRequest({
          requestId: 'req-invalid-cost-pair',
          modelId: 'openai::gpt-4o',
          stats: { inputTokens: 1, costSource: 'computed' },
          modality: 'language'
        })
      ).resolves.toBeUndefined()

      expect(await dbh.db.select().from(aiUsageRecordTable)).toHaveLength(0)
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    })

    it('publishes all usage read-model changes after a successful write', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])

      await aiUsageRecordService.recordRequest({
        requestId: 'req-notify',
        modelId: 'openai::gpt-4o',
        modality: 'language',
        stats: { inputTokens: 1 }
      })

      expect(await dbh.db.select().from(aiUsageRecordTable)).toHaveLength(1)
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledOnce()
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
        { endpoint: '/ai-usage-records', kind: 'membership' },
        { endpoint: '/ai-usage-records', kind: 'projection' },
        { endpoint: '/ai-usage-records/stats' },
        { endpoint: '/ai-usage-records/timeline' }
      ])
    })

    it('enriches cost from model pricing when the caller stats carry none', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])
      await dbh.db.insert(userModelTable).values({
        id: 'openai::gpt-4o',
        providerId: 'openai',
        modelId: 'gpt-4o',
        presetModelId: 'gpt-4o',
        name: 'gpt-4o',
        isEnabled: true,
        isHidden: false,
        orderKey: 'a0',
        pricing: {
          input: { perMillionTokens: 3, currency: 'USD' },
          output: { perMillionTokens: 15, currency: 'USD' }
        }
      })

      await aiUsageRecordService.recordRequest({
        requestId: 'req-stateless',
        modelId: 'openai::gpt-4o',
        stats: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
        modality: 'language'
      })

      const [row] = await dbh.db.select().from(aiUsageRecordTable)
      expect(row).toMatchObject({
        requestId: 'req-stateless',
        topicId: null,
        cost: 3,
        costSource: 'computed',
        costCurrency: 'USD',
        costBreakdown: { input: 3, output: 0 },
        pricingSnapshot: expect.objectContaining({ input: 3, output: 15, capturedAt: expect.any(String) })
      })
    })

    it('persists a provider-reported charge when every token counter is explicitly zero', async () => {
      await seedProvider([], { providerId: 'openrouter', reportsActualCost: true })

      await aiUsageRecordService.recordRequest({
        requestId: 'req-provider-cost-only',
        modelId: 'openrouter::charged-zero-usage',
        modality: 'language',
        stats: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        providerCostUsd: 0.125
      })

      const [row] = await dbh.db.select().from(aiUsageRecordTable)
      expect(row).toMatchObject({
        requestId: 'req-provider-cost-only',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0.125,
        costCurrency: 'USD',
        costSource: 'provider'
      })
    })

    it('uses the selection-point key snapshot even when the rotation pointer has moved', async () => {
      await seedProvider([
        { id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', label: 'A', isEnabled: true },
        { id: 'key-b', key: 'sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbb', label: 'B', isEnabled: true }
      ])
      MockMainCacheServiceUtils.setCacheValue('settings.provider.openai.last_used_key_id', 'key-b')

      // A persistence-only writer lands first and can only infer key B from
      // mutable rotation state.
      await aiUsageRecordService.recordFromMessage(makeMessage({ id: 'req-key-race', stats: { inputTokens: 10 } }))

      // The billing pipeline carries the actual serving key A and must upgrade
      // the lower-confidence rotation attribution even though it lands second.
      await aiUsageRecordService.recordRequest({
        requestId: 'req-key-race',
        modelId: 'openai::gpt-4o',
        modality: 'language',
        apiKeySnapshot: { id: 'key-a', label: 'A', masked: 'sk-a****aaaa' },
        stats: { inputTokens: 20 }
      })

      const [row] = await dbh.db.select().from(aiUsageRecordTable)
      expect(row).toMatchObject({
        requestId: 'req-key-race',
        inputTokens: 20,
        apiKeyId: 'key-a',
        apiKeyLabel: 'A',
        apiKeyMasked: 'sk-a****aaaa',
        apiKeyAttribution: 'exact'
      })
    })

    it('records embedding requests and enriches cost from the input rate', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])
      await dbh.db.insert(userModelTable).values({
        id: 'openai::text-embedding-3-small',
        providerId: 'openai',
        modelId: 'text-embedding-3-small',
        presetModelId: 'text-embedding-3-small',
        name: 'text-embedding-3-small',
        isEnabled: true,
        isHidden: false,
        orderKey: 'a0',
        pricing: { input: { perMillionTokens: 0.02, currency: 'USD' }, output: { perMillionTokens: null } }
      })

      await aiUsageRecordService.recordRequest({
        requestId: 'req-embed',
        modelId: 'openai::text-embedding-3-small',
        modality: 'embedding',
        stats: { inputTokens: 1_000_000, totalTokens: 1_000_000 }
      })

      const [row] = await dbh.db.select().from(aiUsageRecordTable)
      expect(row).toMatchObject({
        requestId: 'req-embed',
        modality: 'embedding',
        inputTokens: 1_000_000,
        cost: 0.02,
        costSource: 'computed'
      })
    })

    it('records image requests with imageCount and pre-computed per-image cost', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])

      await aiUsageRecordService.recordRequest({
        requestId: 'req-image',
        modelId: 'openai::gpt-image-1',
        modality: 'image',
        imageCount: 3,
        stats: { cost: 0.12, costSource: 'computed', costCurrency: 'USD', costBreakdown: { image: 0.12 } }
      })
      // No pricing/cost: the row must still record the image count.
      await aiUsageRecordService.recordRequest({
        requestId: 'req-image-unpriced',
        modelId: 'openai::gpt-image-1',
        modality: 'image',
        imageCount: 1,
        stats: {}
      })

      const rows = await dbh.db.select().from(aiUsageRecordTable)
      expect(rows).toHaveLength(2)
      const priced = rows.find((r) => r.requestId === 'req-image')
      expect(priced).toMatchObject({ modality: 'image', imageCount: 3, cost: 0.12, totalTokens: null })
      const unpriced = rows.find((r) => r.requestId === 'req-image-unpriced')
      expect(unpriced).toMatchObject({ modality: 'image', imageCount: 1, cost: null })
    })

    it('never regresses topicId to null when funnel and persistence hook converge', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])

      // Persistence hook lands first (with topic context)…
      await aiUsageRecordService.recordFromMessage(makeMessage({ id: 'msg-conv', topicId: 'topic-1' } as never))
      // …then the request collector re-records the same request without it.
      await aiUsageRecordService.recordRequest({
        requestId: 'msg-conv',
        modelId: 'openai::gpt-4o',
        stats: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        modality: 'language'
      })

      const [row] = await dbh.db.select().from(aiUsageRecordTable)
      expect(row).toMatchObject({ requestId: 'msg-conv', topicId: 'topic-1' })
    })

    it('never erases cost and timings when a tokens-only re-record lands second', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])

      // Persistence hook lands first with the full metric set…
      await aiUsageRecordService.recordFromMessage(makeMessage({ id: 'msg-metrics' } as never))
      // …then the request collector re-records with `usageToStats(total)`, which
      // carries token fields only — no cost, no timings.
      await aiUsageRecordService.recordRequest({
        requestId: 'msg-metrics',
        modelId: 'openai::gpt-4o',
        stats: { inputTokens: 120, outputTokens: 60, totalTokens: 180 },
        modality: 'language'
      })

      const [row] = await dbh.db.select().from(aiUsageRecordTable)
      expect(row).toMatchObject({
        requestId: 'msg-metrics',
        // Tokens are last-write-wins…
        inputTokens: 120,
        outputTokens: 60,
        totalTokens: 180,
        // …but columns the second writer never carries survive.
        cost: 0.0042,
        costCurrency: 'USD',
        costSource: 'computed',
        timeFirstTokenMs: 250,
        timeCompletionMs: 1250,
        timeThinkingMs: 100,
        noCacheTokens: 60,
        cacheReadTokens: 30,
        cacheWriteTokens: 10
      })
    })

    it('never downgrades a provider-reported cost to a locally computed one', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])

      const providerBreakdown = { input: 0.3, output: 0.6 }
      const providerPricingSnapshot = {
        input: 3,
        output: 15,
        capturedAt: '2026-06-11T00:00:00.000Z'
      }

      // The request collector lands the provider-billed charge (e.g. OpenRouter)…
      await aiUsageRecordService.recordRequest({
        requestId: 'msg-provider-cost',
        modelId: 'openai::gpt-4o',
        modality: 'language',
        stats: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cost: 0.9,
          costCurrency: 'USD',
          costSource: 'provider',
          costBreakdown: providerBreakdown,
          pricingSnapshot: providerPricingSnapshot
        }
      })
      // …then a re-record carrying a different local estimate lands second.
      await aiUsageRecordService.recordFromMessage(
        makeMessage({
          id: 'msg-provider-cost',
          stats: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cost: 0.0042,
            costCurrency: 'USD',
            costSource: 'computed',
            costBreakdown: { input: 0.003, output: 0.0012 },
            pricingSnapshot: {
              input: 30,
              output: 40,
              capturedAt: '2026-06-12T00:00:00.000Z'
            }
          }
        } as never)
      )

      const [row] = await dbh.db.select().from(aiUsageRecordTable)
      expect(row).toMatchObject({
        // Tokens stay last-write-wins…
        inputTokens: 100,
        outputTokens: 50,
        // …but the authoritative charge survives.
        cost: 0.9,
        costCurrency: 'USD',
        costSource: 'provider',
        costBreakdown: providerBreakdown,
        pricingSnapshot: providerPricingSnapshot
      })
    })

    it('does not backfill a missing provider pricing snapshot from a later computed write', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])

      await aiUsageRecordService.recordRequest({
        requestId: 'msg-provider-cost-without-snapshot',
        modelId: 'openai::gpt-4o',
        modality: 'language',
        stats: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cost: 0.9,
          costCurrency: 'USD',
          costSource: 'provider'
        }
      })
      await aiUsageRecordService.recordFromMessage(
        makeMessage({
          id: 'msg-provider-cost-without-snapshot',
          stats: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cost: 0.0042,
            costCurrency: 'USD',
            costSource: 'computed',
            pricingSnapshot: {
              input: 30,
              output: 40,
              capturedAt: '2026-06-12T00:00:00.000Z'
            }
          }
        } as never)
      )

      const rows = await dbh.db.select().from(aiUsageRecordTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        cost: 0.9,
        costCurrency: 'USD',
        costSource: 'provider',
        pricingSnapshot: null
      })
    })

    it('records agent source by agent id, not session id', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])
      await seedAgentSession()

      await aiUsageRecordService.recordRequest({
        requestId: 'agent-message-1',
        agentSessionId: 'session-1',
        modelId: 'openai::gpt-4o',
        stats: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        modality: 'language'
      })

      const [row] = await dbh.db.select().from(aiUsageRecordTable)
      expect(row).toMatchObject({
        requestId: 'agent-message-1',
        sourceType: 'agent',
        sourceId: 'agent-1',
        sourceName: 'Test Agent',
        sourceIcon: '🧠'
      })
    })
  })

  describe('resolveKeyAttribution', () => {
    it('is exact with a single enabled key, with label and masked key snapshot', async () => {
      await seedProvider([
        { id: 'key-a', key: 'sk-test-1234567890abcdefgh', label: 'Main', isEnabled: true },
        { id: 'key-b', key: 'sk-disabled', label: 'Off', isEnabled: false }
      ])

      const result = await aiUsageRecordService.resolveKeyAttribution('openai')
      expect(result).toEqual({
        attribution: 'exact',
        providerName: 'Test Provider',
        keyId: 'key-a',
        label: 'Main',
        masked: expect.stringContaining('****')
      })
      expect(result.masked).not.toContain('sk-test-1234567890abcdefgh')
    })

    it('uses the rotation pointer with multiple enabled keys', async () => {
      await seedProvider([
        { id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', label: 'A', isEnabled: true },
        { id: 'key-b', key: 'sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbb', label: 'B', isEnabled: true }
      ])
      MockMainCacheServiceUtils.setCacheValue('settings.provider.openai.last_used_key_id', 'key-b')

      const result = await aiUsageRecordService.resolveKeyAttribution('openai')
      expect(result).toMatchObject({
        attribution: 'rotation',
        providerName: 'Test Provider',
        keyId: 'key-b',
        label: 'B'
      })
    })

    it('returns none with multiple keys but no rotation pointer (e.g. after restart)', async () => {
      await seedProvider([
        { id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true },
        { id: 'key-b', key: 'sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbb', isEnabled: true }
      ])

      expect(await aiUsageRecordService.resolveKeyAttribution('openai')).toEqual({
        attribution: 'none',
        providerName: 'Test Provider'
      })
    })

    it('returns none when the pointed-at key was deleted', async () => {
      await seedProvider([
        { id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true },
        { id: 'key-b', key: 'sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbb', isEnabled: true }
      ])
      MockMainCacheServiceUtils.setCacheValue('settings.provider.openai.last_used_key_id', 'deleted-key')

      expect(await aiUsageRecordService.resolveKeyAttribution('openai')).toEqual({
        attribution: 'none',
        providerName: 'Test Provider'
      })
    })

    it('attributes IAM providers to auth, not a key', async () => {
      await seedProvider([], { providerId: 'bedrock', authConfig: { type: 'iam-aws', region: 'us-east-1' } })

      expect(await aiUsageRecordService.resolveKeyAttribution('bedrock')).toEqual({
        attribution: 'auth',
        providerName: 'Test Provider'
      })
    })

    it('attributes keyless OAuth providers to auth', async () => {
      await seedProvider([], { providerId: 'claude-oauth', authConfig: { type: 'oauth' } })

      expect(await aiUsageRecordService.resolveKeyAttribution('claude-oauth')).toEqual({
        attribution: 'auth',
        providerName: 'Test Provider'
      })
    })

    it('returns none for api-key providers without keys and for missing providers', async () => {
      await seedProvider([], { providerId: 'ollama' })

      expect(await aiUsageRecordService.resolveKeyAttribution('ollama')).toEqual({
        attribution: 'none',
        providerName: 'Test Provider'
      })
      expect(await aiUsageRecordService.resolveKeyAttribution('ghost')).toEqual({ attribution: 'none' })
    })

    it('never stores a short key raw — masked snapshot is clamped to ****', async () => {
      await seedProvider([{ id: 'key-a', key: 'token123', label: 'Short', isEnabled: true }])

      const result = await aiUsageRecordService.resolveKeyAttribution('openai')
      expect(result.masked).toBe('****')
    })
  })

  describe('list', () => {
    it('filters by time and paginates newest-first', async () => {
      const base = {
        modelId: 'p::m',
        modality: 'language',
        apiKeyAttribution: 'exact',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        cost: 0.01,
        costCurrency: 'USD',
        costSource: 'computed'
      } as const
      await dbh.db.insert(aiUsageRecordTable).values([
        { ...base, requestId: 'm1', providerId: 'openai', apiKeyId: 'key-a', createdAt: 1000, updatedAt: 1000 },
        { ...base, requestId: 'm2', providerId: 'openai', apiKeyId: 'key-b', createdAt: 2000, updatedAt: 2000 },
        { ...base, requestId: 'm3', providerId: 'anthropic', apiKeyId: 'key-c', createdAt: 3000, updatedAt: 3000 }
      ])

      const byTime = await aiUsageRecordService.list({ limit: 50, from: 1500, to: 2500 })
      expect(byTime.items.map((i) => i.requestId)).toEqual(['m2'])

      const page1 = await aiUsageRecordService.list({ limit: 2 })
      expect(page1.items.map((i) => i.requestId)).toEqual(['m3', 'm2'])
      expect(page1.total).toBe(3)
      expect(page1.nextCursor).toBeDefined()

      const page2 = await aiUsageRecordService.list({ cursor: page1.nextCursor, limit: 2 })
      expect(page2.items.map((i) => i.requestId)).toEqual(['m1'])
      expect(page2.total).toBe(3)
      expect(page2.nextCursor).toBeUndefined()
    })

    it('sorts entries by request metrics before paginating', async () => {
      const base = {
        providerId: 'openai',
        modelId: 'openai::gpt-4o',
        modality: 'language',
        apiKeyAttribution: 'none',
        costCurrency: 'USD',
        costSource: 'computed'
      } as const
      await dbh.db.insert(aiUsageRecordTable).values([
        {
          ...base,
          requestId: 'slow',
          outputTokens: 10,
          totalTokens: 20,
          cost: 0.5,
          timeFirstTokenMs: 900,
          timeCompletionMs: 1900,
          createdAt: 1000,
          updatedAt: 1000
        },
        {
          ...base,
          requestId: 'fast',
          outputTokens: 100,
          totalTokens: 200,
          cost: 0.2,
          timeFirstTokenMs: 100,
          timeCompletionMs: 1100,
          createdAt: 2000,
          updatedAt: 2000
        },
        {
          ...base,
          requestId: 'expensive',
          outputTokens: 30,
          totalTokens: 60,
          cost: 2,
          timeFirstTokenMs: 300,
          timeCompletionMs: 900,
          createdAt: 3000,
          updatedAt: 3000
        }
      ])

      await expect(aiUsageRecordService.list({ limit: 3, sortBy: 'totalTokens' })).resolves.toMatchObject({
        items: [{ requestId: 'fast' }, { requestId: 'expensive' }, { requestId: 'slow' }]
      })
      await expect(aiUsageRecordService.list({ limit: 3, sortBy: 'cost', costCurrency: 'USD' })).resolves.toMatchObject(
        {
          items: [{ requestId: 'expensive' }, { requestId: 'slow' }, { requestId: 'fast' }]
        }
      )
      const ttftPage1 = await aiUsageRecordService.list({
        limit: 2,
        sortBy: 'timeFirstTokenMs',
        sortOrder: 'asc'
      })
      expect(ttftPage1).toMatchObject({
        items: [{ requestId: 'fast' }, { requestId: 'expensive' }]
      })
      await expect(
        aiUsageRecordService.list({
          cursor: ttftPage1.nextCursor,
          limit: 2,
          sortBy: 'timeFirstTokenMs',
          sortOrder: 'asc'
        })
      ).resolves.toMatchObject({
        items: [{ requestId: 'slow' }],
        nextCursor: undefined
      })
      const tpsPage1 = await aiUsageRecordService.list({ limit: 2, sortBy: 'tokensPerSecond' })
      expect(tpsPage1).toMatchObject({
        items: [{ requestId: 'fast' }, { requestId: 'expensive' }]
      })
      expect(tpsPage1.nextCursor).toBeDefined()

      const tpsPage2 = await aiUsageRecordService.list({
        cursor: tpsPage1.nextCursor,
        limit: 2,
        sortBy: 'tokensPerSecond'
      })
      expect(tpsPage2).toMatchObject({
        items: [{ requestId: 'slow' }],
        nextCursor: undefined
      })
    })

    it('walks from token-bearing rows into the NULL metric band without skipping rows', async () => {
      const base = {
        providerId: 'openai',
        modelId: 'openai::gpt-4o',
        modality: 'language',
        apiKeyAttribution: 'none'
      } as const
      await dbh.db.insert(aiUsageRecordTable).values([
        {
          ...base,
          requestId: 'metered',
          totalTokens: 1,
          createdAt: 1000,
          updatedAt: 1000
        },
        { ...base, requestId: 'free-old', createdAt: 2000, updatedAt: 2000 },
        { ...base, requestId: 'free-new', createdAt: 3000, updatedAt: 3000 }
      ])

      const first = await aiUsageRecordService.list({ limit: 1, sortBy: 'totalTokens' })
      const second = await aiUsageRecordService.list({
        cursor: first.nextCursor,
        limit: 1,
        sortBy: 'totalTokens'
      })
      const third = await aiUsageRecordService.list({
        cursor: second.nextCursor,
        limit: 1,
        sortBy: 'totalTokens'
      })

      expect(first.items.map((item) => item.requestId)).toEqual(['metered'])
      expect(second.items.map((item) => item.requestId)).toEqual(['free-new'])
      expect(third.items.map((item) => item.requestId)).toEqual(['free-old'])
      expect(third.nextCursor).toBeUndefined()
    })

    it('sorts monetary entries only within the requested currency', async () => {
      const base = {
        modelId: 'openai::gpt-4o',
        modality: 'language',
        apiKeyAttribution: 'none',
        costSource: 'computed'
      } as const
      await dbh.db.insert(aiUsageRecordTable).values([
        {
          ...base,
          requestId: 'usd',
          providerId: 'openai',
          cost: 1,
          costCurrency: 'USD',
          createdAt: 1000,
          updatedAt: 1000
        },
        {
          ...base,
          requestId: 'cny',
          providerId: 'openai',
          cost: 100,
          costCurrency: 'CNY',
          createdAt: 2000,
          updatedAt: 2000
        }
      ])

      await expect(
        aiUsageRecordService.list({ limit: 10, sortBy: 'cost', costCurrency: 'USD' })
      ).resolves.toMatchObject({
        items: [{ requestId: 'usd' }],
        total: 1
      })
      await expect(
        aiUsageRecordService.list({ limit: 10, sortBy: 'cost', costCurrency: 'CNY' })
      ).resolves.toMatchObject({
        items: [{ requestId: 'cny' }],
        total: 1
      })
    })
  })

  describe('schema constraints', () => {
    const base = {
      providerId: 'openai',
      modelId: 'openai::gpt-4o',
      modality: 'language',
      apiKeyAttribution: 'none',
      createdAt: 1000,
      updatedAt: 1000
    } as const

    it('rejects a partial cost tuple', () => {
      expect(() =>
        dbh.db
          .insert(aiUsageRecordTable)
          .values({ ...base, requestId: 'invalid-cost-pair', costSource: 'computed' })
          .run()
      ).toThrow('ai_usage_record_cost_tuple_check')
    })

    it('preserves explicit zero cost while allowing a wholly absent cost tuple', () => {
      expect(() =>
        dbh.db
          .insert(aiUsageRecordTable)
          .values([
            { ...base, requestId: 'unpriced' },
            {
              ...base,
              requestId: 'free',
              cost: 0,
              costCurrency: 'USD',
              costSource: 'computed'
            }
          ])
          .run()
      ).not.toThrow()
    })

    it('rejects key-level attribution without an API key id', () => {
      expect(() =>
        dbh.db
          .insert(aiUsageRecordTable)
          .values({ ...base, requestId: 'invalid-key-pair', apiKeyAttribution: 'exact' })
          .run()
      ).toThrow('ai_usage_record_api_key_identity_check')
    })

    it('rejects provider-level attribution with a key identity', () => {
      expect(() =>
        dbh.db
          .insert(aiUsageRecordTable)
          .values({
            ...base,
            requestId: 'invalid-auth-key',
            apiKeyAttribution: 'auth',
            apiKeyId: 'key-a'
          })
          .run()
      ).toThrow('ai_usage_record_api_key_identity_check')
    })

    it('rejects partial source identity', () => {
      expect(() =>
        dbh.db
          .insert(aiUsageRecordTable)
          .values({ ...base, requestId: 'invalid-source', sourceName: 'Orphaned name' })
          .run()
      ).toThrow('ai_usage_record_source_identity_check')
    })

    it.each([
      ['an image row without imageCount', { modality: 'image' as const }],
      ['a language row with imageCount', { modality: 'language' as const, imageCount: 1 }]
    ])('rejects %s', (_name, invalidFields) => {
      expect(() =>
        dbh.db
          .insert(aiUsageRecordTable)
          .values({ ...base, ...invalidFields, requestId: `invalid-image-${invalidFields.modality}` })
          .run()
      ).toThrow('ai_usage_record_image_count_check')
    })
  })

  describe('stats', () => {
    it('aggregates by api key and never mixes currencies', async () => {
      const base = {
        providerId: 'openai',
        modelId: 'openai::gpt-4o',
        modality: 'language',
        apiKeyAttribution: 'exact',
        costSource: 'computed'
      } as const
      await dbh.db.insert(aiUsageRecordTable).values([
        {
          ...base,
          requestId: 'm1',
          apiKeyId: 'key-a',
          apiKeyLabel: 'Main',
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cost: 0.5,
          costCurrency: 'USD',
          createdAt: 1000,
          updatedAt: 1000
        },
        {
          ...base,
          requestId: 'm2',
          apiKeyId: 'key-a',
          apiKeyLabel: 'Main',
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
          cost: 1.5,
          costCurrency: 'USD',
          createdAt: 2000,
          updatedAt: 2000
        },
        {
          ...base,
          requestId: 'm3',
          apiKeyId: 'key-a',
          apiKeyLabel: 'Main',
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cost: 7,
          costCurrency: 'CNY',
          createdAt: 3000,
          updatedAt: 3000
        },
        {
          ...base,
          requestId: 'm4',
          apiKeyId: 'key-b',
          apiKeyLabel: 'Backup',
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          cost: 0.1,
          costCurrency: 'USD',
          createdAt: 4000,
          updatedAt: 4000
        }
      ])

      const { buckets } = await aiUsageRecordService.stats({
        ...DEFAULT_AGGREGATE_QUERY,
        groupBy: 'apiKey',
        metric: 'cost',
        currency: 'USD'
      })

      expect(buckets).toHaveLength(2)
      const keyA = buckets.find((bucket) => bucket.groupBy === 'apiKey' && bucket.apiKeyId === 'key-a')
      expect(keyA).toMatchObject({
        groupBy: 'apiKey',
        apiKeyLabel: 'Main',
        costCurrency: 'USD',
        totalCost: 2,
        totalInputTokens: 310,
        totalOutputTokens: 155,
        totalTokens: 465,
        entryCount: 3
      })
      expect(buckets[0]).toMatchObject({ apiKeyId: 'key-a', costCurrency: 'USD', totalCost: 2 })
    })

    it('reports the least confident attribution for a bucket mixing exact and rotation rows', async () => {
      const base = {
        providerId: 'openai',
        modelId: 'openai::gpt-4o',
        modality: 'language',
        apiKeyId: 'key-a',
        costCurrency: 'USD',
        costSource: 'computed'
      } as const
      await dbh.db.insert(aiUsageRecordTable).values([
        { ...base, requestId: 'm-exact', apiKeyAttribution: 'exact', cost: 1, createdAt: 1000, updatedAt: 1000 },
        { ...base, requestId: 'm-rotation', apiKeyAttribution: 'rotation', cost: 2, createdAt: 2000, updatedAt: 2000 }
      ])

      const { buckets } = await aiUsageRecordService.stats({ ...DEFAULT_AGGREGATE_QUERY, groupBy: 'apiKey' })

      expect(buckets).toHaveLength(1)
      expect(buckets[0]).toMatchObject({ apiKeyId: 'key-a', apiKeyAttribution: 'rotation', entryCount: 2 })
    })

    it('keeps provider authentication separate from unattributed requests', async () => {
      const base = {
        providerId: 'openai',
        modelId: 'openai::gpt-4o',
        modality: 'language'
      } as const
      await dbh.db.insert(aiUsageRecordTable).values([
        {
          ...base,
          requestId: 'provider-auth',
          apiKeyAttribution: 'auth',
          totalTokens: 20,
          createdAt: 1000,
          updatedAt: 1000
        },
        {
          ...base,
          requestId: 'unattributed',
          apiKeyAttribution: 'none',
          totalTokens: 10,
          createdAt: 2000,
          updatedAt: 2000
        }
      ])

      const { buckets } = await aiUsageRecordService.stats({
        ...DEFAULT_AGGREGATE_QUERY,
        groupBy: 'apiKey'
      })

      expect(buckets).toHaveLength(2)
      expect(buckets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ apiKeyId: null, apiKeyAttribution: 'auth', totalTokens: 20 }),
          expect.objectContaining({ apiKeyId: null, apiKeyAttribution: 'none', totalTokens: 10 })
        ])
      )
    })

    it('keeps the stored provider-name snapshot stable when the live provider differs', async () => {
      await seedProvider([], { providerId: 'custom-provider' })
      await dbh.db.insert(aiUsageRecordTable).values({
        requestId: 'snapshotless-row',
        providerId: 'custom-provider',
        providerName: 'custom-provider',
        modelId: 'custom-provider::model-a',
        modality: 'language',
        apiKeyAttribution: 'none',
        totalTokens: 12,
        cost: 0.1,
        costCurrency: 'USD',
        costSource: 'computed',
        createdAt: 1000,
        updatedAt: 1000
      })

      const stats = await aiUsageRecordService.stats({ ...DEFAULT_AGGREGATE_QUERY, groupBy: 'provider' })
      expect(stats.buckets[0]).toMatchObject({
        providerId: 'custom-provider',
        providerName: 'custom-provider'
      })

      const list = await aiUsageRecordService.list({ limit: 10 })
      expect(list.items[0]).toMatchObject({
        providerId: 'custom-provider',
        providerName: 'custom-provider'
      })
    })

    it('aggregates by provider with a time window', async () => {
      await dbh.db.insert(aiUsageRecordTable).values([
        {
          requestId: 'm1',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          modality: 'language',
          apiKeyAttribution: 'none',
          cost: 1,
          costCurrency: 'USD',
          costSource: 'computed',
          createdAt: 1000,
          updatedAt: 1000
        },
        {
          requestId: 'm2',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          modality: 'language',
          apiKeyAttribution: 'none',
          cost: 2,
          costCurrency: 'USD',
          costSource: 'computed',
          createdAt: 5000,
          updatedAt: 5000
        }
      ])

      const { buckets } = await aiUsageRecordService.stats({
        ...DEFAULT_AGGREGATE_QUERY,
        groupBy: 'provider',
        from: 2000,
        metric: 'cost',
        currency: 'USD'
      })
      expect(buckets).toHaveLength(1)
      expect(buckets[0]).toMatchObject({ providerId: 'openai', totalCost: 2, entryCount: 1 })
    })

    it('aggregates by assistant and agent source', async () => {
      await dbh.db.insert(aiUsageRecordTable).values([
        {
          requestId: 'assistant-row-1',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          modality: 'language',
          sourceType: 'assistant',
          sourceId: 'assistant-1',
          sourceName: 'Assistant One',
          sourceIcon: '✨',
          apiKeyAttribution: 'none',
          noCacheTokens: 50,
          cacheReadTokens: 25,
          cacheWriteTokens: 25,
          totalTokens: 100,
          cost: 1,
          costCurrency: 'USD',
          costSource: 'computed',
          createdAt: 1000,
          updatedAt: 1000
        },
        {
          requestId: 'assistant-row-2',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          modality: 'language',
          sourceType: 'assistant',
          sourceId: 'assistant-1',
          sourceName: 'Assistant One',
          sourceIcon: '✨',
          apiKeyAttribution: 'none',
          noCacheTokens: 10,
          cacheReadTokens: 5,
          cacheWriteTokens: 5,
          totalTokens: 20,
          cost: 0.5,
          costCurrency: 'USD',
          costSource: 'computed',
          createdAt: 2000,
          updatedAt: 2000
        },
        {
          requestId: 'agent-row',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          modality: 'language',
          sourceType: 'agent',
          sourceId: 'agent-1',
          sourceName: 'Agent One',
          sourceIcon: '🧠',
          apiKeyAttribution: 'none',
          noCacheTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 100,
          cost: 0.25,
          costCurrency: 'USD',
          costSource: 'computed',
          createdAt: 3000,
          updatedAt: 3000
        }
      ])

      const { buckets } = await aiUsageRecordService.stats({
        ...DEFAULT_AGGREGATE_QUERY,
        groupBy: 'source',
        metric: 'cost',
        currency: 'USD'
      })
      const assistant = buckets.find((bucket) => bucket.groupBy === 'source' && bucket.sourceType === 'assistant')
      const agent = buckets.find((bucket) => bucket.groupBy === 'source' && bucket.sourceType === 'agent')

      expect(assistant).toMatchObject({
        groupBy: 'source',
        sourceId: 'assistant-1',
        sourceName: 'Assistant One',
        sourceIcon: '✨',
        totalCost: 1.5,
        totalNoCacheTokens: 60,
        totalCacheReadTokens: 30,
        totalCacheWriteTokens: 30,
        entryCount: 2
      })
      expect(assistant).not.toHaveProperty('providerId')
      expect(assistant).not.toHaveProperty('providerName')
      expect(agent).toMatchObject({
        sourceId: 'agent-1',
        sourceName: 'Agent One',
        sourceIcon: '🧠',
        totalCost: 0.25,
        entryCount: 1
      })
    })

    it('returns server-ranked top groups with full totals and an other remainder', async () => {
      const base = {
        modelId: 'shared::model',
        modality: 'language',
        apiKeyAttribution: 'none'
      } as const
      await dbh.db.insert(aiUsageRecordTable).values([
        {
          ...base,
          requestId: 'largest',
          providerId: 'largest',
          totalTokens: 30,
          createdAt: 1000,
          updatedAt: 1000
        },
        {
          ...base,
          requestId: 'middle',
          providerId: 'middle',
          totalTokens: 20,
          createdAt: 2000,
          updatedAt: 2000
        },
        {
          ...base,
          requestId: 'smallest',
          providerId: 'smallest',
          totalTokens: 10,
          createdAt: 3000,
          updatedAt: 3000
        }
      ])

      const result = await aiUsageRecordService.stats({
        ...DEFAULT_AGGREGATE_QUERY,
        groupBy: 'provider',
        limit: 2
      })

      expect(result.buckets.map((bucket) => (bucket.groupBy === 'provider' ? bucket.providerId : null))).toEqual([
        'largest',
        'middle'
      ])
      expect(result.totals).toMatchObject({ totalTokens: 60, entryCount: 3 })
      expect(result.other).toMatchObject({ totalTokens: 10, entryCount: 1 })
    })
  })

  describe('timeline', () => {
    const base = {
      providerId: 'openai',
      modelId: 'openai::gpt-4o',
      modality: 'language',
      apiKeyAttribution: 'none'
    } as const
    const usdBase = { ...base, costCurrency: 'USD', costSource: 'computed' } as const

    it('collapses rows on the same local day into one bucket', async () => {
      const first = new Date(2026, 0, 2, 1).getTime()
      const second = new Date(2026, 0, 2, 23).getTime()

      await dbh.db.insert(aiUsageRecordTable).values([
        { ...usdBase, requestId: 'm1', totalTokens: 100, cost: 0.25, createdAt: first, updatedAt: first },
        { ...usdBase, requestId: 'm2', totalTokens: 50, cost: 0.75, createdAt: second, updatedAt: second }
      ])

      const { buckets } = await aiUsageRecordService.timeline({
        ...DEFAULT_AGGREGATE_QUERY,
        metric: 'cost',
        currency: 'USD'
      })

      expect(buckets).toEqual([
        {
          date: localDateKey(first),
          costCurrency: 'USD',
          totalTokens: 150,
          totalNoCacheTokens: 0,
          totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0,
          totalCost: 1,
          entryCount: 2
        }
      ])
    })

    it('keeps one usage bucket while returning currency-specific cost totals', async () => {
      const at = new Date(2026, 0, 2, 9).getTime()

      await dbh.db.insert(aiUsageRecordTable).values([
        { ...usdBase, requestId: 'usd-1', totalTokens: 100, cost: 0.5, createdAt: at, updatedAt: at },
        { ...usdBase, requestId: 'usd-2', totalTokens: 20, cost: 0.25, createdAt: at, updatedAt: at },
        {
          ...base,
          requestId: 'cny-1',
          totalTokens: 40,
          cost: 3,
          costCurrency: 'CNY',
          costSource: 'computed',
          createdAt: at,
          updatedAt: at
        },
        { ...base, requestId: 'free-1', totalTokens: 7, cost: null, createdAt: at, updatedAt: at }
      ])

      const result = await aiUsageRecordService.timeline({
        ...DEFAULT_AGGREGATE_QUERY,
        metric: 'cost',
        currency: 'USD'
      })
      const { buckets, costTotals, dailyCosts } = result

      expect(buckets).toEqual([
        {
          date: localDateKey(at),
          costCurrency: 'USD',
          totalTokens: 167,
          totalNoCacheTokens: 0,
          totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0,
          totalCost: 0.75,
          entryCount: 4
        }
      ])
      expect(costTotals).toEqual([
        { currency: 'CNY', total: 3 },
        { currency: 'USD', total: 0.75 }
      ])
      expect(dailyCosts).toEqual([
        { date: localDateKey(at), currency: 'CNY', total: 3 },
        { date: localDateKey(at), currency: 'USD', total: 0.75 }
      ])
    })

    it('returns multi-day buckets in ascending order without empty-day gaps', async () => {
      const day1 = new Date(2026, 0, 1, 12).getTime()
      const day3 = new Date(2026, 0, 3, 12).getTime()

      await dbh.db.insert(aiUsageRecordTable).values([
        { ...usdBase, requestId: 'm3', totalTokens: 30, cost: 0.3, createdAt: day3, updatedAt: day3 },
        { ...usdBase, requestId: 'm1', totalTokens: 10, cost: 0.1, createdAt: day1, updatedAt: day1 }
      ])

      const { buckets } = await aiUsageRecordService.timeline(DEFAULT_AGGREGATE_QUERY)

      expect(buckets.map((bucket) => bucket.date)).toEqual([localDateKey(day1), localDateKey(day3)])
      expect(buckets.map((bucket) => bucket.totalTokens)).toEqual([10, 30])
    })

    it('splits a day per group when groupBy is given', async () => {
      const at = new Date(2026, 0, 2, 9).getTime()
      const next = new Date(2026, 0, 3, 9).getTime()

      await dbh.db.insert(aiUsageRecordTable).values([
        { ...base, requestId: 'a1', totalTokens: 10, createdAt: at, updatedAt: at },
        { ...base, requestId: 'a2', totalTokens: 20, createdAt: at, updatedAt: at },
        {
          ...base,
          requestId: 'b1',
          modelId: 'openai::gpt-4o-mini',
          totalTokens: 5,
          createdAt: at,
          updatedAt: at
        },
        { ...base, requestId: 'a3', totalTokens: 7, createdAt: next, updatedAt: next }
      ])

      const { buckets } = await aiUsageRecordService.timeline({
        ...DEFAULT_AGGREGATE_QUERY,
        groupBy: 'model'
      })

      expect(
        buckets.map((bucket) => ({ date: bucket.date, modelId: bucket.modelId, totalTokens: bucket.totalTokens }))
      ).toEqual([
        { date: localDateKey(at), modelId: 'openai::gpt-4o', totalTokens: 30 },
        { date: localDateKey(at), modelId: 'openai::gpt-4o-mini', totalTokens: 5 },
        { date: localDateKey(next), modelId: 'openai::gpt-4o', totalTokens: 7 }
      ])
      expect(buckets[0].providerId).toBe('openai')
    })

    it('bounds grouped timeline cardinality and emits the remainder as other', async () => {
      const at = new Date(2026, 0, 2, 9).getTime()
      await dbh.db.insert(aiUsageRecordTable).values([
        {
          ...base,
          requestId: 'largest',
          providerId: 'largest',
          totalTokens: 30,
          createdAt: at,
          updatedAt: at
        },
        {
          ...base,
          requestId: 'smallest',
          providerId: 'smallest',
          totalTokens: 10,
          createdAt: at,
          updatedAt: at
        }
      ])

      const { buckets } = await aiUsageRecordService.timeline({
        ...DEFAULT_AGGREGATE_QUERY,
        groupBy: 'provider',
        limit: 1
      })

      expect(buckets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ providerId: 'largest', totalTokens: 30 }),
          expect.objectContaining({ isOther: true, totalTokens: 10, entryCount: 1 })
        ])
      )
      expect(buckets).toHaveLength(2)
    })

    it('leaves group identity empty when no groupBy is given', async () => {
      const at = new Date(2026, 0, 2, 9).getTime()

      await dbh.db
        .insert(aiUsageRecordTable)
        .values([{ ...base, requestId: 'a1', totalTokens: 10, createdAt: at, updatedAt: at }])

      const [bucket] = (await aiUsageRecordService.timeline(DEFAULT_AGGREGATE_QUERY)).buckets

      expect(bucket.providerId).toBeUndefined()
      expect(bucket.modelId).toBeUndefined()
      expect(bucket.apiKeyAttribution).toBeUndefined()
    })

    it('respects inclusive from and to bounds', async () => {
      const before = new Date(2026, 0, 1, 12).getTime()
      const from = new Date(2026, 0, 2, 0).getTime()
      const inside = new Date(2026, 0, 2, 12).getTime()
      const to = new Date(2026, 0, 2, 23, 59, 59, 999).getTime()
      const after = new Date(2026, 0, 3, 12).getTime()

      await dbh.db.insert(aiUsageRecordTable).values([
        { ...usdBase, requestId: 'm-before', totalTokens: 10, cost: 0.1, createdAt: before, updatedAt: before },
        { ...usdBase, requestId: 'm-from', totalTokens: 20, cost: 0.2, createdAt: from, updatedAt: from },
        { ...usdBase, requestId: 'm-inside', totalTokens: 30, cost: 0.3, createdAt: inside, updatedAt: inside },
        { ...usdBase, requestId: 'm-to', totalTokens: 40, cost: 0.4, createdAt: to, updatedAt: to },
        { ...usdBase, requestId: 'm-after', totalTokens: 50, cost: 0.5, createdAt: after, updatedAt: after }
      ])

      const { buckets } = await aiUsageRecordService.timeline({
        ...DEFAULT_AGGREGATE_QUERY,
        from,
        to,
        metric: 'cost',
        currency: 'USD'
      })

      expect(buckets).toHaveLength(1)
      expect(buckets[0]).toMatchObject({
        date: localDateKey(inside),
        totalTokens: 90,
        totalNoCacheTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheWriteTokens: 0,
        entryCount: 3
      })
      expect(buckets[0].totalCost).toBeCloseTo(0.9)
    })
  })
})
