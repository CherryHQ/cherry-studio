import { resolve } from 'node:path'

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { usageLedgerTable } from '@data/db/schemas/usageLedger'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { UsageLedgerService, usageLedgerService } from '@data/services/UsageLedgerService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import type { Message } from '@shared/data/types/message'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { eq } from 'drizzle-orm'
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
      inputTokenDetails: { cacheReadTokens: 30, cacheWriteTokens: 10 },
      cost: 0.0042,
      costCurrency: 'USD',
      costSource: 'computed'
    },
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z',
    ...overrides
  } as Message
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

      await usageLedgerService.recordFromMessage(makeMessage())

      const rows = await dbh.db.select().from(usageLedgerTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        topicId: 'topic-1',
        providerId: 'openai',
        modelId: 'openai::gpt-4o',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadTokens: 30,
        cacheWriteTokens: 10,
        cost: 0.0042,
        costCurrency: 'USD',
        costSource: 'computed'
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
      expect(rows[0]).toMatchObject({ inputTokens: 20, apiKeyId: 'key-a', apiKeyAttribution: 'exact' })
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
        costCurrency: 'USD'
      })
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
      expect(result).toMatchObject({ attribution: 'rotation', keyId: 'key-b', label: 'B' })
    })

    it('returns none with multiple keys but no rotation pointer (e.g. after restart)', async () => {
      await seedProvider([
        { id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true },
        { id: 'key-b', key: 'sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbb', isEnabled: true }
      ])

      expect(await usageLedgerService.resolveKeyAttribution('openai')).toEqual({ attribution: 'none' })
    })

    it('returns none when the pointed-at key was deleted', async () => {
      await seedProvider([
        { id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true },
        { id: 'key-b', key: 'sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbb', isEnabled: true }
      ])
      MockMainCacheServiceUtils.setCacheValue('settings.provider.openai.last_used_key_id', 'deleted-key')

      expect(await usageLedgerService.resolveKeyAttribution('openai')).toEqual({ attribution: 'none' })
    })

    it('attributes IAM providers to auth, not a key', async () => {
      await seedProvider([], { providerId: 'bedrock', authConfig: { type: 'iam-aws', region: 'us-east-1' } })

      expect(await usageLedgerService.resolveKeyAttribution('bedrock')).toEqual({ attribution: 'auth' })
    })

    it('attributes keyless OAuth providers to auth', async () => {
      await seedProvider([], { providerId: 'claude-oauth', authConfig: { type: 'oauth' } })

      expect(await usageLedgerService.resolveKeyAttribution('claude-oauth')).toEqual({ attribution: 'auth' })
    })

    it('returns none for api-key providers without keys and for missing providers', async () => {
      await seedProvider([], { providerId: 'ollama' })

      expect(await usageLedgerService.resolveKeyAttribution('ollama')).toEqual({ attribution: 'none' })
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

      const byProvider = await usageLedgerService.list({ limit: 50, providerId: 'openai' })
      expect(byProvider.items.map((i) => i.messageId)).toEqual(['m2', 'm1'])
      expect(byProvider.total).toBe(2)

      const byKey = await usageLedgerService.list({ limit: 50, apiKeyId: 'key-c' })
      expect(byKey.items.map((i) => i.messageId)).toEqual(['m3'])

      const byTime = await usageLedgerService.list({ limit: 50, from: 1500, to: 2500 })
      expect(byTime.items.map((i) => i.messageId)).toEqual(['m2'])

      const page1 = await usageLedgerService.list({ limit: 2 })
      expect(page1.items.map((i) => i.messageId)).toEqual(['m3', 'm2'])
      expect(page1.nextCursor).toBeDefined()
      const page2 = await usageLedgerService.list({ limit: 2, cursor: page1.nextCursor })
      expect(page2.items.map((i) => i.messageId)).toEqual(['m1'])
      expect(page2.nextCursor).toBeUndefined()

      // Malformed cursors (including ':id' whose createdAt half is empty)
      // fall back to the first page instead of returning an empty page.
      const emptyCreatedAt = await usageLedgerService.list({ limit: 2, cursor: ':some-id' })
      expect(emptyCreatedAt.items.map((i) => i.messageId)).toEqual(['m3', 'm2'])
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
  })

  describe('reconcileFromMessages', () => {
    async function seedMessageChain(opts: { messageId: string; createdAt: number; stats: Message['stats'] }) {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-r', activeNodeId: null, orderKey: 'a0' })
        .onConflictDoNothing()
      await dbh.db
        .insert(userModelTable)
        .values({
          id: 'openai::gpt-4o',
          providerId: 'openai',
          modelId: 'gpt-4o',
          presetModelId: 'gpt-4o',
          name: 'gpt-4o',
          isEnabled: true,
          isHidden: false,
          orderKey: 'a0'
        })
        .onConflictDoNothing()
      await dbh.db.insert(messageTable).values({
        id: opts.messageId,
        topicId: 'topic-r',
        parentId: null,
        role: 'assistant',
        data: { parts: [] },
        status: 'success',
        modelId: 'openai::gpt-4o',
        stats: opts.stats ?? undefined,
        createdAt: opts.createdAt,
        updatedAt: opts.createdAt
      })
    }

    it('backfills missing rows with usage-time timestamps and single-key backfill attribution', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', label: 'Main', isEnabled: true }])
      await seedMessageChain({
        messageId: 'm-old',
        createdAt: 12345,
        stats: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.01 }
      })

      const count = await usageLedgerService.reconcileFromMessages()
      expect(count).toBe(1)

      const [row] = await dbh.db.select().from(usageLedgerTable).where(eq(usageLedgerTable.messageId, 'm-old'))
      expect(row).toMatchObject({
        providerId: 'openai',
        inputTokens: 10,
        totalTokens: 15,
        cost: 0.01,
        apiKeyId: 'key-a',
        apiKeyAttribution: 'backfill',
        createdAt: 12345,
        updatedAt: 12345
      })
    })

    it('uses none attribution when the provider has multiple keys', async () => {
      await seedProvider([
        { id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true },
        { id: 'key-b', key: 'sk-bbbbbbbbbbbbbbbbbbbbbbbbbbbb', isEnabled: true }
      ])
      await seedMessageChain({ messageId: 'm-multi', createdAt: 100, stats: { totalTokens: 5 } })

      await usageLedgerService.reconcileFromMessages()

      const [row] = await dbh.db.select().from(usageLedgerTable).where(eq(usageLedgerTable.messageId, 'm-multi'))
      expect(row).toMatchObject({ apiKeyId: null, apiKeyAttribution: 'none' })
    })

    it('never touches existing rows and skips messages without usage signal', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])
      await seedMessageChain({ messageId: 'm-live', createdAt: 100, stats: { totalTokens: 999 } })
      await seedMessageChain({ messageId: 'm-timing-only', createdAt: 200, stats: { timeCompletionMs: 50 } })
      // Existing (live-written) row for m-live with values that must survive.
      await dbh.db.insert(usageLedgerTable).values({
        messageId: 'm-live',
        providerId: 'openai',
        apiKeyAttribution: 'exact',
        totalTokens: 111,
        createdAt: 100,
        updatedAt: 100
      })

      const count = await usageLedgerService.reconcileFromMessages()
      expect(count).toBe(0)

      const rows = await dbh.db.select().from(usageLedgerTable)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ messageId: 'm-live', totalTokens: 111, apiKeyAttribution: 'exact' })
    })

    it('runs lazily (once) before list/stats reads', async () => {
      await seedProvider([{ id: 'key-a', key: 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaa', isEnabled: true }])
      await seedMessageChain({ messageId: 'm-lazy', createdAt: 100, stats: { totalTokens: 7 } })

      // Fresh instance: the module singleton's once-per-process guard may
      // already be latched by earlier tests.
      const service = new UsageLedgerService()
      const result = await service.list({ limit: 50 })
      expect(result.items.map((i) => i.messageId)).toEqual(['m-lazy'])
    })
  })
})
