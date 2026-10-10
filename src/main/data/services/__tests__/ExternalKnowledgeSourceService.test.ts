import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { externalKnowledgeSourceService } from '@data/services/ExternalKnowledgeSourceService'
import { ErrorCode } from '@shared/data/api/errors'

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_BASE_ID = '22222222-2222-4222-8222-222222222222'
const CONNECTION_ID = '0198f3f2-7d1a-7abc-8def-123456789ab1'
const SOURCE_ID = '0198f3f2-7d1a-7abc-8def-123456789ab2'
const JOB_ID = '0198f3f2-7d1a-7abc-8def-123456789ab4'
const STALE_JOB_ID = '0198f3f2-7d1a-7abc-8def-123456789ab5'

describe('ExternalKnowledgeSourceService', () => {
  const dbh = setupTestDatabase()

  const seedBase = (id: string) =>
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

  const seedSource = (id: string, baseId: string, updatedAt: number) =>
    dbh.db
      .insert(externalKnowledgeSourceTable)
      .values({
        id,
        baseId,
        connectionId: CONNECTION_ID,
        provider: 'feishu',
        tenantId: 'tenant-1',
        spaceId: `space-${baseId}`,
        scope: { kind: 'node', nodeId: 'node-1' },
        name: 'Engineering Wiki',
        state: 'active',
        scheduleId: null,
        revision: 3,
        lastTrigger: 'manual',
        lastStartedAt: 100,
        lastFinishedAt: 200,
        lastOutcome: 'completed-with-warnings',
        lastScannedCount: 10,
        lastIndexedCount: 2,
        lastUnchangedCount: 7,
        lastSkippedCount: 1,
        lastWarningCount: 1,
        lastErrorSummary: 'One document stayed stale',
        lastSuccessfulSyncAt: 200,
        updatedAt
      })
      .run()

  it('lists only the target base and maps persisted timestamps', () => {
    seedBase(BASE_ID)
    seedBase(OTHER_BASE_ID)
    seedConnection()
    seedSource(SOURCE_ID, BASE_ID, 300)
    seedSource('0198f3f2-7d1a-7abc-8def-123456789ab3', OTHER_BASE_ID, 400)

    expect(externalKnowledgeSourceService.listByBaseId(BASE_ID)).toEqual([
      expect.objectContaining({
        id: SOURCE_ID,
        baseId: BASE_ID,
        provider: 'feishu',
        scope: { kind: 'node', nodeId: 'node-1' },
        lastStartedAt: new Date(100).toISOString(),
        lastFinishedAt: new Date(200).toISOString(),
        lastSuccessfulSyncAt: new Date(200).toISOString()
      })
    ])
  })

  it('reads one source and returns null for a missing id', () => {
    seedBase(BASE_ID)
    seedConnection()
    seedSource(SOURCE_ID, BASE_ID, 300)

    expect(externalKnowledgeSourceService.getById(SOURCE_ID)).toMatchObject({ id: SOURCE_ID })
    expect(externalKnowledgeSourceService.getById('0198f3f2-7d1a-7abc-8def-123456789aff')).toBeNull()
  })

  it('creates a source in the caller transaction without weakening remote identity uniqueness', () => {
    seedBase(BASE_ID)
    seedConnection()
    const input = {
      baseId: BASE_ID,
      connectionId: CONNECTION_ID,
      provider: 'feishu' as const,
      tenantId: 'tenant-1',
      spaceId: 'space-1',
      scope: { kind: 'space' as const },
      name: 'Engineering Wiki'
    }

    const created = dbh.db.transaction((tx) => externalKnowledgeSourceService.createTx(tx, input))

    expect(created).toMatchObject({ ...input, state: 'active', revision: 0, activeJobId: null })
    let conflict: unknown
    try {
      dbh.db.transaction((tx) =>
        externalKnowledgeSourceService.createTx(tx, {
          ...input,
          connectionId: CONNECTION_ID,
          name: 'Duplicate scope'
        })
      )
    } catch (error) {
      conflict = error
    }
    expect(conflict).toMatchObject({
      code: ErrorCode.CONFLICT,
      status: 409,
      message: 'An external knowledge source already exists for this provider scope'
    })
    expect(JSON.stringify(conflict)).not.toContain(`${BASE_ID}:feishu:tenant-1:space-1`)
    expect(dbh.db.select().from(externalKnowledgeSourceTable).all()).toHaveLength(1)
  })

  it('begins and settles a sync only while both the source revision and active job match', () => {
    seedBase(BASE_ID)
    seedConnection()
    seedSource(SOURCE_ID, BASE_ID, 300)

    expect(
      externalKnowledgeSourceService.beginSyncTx(dbh.db, {
        sourceId: SOURCE_ID,
        expectedRevision: 2,
        expectedActiveJobId: null,
        jobId: JOB_ID,
        trigger: 'manual',
        startedAt: 400
      })
    ).toBe(false)
    expect(
      externalKnowledgeSourceService.beginSyncTx(dbh.db, {
        sourceId: SOURCE_ID,
        expectedRevision: 3,
        expectedActiveJobId: null,
        jobId: JOB_ID,
        trigger: 'manual',
        startedAt: 400
      })
    ).toBe(true)
    expect(
      externalKnowledgeSourceService.beginSyncTx(dbh.db, {
        sourceId: SOURCE_ID,
        expectedRevision: 3,
        expectedActiveJobId: null,
        jobId: STALE_JOB_ID,
        trigger: 'manual',
        startedAt: 450
      })
    ).toBe(false)

    expect(
      externalKnowledgeSourceService.settleSyncTx(dbh.db, {
        sourceId: SOURCE_ID,
        expectedRevision: 3,
        jobId: STALE_JOB_ID,
        finishedAt: 500,
        outcome: 'failed',
        scannedCount: 1,
        indexedCount: 0,
        unchangedCount: 0,
        skippedCount: 0,
        warningCount: 1,
        errorSummary: 'Stale run'
      })
    ).toBe(false)
    expect(
      externalKnowledgeSourceService.settleSyncTx(dbh.db, {
        sourceId: SOURCE_ID,
        expectedRevision: 3,
        jobId: JOB_ID,
        finishedAt: 600,
        outcome: 'completed-with-warnings',
        scannedCount: 10,
        indexedCount: 2,
        unchangedCount: 7,
        skippedCount: 1,
        warningCount: 1,
        errorSummary: 'One document stayed stale'
      })
    ).toBe(true)

    expect(externalKnowledgeSourceService.getByIdTx(dbh.db, SOURCE_ID)).toMatchObject({
      activeJobId: null,
      lastTrigger: 'manual',
      lastStartedAt: new Date(400).toISOString(),
      lastFinishedAt: new Date(600).toISOString(),
      lastOutcome: 'completed-with-warnings',
      lastScannedCount: 10,
      lastIndexedCount: 2,
      lastUnchangedCount: 7,
      lastSkippedCount: 1,
      lastWarningCount: 1,
      lastErrorSummary: 'One document stayed stale',
      lastSuccessfulSyncAt: new Date(600).toISOString()
    })
  })

  it.each(['failed', 'cancelled'] as const)(
    'settles the current %s job without replacing the last successful sync timestamp',
    (outcome) => {
      seedBase(BASE_ID)
      seedConnection()
      seedSource(SOURCE_ID, BASE_ID, 300)

      expect(
        externalKnowledgeSourceService.beginSyncTx(dbh.db, {
          sourceId: SOURCE_ID,
          expectedRevision: 3,
          expectedActiveJobId: null,
          jobId: JOB_ID,
          trigger: 'manual',
          startedAt: 400
        })
      ).toBe(true)
      expect(
        externalKnowledgeSourceService.settleSyncTx(dbh.db, {
          sourceId: SOURCE_ID,
          expectedRevision: 3,
          jobId: JOB_ID,
          finishedAt: 500,
          outcome,
          scannedCount: 4,
          indexedCount: 1,
          unchangedCount: 2,
          skippedCount: 1,
          warningCount: 1,
          errorSummary: `${outcome} sync`
        })
      ).toBe(true)

      expect(externalKnowledgeSourceService.getByIdTx(dbh.db, SOURCE_ID)).toMatchObject({
        activeJobId: null,
        lastFinishedAt: new Date(500).toISOString(),
        lastOutcome: outcome,
        lastScannedCount: 4,
        lastIndexedCount: 1,
        lastUnchangedCount: 2,
        lastSkippedCount: 1,
        lastWarningCount: 1,
        lastErrorSummary: `${outcome} sync`,
        lastSuccessfulSyncAt: new Date(200).toISOString()
      })
    }
  )
})
