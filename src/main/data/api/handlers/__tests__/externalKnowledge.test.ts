import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { ErrorCode } from '@shared/data/api/errors'

import { externalKnowledgeHandlers } from '../externalKnowledge'

const BASE_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '0198f3f2-7d1a-7abc-8def-123456789ab1'
const SOURCE_ID = '0198f3f2-7d1a-7abc-8def-123456789ab2'

describe('externalKnowledgeHandlers', () => {
  const dbh = setupTestDatabase()

  const seedSource = () => {
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: BASE_ID,
        name: 'Knowledge',
        dimensions: null,
        embeddingModelId: null,
        status: 'completed',
        error: null,
        chunkSize: 1024,
        chunkOverlap: 200
      })
      .run()
    dbh.db
      .insert(externalKnowledgeConnectionTable)
      .values({
        id: CONNECTION_ID,
        provider: 'feishu',
        appId: 'cli_example',
        appCredentialSource: 'personal-agent',
        authorizationStatus: 'pending-authorization',
        credentialReference: 'cred_private'
      })
      .run()
    dbh.db
      .insert(externalKnowledgeSourceTable)
      .values({
        id: SOURCE_ID,
        baseId: BASE_ID,
        connectionId: CONNECTION_ID,
        provider: 'feishu',
        tenantId: 'tenant-1',
        spaceId: 'space-1',
        scope: { kind: 'space' },
        name: 'Engineering Wiki',
        state: 'active',
        revision: 0
      })
      .run()
  }

  it('exposes source configuration without Connection credentials', async () => {
    seedSource()

    const sources = await externalKnowledgeHandlers['/knowledge-bases/:id/external-knowledge-sources'].GET({
      params: { id: BASE_ID }
    })

    expect(sources).toEqual([expect.objectContaining({ id: SOURCE_ID, scope: { kind: 'space' } })])
    expect(sources[0]).not.toHaveProperty('credentialReference')
  })

  it('maps missing source and document details to not-found', async () => {
    await expect(
      externalKnowledgeHandlers['/external-knowledge-sources/:id'].GET({ params: { id: SOURCE_ID } })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND, status: 404 })
    await expect(
      externalKnowledgeHandlers['/external-knowledge-documents/:id'].GET({ params: { id: SOURCE_ID } })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND, status: 404 })
  })

  it('rejects listing documents for a missing source', async () => {
    await expect(
      externalKnowledgeHandlers['/external-knowledge-sources/:id/documents'].GET({
        params: { id: SOURCE_ID }
      })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND, status: 404 })
  })
})
