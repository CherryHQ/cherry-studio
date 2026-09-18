import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

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
  setupTestDatabase()

  it('returns the Connection list read model without credential payloads', async () => {
    const connection = externalKnowledgeConnectionService.create(createInput)

    const result = await externalKnowledgeConnectionHandlers['/external-knowledge-connections'].GET({})

    expect(result).toEqual([connection])
    expect(result[0]).not.toHaveProperty('appSecret')
    expect(result[0]).not.toHaveProperty('accessToken')
    expect(result[0]).not.toHaveProperty('refreshToken')
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
