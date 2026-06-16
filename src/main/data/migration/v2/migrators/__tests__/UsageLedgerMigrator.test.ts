import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { usageLedgerTable } from '@data/db/schemas/usageLedger'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { maskApiKeyForSnapshot } from '@shared/utils/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { getAllMigrators } from '../index'
import { UsageLedgerMigrator } from '../UsageLedgerMigrator'

describe('UsageLedgerMigrator', () => {
  const dbh = setupTestDatabase()
  const historicalApiKey = {
    id: 'key-primary',
    key: 'sk-historical-api-key-000000000000',
    label: 'Primary',
    isEnabled: true
  }

  function ctxOf(): MigrationContext {
    return { db: dbh.db } as unknown as MigrationContext
  }

  beforeEach(async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: 'openai',
      name: 'OpenAI',
      apiKeys: [historicalApiKey],
      orderKey: 'a0',
      isEnabled: true
    })
    await dbh.db.insert(userModelTable).values({
      id: 'openai::gpt-4o',
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o',
      name: 'gpt-4o',
      isEnabled: true,
      isHidden: false,
      orderKey: 'a0'
    })
    await dbh.db.insert(assistantTable).values({
      id: 'assistant-ledger',
      name: 'Ledger Assistant',
      prompt: '',
      emoji: '🌟',
      settings: DEFAULT_ASSISTANT_SETTINGS,
      orderKey: 'a0'
    })
    await dbh.db
      .insert(topicTable)
      .values({ id: 'topic-ledger', assistantId: 'assistant-ledger', activeNodeId: null, orderKey: 'a0' })
    await dbh.db.insert(agentTable).values({
      id: 'agent-ledger',
      type: 'claude_code',
      name: 'Ledger Agent',
      instructions: '',
      model: null,
      configuration: { avatar: '🧠' },
      orderKey: 'a0'
    })
    await dbh.db.insert(agentWorkspaceTable).values({
      id: 'workspace-ledger',
      name: 'Ledger Workspace',
      path: '/tmp/ledger-workspace',
      type: 'user',
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSessionTable).values({
      id: 'agent-session-ledger',
      agentId: 'agent-ledger',
      name: 'Ledger Session',
      workspaceId: 'workspace-ledger',
      orderKey: 'a0'
    })
  })

  it('is registered after chat migration and before later history migrators', () => {
    const migrators = getAllMigrators()
    const usageLedger = migrators.find((migrator) => migrator.id === 'usage-ledger')
    const chat = migrators.find((migrator) => migrator.id === 'chat')
    const painting = migrators.find((migrator) => migrator.id === 'painting')

    expect(usageLedger).toBeInstanceOf(UsageLedgerMigrator)
    expect(chat && usageLedger && chat.order < usageLedger.order).toBe(true)
    expect(usageLedger && painting && usageLedger.order < painting.order).toBe(true)
  })

  it('backfills usage ledger rows from migrated chat and agent session messages', async () => {
    await dbh.db.insert(messageTable).values({
      id: 'chat-message-ledger',
      topicId: 'topic-ledger',
      parentId: null,
      role: 'assistant',
      data: { parts: [] },
      status: 'success',
      modelId: 'openai::gpt-4o',
      stats: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        inputTokenDetails: { noCacheTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 },
        outputTokenDetails: { reasoningTokens: 4 },
        cost: 0.01,
        costCurrency: 'USD',
        costSource: 'provider'
      },
      createdAt: 1000,
      updatedAt: 1000
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: 'agent-message-ledger',
      sessionId: 'agent-session-ledger',
      role: 'assistant',
      data: { parts: [] },
      status: 'success',
      modelId: 'openai::gpt-4o',
      stats: { inputTokens: 3, outputTokens: 4, totalTokens: 7, cost: 0.02 },
      createdAt: 2000,
      updatedAt: 2000
    })

    const migrator = new UsageLedgerMigrator()
    expect(await migrator.prepare(ctxOf())).toMatchObject({ success: true, itemCount: 2 })
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 2 })
    expect(await migrator.validate(ctxOf())).toMatchObject({
      success: true,
      stats: { sourceCount: 2, targetCount: 2, skippedCount: 0 }
    })

    const rows = await dbh.db.select().from(usageLedgerTable)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.messageId === 'chat-message-ledger')).toMatchObject({
      topicId: 'topic-ledger',
      providerId: 'openai',
      providerName: 'OpenAI',
      sourceType: 'assistant',
      sourceId: 'assistant-ledger',
      sourceName: 'Ledger Assistant',
      sourceIcon: '🌟',
      modelId: 'openai::gpt-4o',
      modality: 'language',
      apiKeyId: 'key-primary',
      apiKeyLabel: 'Primary',
      apiKeyMasked: maskApiKeyForSnapshot(historicalApiKey.key),
      apiKeyAttribution: 'backfill',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      reasoningTokens: 4,
      noCacheTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      cost: 0.01,
      costCurrency: 'USD',
      costSource: 'provider',
      createdAt: 1000,
      updatedAt: 1000
    })
    expect(rows.find((row) => row.messageId === 'agent-message-ledger')).toMatchObject({
      topicId: null,
      providerId: 'openai',
      providerName: 'OpenAI',
      sourceType: 'agent',
      sourceId: 'agent-ledger',
      sourceName: 'Ledger Agent',
      sourceIcon: '🧠',
      apiKeyId: 'key-primary',
      apiKeyAttribution: 'backfill',
      totalTokens: 7,
      cost: 0.02,
      createdAt: 2000,
      updatedAt: 2000
    })
  })

  it('skips stats without usage signal and invalid model ids', async () => {
    await dbh.db.insert(userModelTable).values({
      id: 'not-a-unique-model-id',
      providerId: 'openai',
      modelId: 'not-a-unique-model-id',
      presetModelId: 'not-a-unique-model-id',
      name: 'Invalid model id',
      isEnabled: true,
      isHidden: false,
      orderKey: 'a1'
    })
    await dbh.db.insert(messageTable).values([
      {
        id: 'timing-only',
        topicId: 'topic-ledger',
        parentId: null,
        role: 'assistant',
        data: { parts: [] },
        status: 'success',
        modelId: 'openai::gpt-4o',
        stats: { timeCompletionMs: 10 },
        createdAt: 1000,
        updatedAt: 1000
      },
      {
        id: 'invalid-model',
        topicId: 'topic-ledger',
        parentId: null,
        role: 'assistant',
        data: { parts: [] },
        status: 'success',
        modelId: 'not-a-unique-model-id',
        stats: { totalTokens: 3 },
        createdAt: 2000,
        updatedAt: 2000
      }
    ])

    const migrator = new UsageLedgerMigrator()
    expect(await migrator.prepare(ctxOf())).toMatchObject({ success: true, itemCount: 2 })
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 0 })
    expect(await migrator.validate(ctxOf())).toMatchObject({
      success: true,
      stats: { sourceCount: 2, targetCount: 0, skippedCount: 2 }
    })
    expect(await dbh.db.select().from(usageLedgerTable).where(eq(usageLedgerTable.messageId, 'timing-only'))).toEqual(
      []
    )
  })

  it('computes missing historical cost during migration when model pricing exists', async () => {
    await dbh.db
      .update(userModelTable)
      .set({
        pricing: {
          input: { perMillionTokens: 3, currency: 'USD' },
          output: { perMillionTokens: 15, currency: 'USD' }
        }
      })
      .where(eq(userModelTable.id, 'openai::gpt-4o'))
    await dbh.db.insert(messageTable).values({
      id: 'chat-message-computed-ledger',
      topicId: 'topic-ledger',
      parentId: null,
      role: 'assistant',
      data: { parts: [] },
      status: 'success',
      modelId: 'openai::gpt-4o',
      stats: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        totalTokens: 2_000_000
      },
      createdAt: 1000,
      updatedAt: 1000
    })

    const migrator = new UsageLedgerMigrator()
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 1 })

    const [row] = await dbh.db
      .select()
      .from(usageLedgerTable)
      .where(eq(usageLedgerTable.messageId, 'chat-message-computed-ledger'))
    expect(row).toMatchObject({
      cost: 18,
      costCurrency: 'USD',
      costSource: 'computed',
      costBreakdown: { input: 3, output: 15 },
      pricingSnapshot: expect.objectContaining({ input: 3, output: 15, capturedAt: expect.any(String) })
    })
  })

  it('keeps migrated usage cost null when model pricing is unavailable', async () => {
    await dbh.db.insert(messageTable).values({
      id: 'chat-message-unpriced-ledger',
      topicId: 'topic-ledger',
      parentId: null,
      role: 'assistant',
      data: { parts: [] },
      status: 'success',
      modelId: 'openai::gpt-4o',
      stats: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        totalTokens: 2_000_000
      },
      createdAt: 1000,
      updatedAt: 1000
    })

    const migrator = new UsageLedgerMigrator()
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 1 })

    const [row] = await dbh.db
      .select()
      .from(usageLedgerTable)
      .where(eq(usageLedgerTable.messageId, 'chat-message-unpriced-ledger'))
    expect(row).toMatchObject({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cost: null,
      costCurrency: null,
      costSource: null
    })
  })

  it('uses agent message model snapshots when modelId cannot be resolved to user_model', async () => {
    await dbh.db.insert(agentSessionMessageTable).values({
      id: 'agent-message-snapshot-ledger',
      sessionId: 'agent-session-ledger',
      role: 'assistant',
      data: { parts: [] },
      status: 'success',
      modelId: null,
      modelSnapshot: {
        id: 'anthropic/claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5',
        provider: 'cherryin',
        group: 'anthropic'
      },
      stats: { inputTokens: 5, outputTokens: 8, totalTokens: 13 },
      createdAt: 3000,
      updatedAt: 3000
    })

    const migrator = new UsageLedgerMigrator()
    expect(await migrator.prepare(ctxOf())).toMatchObject({ success: true, itemCount: 1 })
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 1 })

    const [row] = await dbh.db
      .select()
      .from(usageLedgerTable)
      .where(eq(usageLedgerTable.messageId, 'agent-message-snapshot-ledger'))
    expect(row).toMatchObject({
      topicId: null,
      providerId: 'cherryin',
      providerName: 'cherryin',
      modelId: 'cherryin::anthropic/claude-sonnet-4.5',
      totalTokens: 13,
      createdAt: 3000,
      updatedAt: 3000
    })
  })
})
