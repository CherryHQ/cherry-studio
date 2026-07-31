import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import type { MigrationContext } from '../../core/MigrationContext'
import { AiUsageRecordMigrator } from '../AiUsageRecordMigrator'
import { getAllMigrators } from '../migratorRegistry'

const chatMessageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const agentMessageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('AiUsageRecordMigrator', () => {
  const dbh = setupTestDatabase()

  function context(): MigrationContext {
    return { db: dbh.db } as unknown as MigrationContext
  }

  beforeEach(() => {
    dbh.db
      .insert(assistantTable)
      .values({
        id: 'assistant-1',
        name: 'Current Assistant Name',
        prompt: '',
        emoji: '❌',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(topicTable)
      .values({ id: 'topic-1', assistantId: 'assistant-1', activeNodeId: null, orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent-1',
        type: 'claude_code',
        name: 'Current Agent Name',
        instructions: '',
        model: null,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({
        id: 'workspace-1',
        name: 'Workspace',
        path: '/tmp/workspace',
        type: 'user',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({
        id: 'session-1',
        agentId: 'agent-1',
        name: 'Session',
        workspaceId: 'workspace-1',
        orderKey: 'a0'
      })
      .run()
  })

  it('is registered after chat migration', () => {
    const migrators = getAllMigrators()
    const usage = migrators.find((migrator) => migrator.id === 'ai-usage-record')
    const chat = migrators.find((migrator) => migrator.id === 'chat')
    expect(usage).toBeInstanceOf(AiUsageRecordMigrator)
    expect(chat && usage && chat.order < usage.order).toBe(true)
  })

  it('creates one legacy aggregate per usage-bearing message without current-row attribution or timing projection', async () => {
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('topic-1', [
          {
            id: chatMessageId,
            topicId: 'topic-1',
            parentId: null,
            role: 'assistant',
            data: { parts: [] },
            status: 'success',
            modelId: null,
            messageSnapshot: {
              id: 'historical-assistant',
              name: 'Historical Assistant',
              emoji: '🍒',
              model: { id: 'historical-model', name: 'Historical Model', provider: 'historical-provider' }
            },
            stats: {
              inputTokens: 10,
              outputTokens: 5,
              requestCount: 2,
              estimatedRequestCount: 2,
              unpricedRequestCount: 0,
              costs: [
                {
                  currency: 'USD',
                  amount: 0,
                  providerReportedRequestCount: 2,
                  computedRequestCount: 0
                }
              ],
              timeFirstTokenMs: 100,
              timeCompletionMs: 500,
              timeThinkingMs: 80
            },
            createdAt: 1_000,
            updatedAt: 1_000
          }
        ])
      )
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: agentMessageId,
        sessionId: 'session-1',
        role: 'assistant',
        status: 'success',
        data: { parts: [] },
        stats: { totalTokens: 7, requestCount: 1, estimatedRequestCount: 1, unpricedRequestCount: 1 },
        createdAt: 2_000,
        updatedAt: 2_000
      })
      .run()

    const migrator = new AiUsageRecordMigrator()
    expect(await migrator.prepare(context())).toMatchObject({ success: true, itemCount: 2 })
    expect(await migrator.execute(context())).toMatchObject({ success: true, processedCount: 2 })

    const rows = dbh.db.select().from(aiUsageRecordTable).orderBy(aiUsageRecordTable.createdAt).all()
    expect(rows[0]).toMatchObject({
      requestId: `legacy:chat:${chatMessageId}`,
      recordKind: 'legacy-aggregate',
      requestCount: 2,
      messageKind: 'chat',
      messageId: chatMessageId,
      providerId: 'historical-provider',
      providerName: null,
      modelId: 'historical-model',
      modelName: 'Historical Model',
      sourceId: 'historical-assistant',
      sourceName: 'Historical Assistant',
      apiKeyAttribution: 'unknown',
      cost: 0,
      timeFirstTokenMs: null,
      timeCompletionMs: null,
      timeThinkingMs: null,
      createdAt: 1_000
    })
    expect(rows[1]).toMatchObject({
      requestId: `legacy:agent-session:${agentMessageId}`,
      providerId: null,
      modelId: null,
      sourceId: null
    })

    expect(dbh.db.select().from(messageTable).where(eq(messageTable.id, chatMessageId)).get()?.stats).toMatchObject({
      requestCount: 2,
      estimatedRequestCount: 2,
      timeFirstTokenMs: 100,
      timeCompletionMs: 500,
      timeThinkingMs: 80
    })
  })

  it('uses a stable request id and never updates an existing legacy row on rerun', async () => {
    dbh.db
      .insert(messageTable)
      .values(
        withRoot('topic-1', [
          {
            id: chatMessageId,
            topicId: 'topic-1',
            parentId: null,
            role: 'assistant',
            data: { parts: [] },
            status: 'success',
            stats: { totalTokens: 5, requestCount: 1, estimatedRequestCount: 1, unpricedRequestCount: 1 },
            createdAt: 1_000,
            updatedAt: 1_000
          }
        ])
      )
      .run()
    const first = new AiUsageRecordMigrator()
    await first.prepare(context())
    await first.execute(context())

    dbh.db
      .update(messageTable)
      .set({ stats: { totalTokens: 999, requestCount: 9, estimatedRequestCount: 9, unpricedRequestCount: 9 } })
      .where(eq(messageTable.id, chatMessageId))
      .run()
    const second = new AiUsageRecordMigrator()
    await second.prepare(context())
    await second.execute(context())

    expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(aiUsageRecordTable).get()).toMatchObject({ totalTokens: 5, requestCount: 1 })
  })
})
