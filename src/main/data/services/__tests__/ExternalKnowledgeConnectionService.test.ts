import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeConnectionService } from '@data/services/ExternalKnowledgeConnectionService'
import { ErrorCode } from '@shared/data/api/errors'

const createInput = {
  appId: 'cli_example',
  appCredentialSource: 'personal-agent' as const,
  credentialReference: 'cred_example',
  applicationName: 'Cherry Knowledge'
}

const connectedIdentity = {
  accountOpenId: 'ou_example',
  accountUnionId: 'on_example',
  tenantKey: 'tenant_example',
  displayName: 'Cherry User',
  avatarUrl: 'https://example.com/avatar.png',
  grantedScopes: ['wiki:node:read', 'wiki:node:retrieve', 'docs:document.content:read', 'offline_access']
}

describe('ExternalKnowledgeConnectionService', () => {
  const dbh = setupTestDatabase()

  it('creates pending Feishu metadata without credential payloads', () => {
    const connection = externalKnowledgeConnectionService.create(createInput)

    expect(connection).toMatchObject({
      provider: 'feishu',
      ...createInput,
      authorizationStatus: 'pending-authorization',
      accountOpenId: null,
      tenantKey: null,
      grantedScopes: [],
      authorizedAt: null,
      lastValidatedAt: null
    })
    expect(connection).not.toHaveProperty('appSecret')
    expect(connection).not.toHaveProperty('accessToken')
    expect(connection).not.toHaveProperty('refreshToken')

    expect(dbh.db.select().from(externalKnowledgeConnectionTable).get()).toMatchObject({
      appId: createInput.appId,
      credentialReference: createInput.credentialReference,
      grantedScopes: []
    })
  })

  it('stores authorized identity and actual scopes, then preserves them when reauthorization is required', () => {
    const pending = externalKnowledgeConnectionService.create(createInput)
    const connected = externalKnowledgeConnectionService.markConnected(pending.id, connectedIdentity)

    expect(connected).toMatchObject({
      ...connectedIdentity,
      authorizationStatus: 'connected'
    })
    expect(connected.authorizedAt).toEqual(expect.any(String))
    expect(connected.lastValidatedAt).toEqual(expect.any(String))

    const validated = externalKnowledgeConnectionService.markValidated(pending.id, {
      ...connectedIdentity,
      displayName: 'Updated User'
    })
    expect(validated).toMatchObject({
      id: pending.id,
      authorizationStatus: 'connected',
      displayName: 'Updated User',
      grantedScopes: connectedIdentity.grantedScopes
    })
    expect(validated.lastValidatedAt).toEqual(expect.any(String))

    const reauthorizationRequired = externalKnowledgeConnectionService.markReauthorizationRequired(pending.id)
    expect(reauthorizationRequired).toMatchObject({
      ...connectedIdentity,
      displayName: 'Updated User',
      authorizationStatus: 'reauthorization-required',
      authorizedAt: connected.authorizedAt
    })
  })

  it('lists the most recently updated connection first and reads one by id', () => {
    const older = externalKnowledgeConnectionService.create(createInput)
    const newer = externalKnowledgeConnectionService.create({
      ...createInput,
      credentialReference: 'cred_newer'
    })
    dbh.sqlite.prepare('UPDATE external_knowledge_connection SET updated_at = ? WHERE id = ?').run(1, older.id)
    dbh.sqlite.prepare('UPDATE external_knowledge_connection SET updated_at = ? WHERE id = ?').run(2, newer.id)

    expect(externalKnowledgeConnectionService.list().map((connection) => connection.id)).toEqual([newer.id, older.id])
    expect(externalKnowledgeConnectionService.getById(older.id)).toMatchObject({ id: older.id })
    expect(externalKnowledgeConnectionService.getById('01994c00-ef10-7000-8000-000000000099')).toBeNull()
  })

  it('rejects duplicate opaque credential references without replacing the existing connection', () => {
    const existing = externalKnowledgeConnectionService.create(createInput)

    expect(() =>
      externalKnowledgeConnectionService.create({
        ...createInput,
        appId: 'cli_other'
      })
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CONFLICT, status: 409 }))
    expect(externalKnowledgeConnectionService.list()).toEqual([existing])
  })

  it.each([
    {
      column: 'provider',
      value: 'lark'
    },
    {
      column: 'app_credential_source',
      value: 'bot'
    },
    {
      column: 'authorization_status',
      value: 'expired'
    },
    {
      column: 'credential_reference',
      value: '   '
    }
  ])('enforces the $column domain constraint in SQLite', ({ column, value }) => {
    const connection = externalKnowledgeConnectionService.create(createInput)

    expect(() =>
      dbh.sqlite
        .prepare(`UPDATE external_knowledge_connection SET ${column} = ? WHERE id = ?`)
        .run(value, connection.id)
    ).toThrow()
  })

  it('prevents a connected row without authorized user identity even through raw SQL', () => {
    const connection = externalKnowledgeConnectionService.create(createInput)

    expect(() =>
      dbh.sqlite
        .prepare("UPDATE external_knowledge_connection SET authorization_status = 'connected' WHERE id = ?")
        .run(connection.id)
    ).toThrow()
  })

  it('prevents authorization results from being stored while the row is pending', () => {
    const connection = externalKnowledgeConnectionService.create(createInput)

    expect(() =>
      dbh.sqlite
        .prepare(`UPDATE external_knowledge_connection SET granted_scopes = '["offline_access"]' WHERE id = ?`)
        .run(connection.id)
    ).toThrow()
  })

  it('removes an unreferenced connection', () => {
    const connection = externalKnowledgeConnectionService.create(createInput)

    expect(externalKnowledgeConnectionService.remove(connection.id)).toBe(true)
    expect(externalKnowledgeConnectionService.remove(connection.id)).toBe(false)
    expect(externalKnowledgeConnectionService.list()).toEqual([])
  })
})
