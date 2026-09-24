import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { externalKnowledgeSourceTable } from '@data/db/schemas/externalKnowledgeSource'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { externalKnowledgeConnectionService } from '@data/services/ExternalKnowledgeConnectionService'
import { ErrorCode } from '@shared/data/api/errors'

import { externalKnowledgeConnectionHandlers } from '../externalKnowledgeConnections'

const createInput = {
  appId: 'cli_example',
  appCredentialSource: 'custom-app' as const,
  credentialReference: 'cred_example',
  applicationName: 'Company Knowledge'
}

describe('externalKnowledgeConnectionHandlers', () => {
  const dbh = setupTestDatabase()

  it('returns the Connection list read model without credential payloads', async () => {
    const connection = externalKnowledgeConnectionService.create(createInput)

    const result = await externalKnowledgeConnectionHandlers['/external-knowledge-connections'].GET({})

    expect(result).toEqual([{ ...connection, sourceCount: 0 }])
    expect(result[0]).not.toHaveProperty('appSecret')
    expect(result[0]).not.toHaveProperty('accessToken')
    expect(result[0]).not.toHaveProperty('refreshToken')
  })

  it('counts only sources that depend on each Connection and keeps detail as the entity', async () => {
    const used = externalKnowledgeConnectionService.create(createInput)
    const unused = externalKnowledgeConnectionService.create({ ...createInput, credentialReference: 'cred_unused' })
    const baseId = '11111111-1111-4111-8111-111111111111'
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: baseId,
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
      .insert(externalKnowledgeSourceTable)
      .values([
        {
          baseId,
          connectionId: used.id,
          provider: 'feishu',
          tenantId: 'tenant-1',
          spaceId: 'space-1',
          scope: { kind: 'space' },
          name: 'Wiki 1',
          state: 'active',
          revision: 0
        },
        {
          baseId,
          connectionId: used.id,
          provider: 'feishu',
          tenantId: 'tenant-1',
          spaceId: 'space-2',
          scope: { kind: 'space' },
          name: 'Wiki 2',
          state: 'active',
          revision: 0
        }
      ])
      .run()

    const list = await externalKnowledgeConnectionHandlers['/external-knowledge-connections'].GET({})
    expect(list).toContainEqual({ ...used, sourceCount: 2 })
    expect(list).toContainEqual({ ...unused, sourceCount: 0 })
    await expect(
      externalKnowledgeConnectionHandlers['/external-knowledge-connections/:id'].GET({ params: { id: used.id } })
    ).resolves.toEqual(used)
  })

  it('reads one Connection by id', async () => {
    const connection = externalKnowledgeConnectionService.create(createInput)

    await expect(
      externalKnowledgeConnectionHandlers['/external-knowledge-connections/:id'].GET({
        params: { id: connection.id }
      })
    ).resolves.toEqual(connection)
  })

  it('maps a missing Connection to the DataApi not-found contract', async () => {
    await expect(
      externalKnowledgeConnectionHandlers['/external-knowledge-connections/:id'].GET({
        params: { id: '01994c00-ef10-7000-8000-000000000099' }
      })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND, status: 404 })
  })
})
