import { resolve } from 'node:path'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { assistantTable } from '@data/db/schemas/assistant'
import { topicTable } from '@data/db/schemas/topic'
import { usageLedgerTable } from '@data/db/schemas/usageLedger'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { usageLedgerService } from '@data/services/UsageLedgerService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { Message } from '@shared/data/types/message'
import type { RuntimeModelPricing } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
      ...(opts?.authConfig ? { authConfig: opts.authConfig as never } : {})
    })
}

async function seedModelPricing(opts: { providerId?: string; modelId?: string; pricing?: RuntimeModelPricing } = {}) {
  const providerId = opts.providerId ?? 'openai'
  const modelId = opts.modelId ?? 'gpt-4o'
  await application
    .get('DbService')
    .getDb()
    .insert(userModelTable)
    .values({
      id: `${providerId}::${modelId}`,
      providerId,
      modelId,
      presetModelId: modelId,
      name: modelId,
      isEnabled: true,
      isHidden: false,
      orderKey: 'a0',
      pricing: opts.pricing ?? {
        input: { perMillionTokens: 3, currency: 'USD' },
        output: { perMillionTokens: 15, currency: 'USD' }
      }
    })
}

function localDateKey(value: number): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

describe('UsageLedgerService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    MockMainCacheServiceUtils.resetMocks()
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

      await usageLedgerService.recordFromMessage(makeMessage())

      const rows = await dbh.db.select().from(usageLedgerTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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

    it('upserts by messageId — re-persists replace with cumulative totals', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])

      await usageLedgerService.recordFromMessage(makeMessage({ stats: { inputTokens: 10, outputTokens: 5 } }))
      await usageLedgerService.recordFromMessage(
        makeMessage({ stats: { inputTokens: 40, outputTokens: 20, totalTokens: 60 } })
      )

      const rows = await dbh.db.select().from(usageLedgerTable)
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

      await usageLedgerService.recordFromMessage(message)

      expect(await dbh.db.select().from(usageLedgerTable)).toHaveLength(0)
    })

    it('keeps the earliest non-none key attribution on re-persists while updating usage', async () => {
      // First persist: single enabled key → exact attribution.
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', label: 'Main', isEnabled: true }])
      await usageLedgerService.recordFromMessage(makeMessage({ stats: { inputTokens: 10, outputTokens: 5 } }))

      // Second persist resolves to 'none' (simulates pointer lost on restart):
      // wipe the provider so attribution degrades.
      await dbh.db.delete(userProviderTable)
      await usageLedgerService.recordFromMessage(makeMessage({ stats: { inputTokens: 40, outputTokens: 20 } }))

      const rows = await dbh.db.select().from(usageLedgerTable)
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
      await usageLedgerService.recordFromMessage(makeMessage({ stats: { inputTokens: 10 } }))
      // Provider appears (e.g. attribution was unresolvable mid-restart).
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', label: 'Main', isEnabled: true }])
      await usageLedgerService.recordFromMessage(makeMessage({ stats: { inputTokens: 20 } }))

      const rows = await dbh.db.select().from(usageLedgerTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        inputTokens: 20,
        providerName: 'Test Provider',
        apiKeyId: 'key-a',
        apiKeyAttribution: 'exact'
      })
    })
  })

  describe('recordRequest (billing funnel)', () => {
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

      await usageLedgerService.recordRequest({
        id: 'req-stateless',
        modelId: 'openai::gpt-4o',
        stats: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 }
      })

      const [row] = await dbh.db.select().from(usageLedgerTable)
      expect(row).toMatchObject({
        messageId: 'req-stateless',
        topicId: null,
        cost: 3,
        costSource: 'computed',
        costCurrency: 'USD',
        costBreakdown: { input: 3, output: 0 },
        pricingSnapshot: expect.objectContaining({ input: 3, output: 15, capturedAt: expect.any(String) })
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

      await usageLedgerService.recordRequest({
        id: 'req-embed',
        modelId: 'openai::text-embedding-3-small',
        modality: 'embedding',
        stats: { inputTokens: 1_000_000, totalTokens: 1_000_000 }
      })

      const [row] = await dbh.db.select().from(usageLedgerTable)
      expect(row).toMatchObject({
        messageId: 'req-embed',
        modality: 'embedding',
        inputTokens: 1_000_000,
        cost: 0.02,
        costSource: 'computed'
      })
    })

    it('records image requests with imageCount and pre-computed per-image cost', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])

      await usageLedgerService.recordRequest({
        id: 'req-image',
        modelId: 'openai::gpt-image-1',
        modality: 'image',
        imageCount: 3,
        stats: { cost: 0.12, costSource: 'computed', costCurrency: 'USD', costBreakdown: { image: 0.12 } }
      })
      // No pricing/cost: the row must still record the image count.
      await usageLedgerService.recordRequest({
        id: 'req-image-unpriced',
        modelId: 'openai::gpt-image-1',
        modality: 'image',
        imageCount: 1,
        stats: {}
      })

      const rows = await dbh.db.select().from(usageLedgerTable)
      expect(rows).toHaveLength(2)
      const priced = rows.find((r) => r.messageId === 'req-image')
      expect(priced).toMatchObject({ modality: 'image', imageCount: 3, cost: 0.12, totalTokens: null })
      const unpriced = rows.find((r) => r.messageId === 'req-image-unpriced')
      expect(unpriced).toMatchObject({ modality: 'image', imageCount: 1, cost: null })
    })

    it('never regresses topicId to null when funnel and persistence hook converge', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])

      // Persistence hook lands first (with topic context)…
      await usageLedgerService.recordFromMessage(makeMessage({ id: 'msg-conv', topicId: 'topic-1' } as never))
      // …then the billing funnel re-records the same request without it.
      await usageLedgerService.recordRequest({
        id: 'msg-conv',
        modelId: 'openai::gpt-4o',
        stats: { inputTokens: 100, outputTokens: 50, totalTokens: 150 }
      })

      const [row] = await dbh.db.select().from(usageLedgerTable)
      expect(row).toMatchObject({ messageId: 'msg-conv', topicId: 'topic-1' })
    })

    it('records agent source by agent id, not session id', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])
      await seedAgentSession()

      await usageLedgerService.recordRequest({
        id: 'agent-message-1',
        agentSessionId: 'session-1',
        modelId: 'openai::gpt-4o',
        stats: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
      })

      const [row] = await dbh.db.select().from(usageLedgerTable)
      expect(row).toMatchObject({
        messageId: 'agent-message-1',
        sourceType: 'agent',
        sourceId: 'agent-1',
        sourceName: 'Test Agent',
        sourceIcon: '🧠'
      })
    })
  })

  describe('cost backfill', () => {
    it('previews only missing-cost language and embedding rows for the target model', async () => {
      await seedProvider([], { providerId: 'openai' })
      await seedModelPricing()

      await dbh.db.insert(usageLedgerTable).values([
        {
          messageId: 'missing-language',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          apiKeyAttribution: 'none',
          inputTokens: 1_000_000,
          outputTokens: 0,
          totalTokens: 1_000_000,
          createdAt: 1000,
          updatedAt: 1000
        },
        {
          messageId: 'missing-embedding',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          modality: 'embedding',
          apiKeyAttribution: 'none',
          inputTokens: 1_000_000,
          totalTokens: 1_000_000,
          createdAt: 2000,
          updatedAt: 2000
        },
        {
          messageId: 'already-computed',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          apiKeyAttribution: 'none',
          inputTokens: 1_000_000,
          cost: 99,
          costCurrency: 'USD',
          costSource: 'computed',
          createdAt: 3000,
          updatedAt: 3000
        },
        {
          messageId: 'wrong-model',
          providerId: 'openai',
          modelId: 'openai::other',
          apiKeyAttribution: 'none',
          inputTokens: 1_000_000,
          createdAt: 4000,
          updatedAt: 4000
        },
        {
          messageId: 'image-row',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          modality: 'image',
          apiKeyAttribution: 'none',
          imageCount: 1,
          createdAt: 5000,
          updatedAt: 5000
        }
      ])

      const preview = await usageLedgerService.previewCostBackfill({ modelId: 'openai::gpt-4o' })

      expect(preview).toMatchObject({
        scannedCount: 2,
        recalculableCount: 2,
        skippedNoPricingCount: 0,
        skippedProviderCostCount: 0,
        estimatedCostByCurrency: [{ currency: 'USD', cost: 6 }]
      })
    })

    it('runs backfill without overwriting existing computed or provider costs', async () => {
      await seedProvider([], { providerId: 'openai' })
      await seedModelPricing()

      await dbh.db.insert(usageLedgerTable).values([
        {
          messageId: 'missing',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          apiKeyAttribution: 'none',
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          totalTokens: 2_000_000,
          createdAt: 1000,
          updatedAt: 1000
        },
        {
          messageId: 'computed',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          apiKeyAttribution: 'none',
          inputTokens: 1_000_000,
          cost: 99,
          costCurrency: 'USD',
          costSource: 'computed',
          createdAt: 2000,
          updatedAt: 2000
        },
        {
          messageId: 'provider-cost',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          apiKeyAttribution: 'none',
          inputTokens: 1_000_000,
          cost: 7,
          costCurrency: 'USD',
          costSource: 'provider',
          createdAt: 3000,
          updatedAt: 3000
        },
        {
          messageId: 'image',
          providerId: 'openai',
          modelId: 'openai::gpt-4o',
          modality: 'image',
          apiKeyAttribution: 'none',
          imageCount: 1,
          createdAt: 4000,
          updatedAt: 4000
        }
      ])

      const result = await usageLedgerService.runCostBackfill({ modelId: 'openai::gpt-4o' })

      expect(result).toMatchObject({
        scannedCount: 1,
        recalculableCount: 1,
        skippedProviderCostCount: 1,
        updatedCount: 1
      })

      const rows = await dbh.db.select().from(usageLedgerTable)
      const missing = rows.find((row) => row.messageId === 'missing')
      expect(missing).toMatchObject({
        cost: 18,
        costCurrency: 'USD',
        costSource: 'computed',
        costBreakdown: { input: 3, output: 15 },
        pricingSnapshot: expect.objectContaining({ input: 3, output: 15, capturedAt: expect.any(String) })
      })
      expect(rows.find((row) => row.messageId === 'computed')).toMatchObject({ cost: 99, costSource: 'computed' })
      expect(rows.find((row) => row.messageId === 'provider-cost')).toMatchObject({
        cost: 7,
        costSource: 'provider'
      })
      expect(rows.find((row) => row.messageId === 'image')).toMatchObject({ cost: null, costSource: null })
    })

    it('skips missing-cost rows when current model pricing is unavailable', async () => {
      await dbh.db.insert(usageLedgerTable).values({
        messageId: 'missing',
        providerId: 'openai',
        modelId: 'openai::gpt-4o',
        apiKeyAttribution: 'none',
        inputTokens: 1_000_000,
        totalTokens: 1_000_000,
        createdAt: 1000,
        updatedAt: 1000
      })

      const result = await usageLedgerService.runCostBackfill({ modelId: 'openai::gpt-4o' })

      expect(result).toMatchObject({
        scannedCount: 1,
        recalculableCount: 0,
        skippedNoPricingCount: 1,
        updatedCount: 0
      })
      const [row] = await dbh.db.select().from(usageLedgerTable)
      expect(row.cost).toBeNull()
    })
  })

  describe('resolveKeyAttribution', () => {
    it('is exact with a single enabled key, with label and masked key snapshot', async () => {
      await seedProvider([
        { id: 'key-a', key: 'sk-test-1234567890abcdefgh', label: 'Main', isEnabled: true },
        { id: 'key-b', key: 'sk-disabled', label: 'Off', isEnabled: false }
      ])

      const result = await usageLedgerService.resolveKeyAttribution('openai')
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

      const result = await usageLedgerService.resolveKeyAttribution('openai')
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

      expect(await usageLedgerService.resolveKeyAttribution('openai')).toEqual({
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

      expect(await usageLedgerService.resolveKeyAttribution('openai')).toEqual({
        attribution: 'none',
        providerName: 'Test Provider'
      })
    })

    it('attributes IAM providers to auth, not a key', async () => {
      await seedProvider([], { providerId: 'bedrock', authConfig: { type: 'iam-aws', region: 'us-east-1' } })

      expect(await usageLedgerService.resolveKeyAttribution('bedrock')).toEqual({
        attribution: 'auth',
        providerName: 'Test Provider'
      })
    })

    it('attributes keyless OAuth providers to auth', async () => {
      await seedProvider([], { providerId: 'claude-oauth', authConfig: { type: 'oauth' } })

      expect(await usageLedgerService.resolveKeyAttribution('claude-oauth')).toEqual({
        attribution: 'auth',
        providerName: 'Test Provider'
      })
    })

    it('returns none for api-key providers without keys and for missing providers', async () => {
      await seedProvider([], { providerId: 'ollama' })

      expect(await usageLedgerService.resolveKeyAttribution('ollama')).toEqual({
        attribution: 'none',
        providerName: 'Test Provider'
      })
      expect(await usageLedgerService.resolveKeyAttribution('ghost')).toEqual({ attribution: 'none' })
    })

    it('never stores a short key raw — masked snapshot is clamped to ****', async () => {
      await seedProvider([{ id: 'key-a', key: 'token123', label: 'Short', isEnabled: true }])

      const result = await usageLedgerService.resolveKeyAttribution('openai')
      expect(result.masked).toBe('****')
    })
  })

  describe('list', () => {
    it('filters by provider/key/time and paginates newest-first', async () => {
      const base = {
        modelId: 'p::m',
        apiKeyAttribution: 'exact',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        cost: 0.01,
        costCurrency: 'USD'
      }
      await dbh.db.insert(usageLedgerTable).values([
        { ...base, messageId: 'm1', providerId: 'openai', apiKeyId: 'key-a', createdAt: 1000, updatedAt: 1000 },
        { ...base, messageId: 'm2', providerId: 'openai', apiKeyId: 'key-b', createdAt: 2000, updatedAt: 2000 },
        { ...base, messageId: 'm3', providerId: 'anthropic', apiKeyId: 'key-c', createdAt: 3000, updatedAt: 3000 }
      ])

      const byProvider = await usageLedgerService.list({ page: 1, limit: 50, providerId: 'openai' })
      expect(byProvider.items.map((i) => i.messageId)).toEqual(['m2', 'm1'])
      expect(byProvider.total).toBe(2)

      const byKey = await usageLedgerService.list({ page: 1, limit: 50, apiKeyId: 'key-c' })
      expect(byKey.items.map((i) => i.messageId)).toEqual(['m3'])

      const byTime = await usageLedgerService.list({ page: 1, limit: 50, from: 1500, to: 2500 })
      expect(byTime.items.map((i) => i.messageId)).toEqual(['m2'])

      const page1 = await usageLedgerService.list({ page: 1, limit: 2 })
      expect(page1.items.map((i) => i.messageId)).toEqual(['m3', 'm2'])
      expect(page1.page).toBe(1)

      const page2 = await usageLedgerService.list({ page: 2, limit: 2 })
      expect(page2.items.map((i) => i.messageId)).toEqual(['m1'])
      expect(page2.page).toBe(2)
    })

    it('sorts entries by request metrics before paginating', async () => {
      const base = {
        providerId: 'openai',
        modelId: 'openai::gpt-4o',
        apiKeyAttribution: 'none',
        costCurrency: 'USD'
      } as const
      await dbh.db.insert(usageLedgerTable).values([
        {
          ...base,
          messageId: 'slow',
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
          messageId: 'fast',
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
          messageId: 'expensive',
          outputTokens: 30,
          totalTokens: 60,
          cost: 2,
          timeFirstTokenMs: 300,
          timeCompletionMs: 900,
          createdAt: 3000,
          updatedAt: 3000
        }
      ])

      await expect(usageLedgerService.list({ page: 1, limit: 3, sortBy: 'totalTokens' })).resolves.toMatchObject({
        items: [{ messageId: 'fast' }, { messageId: 'expensive' }, { messageId: 'slow' }]
      })
      await expect(usageLedgerService.list({ page: 1, limit: 3, sortBy: 'cost' })).resolves.toMatchObject({
        items: [{ messageId: 'expensive' }, { messageId: 'slow' }, { messageId: 'fast' }]
      })
      await expect(
        usageLedgerService.list({ page: 1, limit: 3, sortBy: 'timeFirstTokenMs', sortDirection: 'asc' })
      ).resolves.toMatchObject({
        items: [{ messageId: 'fast' }, { messageId: 'expensive' }, { messageId: 'slow' }]
      })
      await expect(usageLedgerService.list({ page: 1, limit: 2, sortBy: 'tokensPerSecond' })).resolves.toMatchObject({
        items: [{ messageId: 'fast' }, { messageId: 'expensive' }],
        page: 1
      })
    })
  })

  describe('stats', () => {
    it('aggregates by api key and never mixes currencies', async () => {
      const base = { providerId: 'openai', modelId: 'openai::gpt-4o', apiKeyAttribution: 'exact' }
      await dbh.db.insert(usageLedgerTable).values([
        {
          ...base,
          messageId: 'm1',
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
          messageId: 'm2',
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
          messageId: 'm3',
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
          messageId: 'm4',
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

      const { buckets } = await usageLedgerService.stats({ groupBy: 'apiKey' })

      expect(buckets).toHaveLength(3)
      const keyAUsd = buckets.find((b) => b.apiKeyId === 'key-a' && b.costCurrency === 'USD')
      expect(keyAUsd).toMatchObject({
        apiKeyLabel: 'Main',
        totalCost: 2,
        totalInputTokens: 300,
        totalOutputTokens: 150,
        totalTokens: 450,
        entryCount: 2
      })
      const keyACny = buckets.find((b) => b.apiKeyId === 'key-a' && b.costCurrency === 'CNY')
      expect(keyACny).toMatchObject({ totalCost: 7, entryCount: 1 })
      // Ordered by total cost descending
      expect(buckets[0]).toMatchObject({ costCurrency: 'CNY', totalCost: 7 })
    })

    it('falls back to the current provider name when old ledger rows only have the provider id snapshot', async () => {
      await seedProvider([], { providerId: 'custom-provider' })
      await dbh.db.insert(usageLedgerTable).values({
        messageId: 'snapshotless-row',
        providerId: 'custom-provider',
        providerName: 'custom-provider',
        modelId: 'custom-provider::model-a',
        apiKeyAttribution: 'none',
        totalTokens: 12,
        cost: 0.1,
        costCurrency: 'USD',
        createdAt: 1000,
        updatedAt: 1000
      })

      const stats = await usageLedgerService.stats({ groupBy: 'provider' })
      expect(stats.buckets[0]).toMatchObject({
        providerId: 'custom-provider',
        providerName: 'Test Provider'
      })

      const list = await usageLedgerService.list({ page: 1, limit: 10 })
      expect(list.items[0]).toMatchObject({
        providerId: 'custom-provider',
        providerName: 'Test Provider'
      })
    })

    it('aggregates by provider with a time window', async () => {
      await dbh.db.insert(usageLedgerTable).values([
        {
          messageId: 'm1',
          providerId: 'openai',
          apiKeyAttribution: 'none',
          cost: 1,
          costCurrency: 'USD',
          createdAt: 1000,
          updatedAt: 1000
        },
        {
          messageId: 'm2',
          providerId: 'openai',
          apiKeyAttribution: 'none',
          cost: 2,
          costCurrency: 'USD',
          createdAt: 5000,
          updatedAt: 5000
        }
      ])

      const { buckets } = await usageLedgerService.stats({ groupBy: 'provider', from: 2000 })
      expect(buckets).toHaveLength(1)
      expect(buckets[0]).toMatchObject({ providerId: 'openai', totalCost: 2, entryCount: 1 })
    })

    it('aggregates by assistant and agent source', async () => {
      await dbh.db.insert(usageLedgerTable).values([
        {
          messageId: 'assistant-row-1',
          providerId: 'openai',
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
          createdAt: 1000,
          updatedAt: 1000
        },
        {
          messageId: 'assistant-row-2',
          providerId: 'openai',
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
          createdAt: 2000,
          updatedAt: 2000
        },
        {
          messageId: 'agent-row',
          providerId: 'openai',
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
          createdAt: 3000,
          updatedAt: 3000
        }
      ])

      const { buckets } = await usageLedgerService.stats({ groupBy: 'source' })
      const assistant = buckets.find((bucket) => bucket.sourceType === 'assistant')
      const agent = buckets.find((bucket) => bucket.sourceType === 'agent')

      expect(assistant).toMatchObject({
        sourceId: 'assistant-1',
        sourceName: 'Assistant One',
        sourceIcon: '✨',
        totalCost: 1.5,
        totalNoCacheTokens: 60,
        totalCacheReadTokens: 30,
        totalCacheWriteTokens: 30,
        entryCount: 2
      })
      expect(agent).toMatchObject({
        sourceId: 'agent-1',
        sourceName: 'Agent One',
        sourceIcon: '🧠',
        totalCost: 0.25,
        entryCount: 1
      })
    })
  })

  describe('timeline', () => {
    const base = {
      providerId: 'openai',
      modelId: 'openai::gpt-4o',
      apiKeyAttribution: 'none'
    } as const

    it('collapses rows on the same local day into one bucket', async () => {
      const first = new Date(2026, 0, 2, 1).getTime()
      const second = new Date(2026, 0, 2, 23).getTime()

      await dbh.db.insert(usageLedgerTable).values([
        { ...base, messageId: 'm1', totalTokens: 100, cost: 0.25, createdAt: first, updatedAt: first },
        { ...base, messageId: 'm2', totalTokens: 50, cost: 0.75, createdAt: second, updatedAt: second }
      ])

      const { buckets } = await usageLedgerService.timeline({})

      expect(buckets).toEqual([
        {
          date: localDateKey(first),
          totalTokens: 150,
          totalNoCacheTokens: 0,
          totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0,
          totalCost: 1,
          entryCount: 2
        }
      ])
    })

    it('returns multi-day buckets in ascending order without empty-day gaps', async () => {
      const day1 = new Date(2026, 0, 1, 12).getTime()
      const day3 = new Date(2026, 0, 3, 12).getTime()

      await dbh.db.insert(usageLedgerTable).values([
        { ...base, messageId: 'm3', totalTokens: 30, cost: 0.3, createdAt: day3, updatedAt: day3 },
        { ...base, messageId: 'm1', totalTokens: 10, cost: 0.1, createdAt: day1, updatedAt: day1 }
      ])

      const { buckets } = await usageLedgerService.timeline({})

      expect(buckets.map((bucket) => bucket.date)).toEqual([localDateKey(day1), localDateKey(day3)])
      expect(buckets.map((bucket) => bucket.totalTokens)).toEqual([10, 30])
    })

    it('respects inclusive from and to bounds', async () => {
      const before = new Date(2026, 0, 1, 12).getTime()
      const from = new Date(2026, 0, 2, 0).getTime()
      const inside = new Date(2026, 0, 2, 12).getTime()
      const to = new Date(2026, 0, 2, 23, 59, 59, 999).getTime()
      const after = new Date(2026, 0, 3, 12).getTime()

      await dbh.db.insert(usageLedgerTable).values([
        { ...base, messageId: 'm-before', totalTokens: 10, cost: 0.1, createdAt: before, updatedAt: before },
        { ...base, messageId: 'm-from', totalTokens: 20, cost: 0.2, createdAt: from, updatedAt: from },
        { ...base, messageId: 'm-inside', totalTokens: 30, cost: 0.3, createdAt: inside, updatedAt: inside },
        { ...base, messageId: 'm-to', totalTokens: 40, cost: 0.4, createdAt: to, updatedAt: to },
        { ...base, messageId: 'm-after', totalTokens: 50, cost: 0.5, createdAt: after, updatedAt: after }
      ])

      const { buckets } = await usageLedgerService.timeline({ from, to })

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
