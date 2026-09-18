import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { externalKnowledgeSourceService } from '@data/services/ExternalKnowledgeSourceService'

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_BASE_ID = '22222222-2222-4222-8222-222222222222'
const CONNECTION_ID = '0198f3f2-7d1a-7abc-8def-123456789ab1'
const SOURCE_ID = '0198f3f2-7d1a-7abc-8def-123456789ab2'

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
})
