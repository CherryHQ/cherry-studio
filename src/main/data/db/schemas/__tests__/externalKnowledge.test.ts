import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeDocumentTable } from '@data/db/schemas/externalKnowledgeDocument'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { jobScheduleTable } from '@data/db/schemas/job'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { KnowledgeRelativePathSchema } from '@shared/data/types/knowledge'

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_BASE_ID = '22222222-2222-4222-8222-222222222222'
const CONNECTION_ID = '0198f3f2-7d1a-7abc-8def-123456789ab1'
const SOURCE_ID = '0198f3f2-7d1a-7abc-8def-123456789ab2'
const ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789ab3'
const DOCUMENT_ID = '0198f3f2-7d1a-7abc-8def-123456789ab4'
const SCHEDULE_ID = '33333333-3333-4333-8333-333333333333'

describe('External Knowledge relational schema', () => {
  const dbh = setupTestDatabase()

  const seedBase = (id = BASE_ID) =>
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id,
        name: `Base ${id}`,
        dimensions: null,
        embeddingModelId: null,
        status: 'completed',
        error: null,
        chunkSize: 1024,
        chunkOverlap: 200
      })
      .run()

  const seedConnection = () =>
    dbh.db
      .insert(externalKnowledgeConnectionTable)
      .values({
        id: CONNECTION_ID,
        provider: 'feishu',
        appId: 'cli_example',
        appCredentialSource: 'personal-agent',
        authorizationStatus: 'pending-authorization',
        credentialReference: 'cred_example'
      })
      .run()

  const seedSchedule = () =>
    dbh.db
      .insert(jobScheduleTable)
      .values({
        id: SCHEDULE_ID,
        type: 'knowledge.sync-external-source',
        trigger: { kind: 'cron', expr: '0 3 * * *', timezone: 'Asia/Shanghai' },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      .run()

  const seedSource = (overrides: Partial<typeof externalKnowledgeSourceTable.$inferInsert> = {}) =>
    dbh.db
      .insert(externalKnowledgeSourceTable)
      .values({
        id: SOURCE_ID,
        baseId: BASE_ID,
        connectionId: CONNECTION_ID,
        provider: 'feishu',
        tenantId: 'tenant-1',
        spaceId: 'space-1',
        scope: { kind: 'node', nodeId: 'node-1' },
        name: 'Engineering Wiki',
        state: 'active',
        scheduleId: null,
        revision: 0,
        ...overrides
      })
      .run()

  const seedExternalItem = () =>
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: ITEM_ID,
        baseId: BASE_ID,
        groupId: null,
        type: 'external',
        data: {
          source: 'Feishu Wiki',
          title: 'Architecture',
          relativePath: KnowledgeRelativePathSchema.parse('external/architecture.md')
        },
        status: 'completed',
        error: null
      })
      .run()

  const seedDocument = (overrides: Partial<typeof externalKnowledgeDocumentTable.$inferInsert> = {}) =>
    dbh.db
      .insert(externalKnowledgeDocumentTable)
      .values({
        id: DOCUMENT_ID,
        sourceId: SOURCE_ID,
        remoteObjectId: 'doc-1',
        canonicalNodeId: 'node-1',
        parentNodeId: null,
        relativeBreadcrumb: ['Architecture'],
        title: 'Architecture',
        originalUrl: 'https://example.feishu.cn/wiki/node-1',
        remoteRevision: '42',
        contentHash: 'sha256:abc',
        lastSeenAt: Date.now(),
        availability: 'active',
        knowledgeItemId: ITEM_ID,
        currentWarning: null,
        ...overrides
      })
      .run()

  it('enforces source identity uniqueness and state constraints while allowing the same space in another base', () => {
    seedBase()
    seedBase(OTHER_BASE_ID)
    seedConnection()
    seedSource()

    expect(() => seedSource({ id: '0198f3f2-7d1a-7abc-8def-123456789ab5' })).toThrow()
    expect(() => seedSource({ id: '0198f3f2-7d1a-7abc-8def-123456789ab6', baseId: OTHER_BASE_ID })).not.toThrow()
    expect(() =>
      dbh.sqlite.prepare("UPDATE external_knowledge_source SET state = 'manual' WHERE id = ?").run(SOURCE_ID)
    ).toThrow()
    expect(() =>
      dbh.sqlite.prepare(`UPDATE external_knowledge_source SET scope = '{"kind":"node"}' WHERE id = ?`).run(SOURCE_ID)
    ).toThrow()
  })

  it('blocks connection deletion and clears a deleted schedule reference', () => {
    seedBase()
    seedConnection()
    seedSchedule()
    seedSource({ scheduleId: SCHEDULE_ID })

    expect(() =>
      dbh.db
        .delete(externalKnowledgeConnectionTable)
        .where(eq(externalKnowledgeConnectionTable.id, CONNECTION_ID))
        .run()
    ).toThrow()

    dbh.db.delete(jobScheduleTable).where(eq(jobScheduleTable.id, SCHEDULE_ID)).run()
    expect(dbh.db.select().from(externalKnowledgeSourceTable).get()?.scheduleId).toBeNull()
  })

  it('enforces active ownership, remote identity uniqueness, and one document per item', () => {
    seedBase()
    seedConnection()
    seedSource()
    seedExternalItem()
    seedDocument()

    expect(() => seedDocument({ id: '0198f3f2-7d1a-7abc-8def-123456789ab5', remoteObjectId: 'doc-2' })).toThrow()
    expect(() =>
      seedDocument({
        id: '0198f3f2-7d1a-7abc-8def-123456789ab6',
        knowledgeItemId: null,
        availability: 'active'
      })
    ).toThrow()
    expect(() =>
      dbh.sqlite
        .prepare("UPDATE external_knowledge_document SET availability = 'unavailable' WHERE id = ?")
        .run(DOCUMENT_ID)
    ).toThrow()
  })

  it('keeps the remote ledger when an owned item is deleted directly', () => {
    seedBase()
    seedConnection()
    seedSource()
    seedExternalItem()
    seedDocument()

    expect(() => dbh.db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, ITEM_ID)).run()).toThrow()
  })

  it('cascades a base through source, document, and item while preserving the shared connection', () => {
    seedBase()
    seedConnection()
    seedSource()
    seedExternalItem()
    seedDocument()

    dbh.db.delete(knowledgeBaseTable).where(eq(knowledgeBaseTable.id, BASE_ID)).run()

    expect(dbh.db.select().from(externalKnowledgeSourceTable).all()).toEqual([])
    expect(dbh.db.select().from(externalKnowledgeDocumentTable).all()).toEqual([])
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual([])
    expect(dbh.db.select().from(externalKnowledgeConnectionTable).all()).toHaveLength(1)
  })
})
