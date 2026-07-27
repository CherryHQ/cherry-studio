import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import type { MigrationContext } from '../../core/MigrationContext'
import { importLegacySessionMessages } from '../AgentsMigrator'
import { AiUsageRecordMigrator } from '../AiUsageRecordMigrator'
import { createEmptyAgentsSchemaInfo } from '../mappings/AgentsDbMappings'
import { getAllMigrators } from '../migratorRegistry'

describe('AiUsageRecordMigrator', () => {
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

  beforeEach(() => {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'openai',
        name: 'OpenAI',
        apiKeys: [historicalApiKey],
        orderKey: 'a0',
        isEnabled: true
      })
      .run()
    dbh.db
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
      .run()
    dbh.db
      .insert(assistantTable)
      .values({
        id: 'assistant-usage',
        name: 'Usage Assistant',
        prompt: '',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(topicTable)
      .values({ id: 'topic-usage', assistantId: 'assistant-usage', activeNodeId: null, orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent-usage',
        type: 'claude_code',
        name: 'Usage Agent',
        instructions: '',
        model: null,
        configuration: { avatar: '🧠' },
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({
        id: 'workspace-usage',
        name: 'Usage Workspace',
        path: '/tmp/usage-workspace',
        type: 'user',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({
        id: 'agent-session-usage',
        agentId: 'agent-usage',
        name: 'Usage Session',
        workspaceId: 'workspace-usage',
        orderKey: 'a0'
      })
      .run()
  })

  it('is registered after chat migration and before later history migrators', () => {
    const migrators = getAllMigrators()
    const aiUsageRecord = migrators.find((migrator) => migrator.id === 'ai-usage-record')
    const chat = migrators.find((migrator) => migrator.id === 'chat')
    const painting = migrators.find((migrator) => migrator.id === 'painting')

    expect(aiUsageRecord).toBeInstanceOf(AiUsageRecordMigrator)
    expect(chat && aiUsageRecord && chat.order < aiUsageRecord.order).toBe(true)
    expect(aiUsageRecord && painting && aiUsageRecord.order < painting.order).toBe(true)
  })

  it('walks multiple keyset batches and reports progress', async () => {
    const messages: Array<typeof messageTable.$inferInsert> = Array.from({ length: 501 }, (_, index) => ({
      id: `batch-${String(index).padStart(4, '0')}`,
      topicId: 'topic-usage',
      parentId: null,
      role: 'assistant',
      data: { parts: [] },
      status: 'success',
      modelId: 'openai::gpt-4o',
      stats: { totalTokens: index },
      createdAt: 1000 + index,
      updatedAt: 1000 + index
    }))
    dbh.db.insert(messageTable).values(withRoot('topic-usage', messages)).run()

    const progress: number[] = []
    const migrator = new AiUsageRecordMigrator()
    migrator.setProgressCallback((value) => progress.push(value))

    expect(await migrator.prepare(ctxOf())).toMatchObject({ success: true, itemCount: 501 })
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 501 })
    expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(501)
    expect(progress.some((value) => value > 0 && value < 100)).toBe(true)
    expect(progress.at(-1)).toBe(100)
  })

  it('projects usage records from migrated chat and agent session messages', async () => {
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('topic-usage', [
          {
            id: 'chat-message-usage',
            topicId: 'topic-usage',
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
          }
        ])
      )
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: 'agent-message-usage',
        sessionId: 'agent-session-usage',
        role: 'assistant',
        data: { parts: [] },
        status: 'success',
        modelId: 'openai::gpt-4o',
        stats: { inputTokens: 3, outputTokens: 4, totalTokens: 7, cost: 0.02 },
        createdAt: 2000,
        updatedAt: 2000
      })
      .run()

    const migrator = new AiUsageRecordMigrator()
    expect(await migrator.prepare(ctxOf())).toMatchObject({ success: true, itemCount: 2 })
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 2 })
    expect(await migrator.validate(ctxOf())).toMatchObject({
      success: true,
      stats: { sourceCount: 2, targetCount: 2, skippedCount: 0 }
    })

    const rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.requestId === 'chat-message-usage')).toMatchObject({
      topicId: 'topic-usage',
      providerId: 'openai',
      providerName: 'OpenAI',
      sourceType: 'assistant',
      sourceId: 'assistant-usage',
      sourceName: 'Usage Assistant',
      sourceIcon: '🌟',
      modelId: 'openai::gpt-4o',
      modality: 'language',
      apiKeyId: null,
      apiKeyLabel: null,
      apiKeyMasked: null,
      apiKeyAttribution: 'unknown',
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
    expect(rows.find((row) => row.requestId === 'agent-message-usage')).toMatchObject({
      topicId: null,
      providerId: 'openai',
      providerName: 'OpenAI',
      sourceType: 'agent',
      sourceId: 'agent-usage',
      sourceName: 'Usage Agent',
      sourceIcon: '🧠',
      apiKeyId: null,
      apiKeyAttribution: 'unknown',
      totalTokens: 7,
      cost: 0.02,
      costCurrency: 'USD',
      costSource: 'provider',
      createdAt: 2000,
      updatedAt: 2000
    })

    // Rerunning the migrator is safe: the unique requestId key and conflict
    // target converge on the existing records instead of duplicating usage —
    // and the rerun reports 0 processed because nothing new was written.
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 0 })
    const rowsAfterRerun = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rowsAfterRerun).toHaveLength(2)
    expect(rowsAfterRerun.map((row) => row.requestId).sort()).toEqual(['agent-message-usage', 'chat-message-usage'])
  })

  it('does not infer a serving key for historical usage', async () => {
    dbh.db
      .insert(userProviderTable)
      .values([
        {
          providerId: 'multi-key',
          name: 'Multi Key',
          apiKeys: [
            { id: 'key-a', key: 'sk-multi-key-a-0000000000000000', label: 'A', isEnabled: true },
            { id: 'key-b', key: 'sk-multi-key-b-0000000000000000', label: 'B', isEnabled: true }
          ],
          orderKey: 'a1',
          isEnabled: true
        },
        {
          providerId: 'disabled-key',
          name: 'Disabled Key',
          apiKeys: [{ id: 'key-off', key: 'sk-disabled-key-0000000000000000', label: 'Off', isEnabled: false }],
          orderKey: 'a2',
          isEnabled: true
        }
      ])
      .run()
    dbh.db
      .insert(userModelTable)
      .values([
        {
          id: 'multi-key::m1',
          providerId: 'multi-key',
          modelId: 'm1',
          name: 'm1',
          isEnabled: true,
          isHidden: false,
          orderKey: 'a0'
        },
        {
          id: 'disabled-key::m1',
          providerId: 'disabled-key',
          modelId: 'm1',
          name: 'm1',
          isEnabled: true,
          isHidden: false,
          orderKey: 'a0'
        }
      ])
      .run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('topic-usage', [
          {
            id: 'multi-key-message',
            topicId: 'topic-usage',
            parentId: null,
            role: 'assistant',
            data: { parts: [] },
            status: 'success',
            modelId: 'multi-key::m1',
            stats: { totalTokens: 5 },
            createdAt: 1000,
            updatedAt: 1000
          },
          {
            id: 'disabled-key-message',
            topicId: 'topic-usage',
            parentId: null,
            role: 'assistant',
            data: { parts: [] },
            status: 'success',
            modelId: 'disabled-key::m1',
            stats: { totalTokens: 6 },
            createdAt: 2000,
            updatedAt: 2000
          },
          {
            id: 'single-key-message',
            topicId: 'topic-usage',
            parentId: null,
            role: 'assistant',
            data: { parts: [] },
            status: 'success',
            modelId: 'openai::gpt-4o',
            stats: { totalTokens: 7 },
            createdAt: 3000,
            updatedAt: 3000
          }
        ])
      )
      .run()

    const migrator = new AiUsageRecordMigrator()
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 3 })

    const rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows.find((row) => row.requestId === 'multi-key-message')).toMatchObject({
      apiKeyAttribution: 'unknown',
      apiKeyId: null,
      apiKeyLabel: null,
      apiKeyMasked: null
    })
    expect(rows.find((row) => row.requestId === 'disabled-key-message')).toMatchObject({
      apiKeyAttribution: 'unknown',
      apiKeyId: null,
      apiKeyLabel: null,
      apiKeyMasked: null
    })
    expect(rows.find((row) => row.requestId === 'single-key-message')).toMatchObject({
      apiKeyAttribution: 'unknown',
      apiKeyId: null,
      apiKeyLabel: null,
      apiKeyMasked: null
    })
  })

  it('skips stats without usage signal and invalid model ids', async () => {
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'not-a-unique-model-id',
        providerId: 'openai',
        modelId: 'not-a-unique-model-id',
        presetModelId: 'not-a-unique-model-id',
        name: 'Invalid model id',
        isEnabled: true,
        isHidden: false,
        orderKey: 'a1'
      })
      .run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('topic-usage', [
          {
            id: 'timing-only',
            topicId: 'topic-usage',
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
            topicId: 'topic-usage',
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
      )
      .run()

    const migrator = new AiUsageRecordMigrator()
    expect(await migrator.prepare(ctxOf())).toMatchObject({ success: true, itemCount: 2 })
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 0 })
    expect(await migrator.validate(ctxOf())).toMatchObject({
      success: true,
      stats: { sourceCount: 2, targetCount: 0, skippedCount: 2 }
    })
    expect(
      dbh.db.select().from(aiUsageRecordTable).where(eq(aiUsageRecordTable.requestId, 'timing-only')).all()
    ).toEqual([])
  })

  it('computes missing historical cost during migration when model pricing exists', async () => {
    dbh.db
      .update(userModelTable)
      .set({
        pricing: {
          input: { perMillionTokens: 3, currency: 'USD' },
          output: { perMillionTokens: 15, currency: 'USD' }
        }
      })
      .where(eq(userModelTable.id, 'openai::gpt-4o'))
      .run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('topic-usage', [
          {
            id: 'chat-message-computed-usage',
            topicId: 'topic-usage',
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
          }
        ])
      )
      .run()

    const migrator = new AiUsageRecordMigrator()
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 1 })

    const row = dbh.db
      .select()
      .from(aiUsageRecordTable)
      .where(eq(aiUsageRecordTable.requestId, 'chat-message-computed-usage'))
      .get()
    expect(row).toMatchObject({
      cost: 18,
      costCurrency: 'USD',
      costSource: 'computed',
      costBreakdown: { input: 3, output: 15 },
      pricingSnapshot: expect.objectContaining({ input: 3, output: 15, capturedAt: expect.any(String) })
    })
  })

  it('keeps migrated usage cost null when model pricing is unavailable', async () => {
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('topic-usage', [
          {
            id: 'chat-message-unpriced-usage',
            topicId: 'topic-usage',
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
          }
        ])
      )
      .run()

    const migrator = new AiUsageRecordMigrator()
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 1 })

    const row = dbh.db
      .select()
      .from(aiUsageRecordTable)
      .where(eq(aiUsageRecordTable.requestId, 'chat-message-unpriced-usage'))
      .get()
    expect(row).toMatchObject({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cost: null,
      costCurrency: null,
      costSource: null
    })
  })

  it('retries a failed batch row by row and skips only the malformed row', async () => {
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('topic-usage', [
          {
            id: 'chat-message-batch-good',
            topicId: 'topic-usage',
            parentId: null,
            role: 'assistant',
            data: { parts: [] },
            status: 'success',
            modelId: 'openai::gpt-4o',
            stats: { totalTokens: 9 },
            createdAt: 1000,
            updatedAt: 1000
          },
          {
            id: 'chat-message-batch-malformed',
            topicId: 'topic-usage',
            parentId: null,
            role: 'assistant',
            data: { parts: [] },
            status: 'success',
            modelId: 'openai::gpt-4o',
            // An object where an integer column is expected: the driver rejects the
            // bulk bind, forcing the migrator to isolate this row on retry.
            stats: { inputTokens: { broken: true } } as never,
            createdAt: 2000,
            updatedAt: 2000
          }
        ])
      )
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: 'agent-message-batch-good',
        sessionId: 'agent-session-usage',
        role: 'assistant',
        data: { parts: [] },
        status: 'success',
        modelId: 'openai::gpt-4o',
        stats: { totalTokens: 4 },
        createdAt: 3000,
        updatedAt: 3000
      })
      .run()

    const migrator = new AiUsageRecordMigrator()
    const result = await migrator.execute(ctxOf())
    expect(result).toMatchObject({ success: true, processedCount: 2 })
    expect(result.warnings).toHaveLength(1)
    expect(await migrator.validate(ctxOf())).toMatchObject({
      success: true,
      stats: { sourceCount: 3, targetCount: 2, skippedCount: 1 }
    })

    const rows = dbh.db.select().from(aiUsageRecordTable).all()
    expect(rows.map((row) => row.requestId).sort()).toEqual(['agent-message-batch-good', 'chat-message-batch-good'])
  })

  it('uses agent message model snapshots when modelId cannot be resolved to user_model', async () => {
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: 'agent-message-snapshot-usage',
        sessionId: 'agent-session-usage',
        role: 'assistant',
        data: { parts: [] },
        status: 'success',
        modelId: null,
        messageSnapshot: {
          id: 'agent-at-request-time',
          name: 'Original Agent',
          emoji: '🕰️',
          model: {
            id: 'anthropic/claude-sonnet-4.5',
            name: 'Claude Sonnet 4.5',
            provider: 'cherryin',
            group: 'anthropic'
          }
        },
        stats: { inputTokens: 5, outputTokens: 8 },
        createdAt: 3000,
        updatedAt: 3000
      })
      .run()

    const migrator = new AiUsageRecordMigrator()
    expect(await migrator.prepare(ctxOf())).toMatchObject({ success: true, itemCount: 1 })
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 1 })

    const row = dbh.db
      .select()
      .from(aiUsageRecordTable)
      .where(eq(aiUsageRecordTable.requestId, 'agent-message-snapshot-usage'))
      .get()
    expect(row).toMatchObject({
      topicId: null,
      providerId: 'cherryin',
      providerName: 'cherryin',
      sourceType: 'agent',
      sourceId: 'agent-at-request-time',
      sourceName: 'Original Agent',
      sourceIcon: '🕰️',
      modelId: 'cherryin::anthropic/claude-sonnet-4.5',
      totalTokens: 13,
      createdAt: 3000,
      updatedAt: 3000
    })
  })

  it('projects usage from a real AgentsMigrator-imported message whose model cannot be resolved', async () => {
    // Chain test: runs the actual `importLegacySessionMessages` producer (not a
    // hand-inserted row) against a legacy message referencing a model with no
    // matching `user_model` row, then verifies `AiUsageRecordMigrator` — the
    // consumer under test in this file — resolves usage from the resulting
    // `modelId: null` + `messageSnapshot` row exactly as it would in production.
    dbh.db.run(sql.raw("ATTACH DATABASE ':memory:' AS agents_legacy"))
    try {
      dbh.db.run(
        sql.raw(`CREATE TABLE agents_legacy.session_messages (
          id INTEGER PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          agent_session_id TEXT,
          created_at TEXT,
          updated_at TEXT
        )`)
      )
      dbh.db.run(sql`
        INSERT INTO agents_legacy.session_messages
          (id, session_id, role, content, agent_session_id, created_at, updated_at)
        VALUES
          (
            1,
            'agent-session-usage',
            'assistant',
            ${JSON.stringify({
              message: {
                id: '1',
                role: 'assistant',
                status: 'success',
                model: { id: 'vanished-model', provider: 'vanished-provider', name: 'Vanished Model' },
                modelId: 'vanished-model',
                usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 },
                data: { parts: [{ type: 'text', text: 'legacy chain' }] }
              },
              blocks: []
            })},
            NULL,
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:01.000Z'
          )
      `)

      const schemaInfo = createEmptyAgentsSchemaInfo()
      schemaInfo.session_messages = {
        exists: true,
        columns: new Set(['id', 'session_id', 'role', 'content', 'agent_session_id', 'created_at', 'updated_at'])
      }

      const imported = await importLegacySessionMessages(dbh.db, schemaInfo)
      expect(imported).toBe(1)
    } finally {
      dbh.db.run(sql.raw('DETACH DATABASE agents_legacy'))
    }

    // Producer-side assertion: the model no longer resolves to a user_model row,
    // so modelId is null, but the author's messageSnapshot still carries it.
    const producedRow = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 'agent-session-usage'))
      .get()
    if (!producedRow) throw new Error('Expected the legacy agent-session message to be imported')
    expect(producedRow.modelId).toBeNull()
    expect(producedRow.messageSnapshot).toMatchObject({
      model: { id: 'vanished-model', provider: 'vanished-provider' }
    })

    // Consumer-side assertion: AiUsageRecordMigrator picks up the row via the
    // messageSnapshot fallback and resolves the model from it.
    const migrator = new AiUsageRecordMigrator()
    expect(await migrator.execute(ctxOf())).toMatchObject({ success: true, processedCount: 1 })

    const row = dbh.db.select().from(aiUsageRecordTable).where(eq(aiUsageRecordTable.requestId, producedRow.id)).get()
    expect(row).toMatchObject({
      sourceType: 'agent',
      sourceId: 'agent-usage',
      providerId: 'vanished-provider',
      providerName: 'vanished-provider',
      modelId: 'vanished-provider::vanished-model',
      apiKeyAttribution: 'unknown',
      apiKeyId: null,
      totalTokens: 13
    })
  })
})
