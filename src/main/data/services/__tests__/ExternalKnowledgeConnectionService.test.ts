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
  accountUserId: 'user_example',
  accountOpenId: 'ou_example',
  accountUnionId: 'on_example',
  tenantKey: 'tenant_example',
  displayName: 'Cherry User',
  avatarUrl: 'https://example.com/avatar.png',
  grantedScopes: [
    'wiki:node:read',
    'wiki:node:retrieve',
    'docs:document.content:read',
    'offline_access',
    'auth:user.id:read'
  ]
}

describe('ExternalKnowledgeConnectionService', () => {
  const dbh = setupTestDatabase()

  it('creates pending Feishu metadata without credential payloads', () => {
    const connection = externalKnowledgeConnectionService.create(createInput)

    expect(connection).toMatchObject({
      provider: 'feishu',
      ...createInput,
      authorizationStatus: 'pending-authorization',
      accountUserId: null,
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

  it('commits reauthorization with one guarded credential-reference swap', () => {
    const pending = externalKnowledgeConnectionService.create(createInput)
    const connected = externalKnowledgeConnectionService.markConnected(pending.id, connectedIdentity)
    externalKnowledgeConnectionService.markReauthorizationRequired(pending.id)

    const replaced = externalKnowledgeConnectionService.commitReauthorization(pending.id, {
      expectedCredentialReference: createInput.credentialReference,
      candidateCredentialReference: 'cred_candidate',
      appId: 'cli_replacement',
      appCredentialSource: 'personal-agent',
      applicationName: 'Cherry Studio Knowledge',
      identity: {
        ...connectedIdentity,
        accountOpenId: 'ou_replacement_app',
        displayName: 'Updated User'
      }
    })

    expect(replaced).toMatchObject({
      id: connected.id,
      credentialReference: 'cred_candidate',
      appId: 'cli_replacement',
      appCredentialSource: 'personal-agent',
      applicationName: 'Cherry Studio Knowledge',
      authorizationStatus: 'connected',
      accountUserId: connected.accountUserId,
      accountOpenId: 'ou_replacement_app',
      tenantKey: connected.tenantKey,
      grantedScopes: connectedIdentity.grantedScopes
    })
  })

  it('rejects a stale reauthorization CAS without changing the committed connection', () => {
    const pending = externalKnowledgeConnectionService.create(createInput)
    externalKnowledgeConnectionService.markConnected(pending.id, connectedIdentity)
    externalKnowledgeConnectionService.markReauthorizationRequired(pending.id)
    const committed = externalKnowledgeConnectionService.commitReauthorization(pending.id, {
      expectedCredentialReference: createInput.credentialReference,
      candidateCredentialReference: 'cred_winner',
      appId: 'cli_winner',
      appCredentialSource: 'custom-app',
      applicationName: 'Winner',
      identity: connectedIdentity
    })

    expect(() =>
      externalKnowledgeConnectionService.commitReauthorization(pending.id, {
        expectedCredentialReference: createInput.credentialReference,
        candidateCredentialReference: 'cred_loser',
        appId: 'cli_loser',
        appCredentialSource: 'custom-app',
        applicationName: 'Loser',
        identity: connectedIdentity
      })
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CONCURRENT_MODIFICATION, status: 409 }))
    expect(externalKnowledgeConnectionService.getById(pending.id)).toEqual(committed)
  })

  it('reports a missing connection separately from a stale credential reference', () => {
    const pending = externalKnowledgeConnectionService.create(createInput)
    externalKnowledgeConnectionService.markConnected(pending.id, connectedIdentity)
    externalKnowledgeConnectionService.markReauthorizationRequired(pending.id)
    const input = {
      expectedCredentialReference: 'cred_stale',
      candidateCredentialReference: 'cred_candidate',
      appId: 'cli_replacement',
      appCredentialSource: 'custom-app' as const,
      applicationName: null,
      identity: connectedIdentity
    }

    expect(() => externalKnowledgeConnectionService.commitReauthorization(pending.id, input)).toThrowError(
      expect.objectContaining({ code: ErrorCode.CONCURRENT_MODIFICATION, status: 409 })
    )
    externalKnowledgeConnectionService.remove(pending.id)
    expect(() => externalKnowledgeConnectionService.commitReauthorization(pending.id, input)).toThrowError(
      expect.objectContaining({ code: ErrorCode.NOT_FOUND, status: 404 })
    )
  })

  it('rejects using the active credential reference as its own candidate', () => {
    const pending = externalKnowledgeConnectionService.create(createInput)
    externalKnowledgeConnectionService.markConnected(pending.id, connectedIdentity)
    externalKnowledgeConnectionService.markReauthorizationRequired(pending.id)

    expect(() =>
      externalKnowledgeConnectionService.commitReauthorization(pending.id, {
        expectedCredentialReference: createInput.credentialReference,
        candidateCredentialReference: createInput.credentialReference,
        appId: 'cli_replacement',
        appCredentialSource: 'custom-app',
        applicationName: null,
        identity: connectedIdentity
      })
    ).toThrowError(expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR, status: 422 }))
    expect(externalKnowledgeConnectionService.getById(pending.id)).toMatchObject({
      credentialReference: createInput.credentialReference,
      appId: createInput.appId,
      authorizationStatus: 'reauthorization-required'
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
