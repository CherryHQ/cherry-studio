import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { LegacyFeishuCredentialStore } from '@main/services/LegacyFeishuCredentialStore'

import { applicationInput, setupCredentialStore, tokens } from '../credential/__tests__/credentialTestSetup'
import { migrateFeishuCredentials } from '../migrateFeishuCredentials'

describe('migrateFeishuCredentials', () => {
  const fixture = setupCredentialStore()
  let legacy: LegacyFeishuCredentialStore
  const config = {
    app_id: applicationInput.payload.appId,
    app_secret: applicationInput.payload.appSecret,
    encrypt_key: applicationInput.payload.encryptKey,
    verification_token: applicationInput.payload.verificationToken,
    domain: 'feishu',
    allowed_chat_ids: ['chat-1']
  }
  beforeEach(() => {
    legacy = new LegacyFeishuCredentialStore({
      filePath: path.join(fixture.directory, 'legacy', 'credentials.json'),
      safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString()
      }
    })
  })
  function channel(overrides = {}) {
    return fixture.dbh.db
      .insert(agentChannelTable)
      .values({
        id: randomUUID(),
        name: 'Channel',
        type: 'feishu',
        workspace: { type: 'system' },
        config: { ...config, ...overrides }
      })
      .returning()
      .get()
  }
  async function connection() {
    const grantId = randomUUID()
    const row = fixture.dbh.db
      .insert(externalKnowledgeConnectionTable)
      .values({
        id: randomUUID(),
        provider: 'feishu',
        appId: config.app_id,
        appCredentialSource: 'custom-app',
        credentialReference: `feishu:${grantId}`,
        authorizationStatus: 'connected',
        accountUserId: 'user-1',
        accountOpenId: 'open-1',
        tenantKey: 'tenant-1',
        authorizedAt: 1,
        grantedScopes: tokens.grantedScopes
      })
      .returning()
      .get()
    await legacy.put(row.credentialReference, { appId: config.app_id, appSecret: config.app_secret, ...tokens })
    return { row, grantId }
  }

  it('shares compatible applications, preserves identities and tokens, and removes only committed legacy secrets', async () => {
    const oldChannel = channel()
    const { row, grantId } = await connection()
    expect(await migrateFeishuCredentials(fixture.store, legacy)).toMatchObject({
      migratedChannels: [oldChannel.id],
      migratedConnections: [row.id],
      blockedChannels: [],
      blockedConnections: []
    })
    const migrated = fixture.dbh.db.select().from(agentChannelTable).get()!
    expect(migrated.config).toEqual({ applicationCredentialId: expect.any(String), allowed_chat_ids: ['chat-1'] })
    expect(await fixture.store.read(String(migrated.config.applicationCredentialId))).toMatchObject({
      status: 'ok',
      record: { payload: applicationInput.payload }
    })
    expect(await fixture.store.read(grantId)).toMatchObject({
      status: 'ok',
      record: { payload: { applicationCredentialId: migrated.config.applicationCredentialId, tokens } }
    })
    expect(fixture.dbh.db.select().from(externalKnowledgeConnectionTable).get()).toEqual({
      ...row,
      credentialReference: grantId,
      updatedAt: expect.any(Number)
    })
    expect(await legacy.read(row.credentialReference)).toEqual({ status: 'missing' })
    await migrateFeishuCredentials(fixture.store, legacy)
    expect(await fixture.store.listSummaries()).toHaveLength(2)
  })

  it('preserves Lark registration intent and pending user authorizations without inventing tokens', async () => {
    const blank = channel({ app_id: '', app_secret: '', encrypt_key: '', verification_token: '', domain: 'lark' })
    const grantId = randomUUID()
    const pending = fixture.dbh.db
      .insert(externalKnowledgeConnectionTable)
      .values({
        provider: 'feishu',
        appId: config.app_id,
        appCredentialSource: 'custom-app',
        authorizationStatus: 'pending-authorization',
        credentialReference: `feishu:${grantId}`
      })
      .returning()
      .get()
    await legacy.put(pending.credentialReference, {
      appId: config.app_id,
      appSecret: config.app_secret,
      grantedScopes: []
    })
    await migrateFeishuCredentials(fixture.store, legacy)
    expect(
      fixture.dbh.db.select().from(agentChannelTable).where(eq(agentChannelTable.id, blank.id)).get()?.config
    ).toEqual({ applicationCredentialId: null, registrationDomain: 'lark', allowed_chat_ids: ['chat-1'] })
    expect(await fixture.store.read(grantId)).toMatchObject({ status: 'ok', record: { payload: { tokens: null } } })
    expect(fixture.dbh.db.select().from(externalKnowledgeConnectionTable).get()?.authorizationStatus).toBe(
      'pending-authorization'
    )
  })

  it('preserves a legacy grant when its target UUID already belongs to another application', async () => {
    const { row, grantId } = await connection()
    const other = await fixture.store.create({
      ...applicationInput,
      payload: { ...applicationInput.payload, appId: 'cli_other' }
    })
    await fixture.store.create(
      {
        connector: 'feishu',
        kind: 'user-authorization',
        label: 'Other',
        payload: { applicationCredentialId: other.id, tokens }
      },
      grantId
    )
    expect((await migrateFeishuCredentials(fixture.store, legacy)).blockedConnections).toEqual([row.id])
    expect(fixture.dbh.db.select().from(externalKnowledgeConnectionTable).get()?.credentialReference).toBe(
      row.credentialReference
    )
    expect(await legacy.read(row.credentialReference)).toMatchObject({ status: 'ok' })
    expect(await fixture.store.read(grantId)).toMatchObject({
      status: 'ok',
      record: { payload: { applicationCredentialId: other.id, tokens } }
    })
  })

  it('preserves all conflicting sources while migrating unrelated applications', async () => {
    const first = channel()
    const second = channel({ app_secret: 'different' })
    const independent = channel({ app_id: 'cli_other' })
    const { row } = await connection()
    const result = await migrateFeishuCredentials(fixture.store, legacy)
    expect(result.blockedChannels).toEqual([first.id, second.id])
    expect(result.blockedConnections).toEqual([row.id])
    expect(result.migratedChannels).toEqual([independent.id])
    for (const original of [first, second]) {
      expect(
        fixture.dbh.db.select().from(agentChannelTable).where(eq(agentChannelTable.id, original.id)).get()
      ).toEqual(original)
    }
    expect(await legacy.read(row.credentialReference)).toMatchObject({ status: 'ok' })
  })

  it('resumes after a failed database commit without replacing newer grant tokens', async () => {
    const { row, grantId } = await connection()
    const commit = vi.spyOn(fixture.store, 'withReferences').mockRejectedValueOnce(new Error('interrupted'))
    expect((await migrateFeishuCredentials(fixture.store, legacy)).blockedConnections).toEqual([row.id])
    commit.mockRestore()
    const grant = await fixture.store.read(grantId)
    if (grant.status !== 'ok' || grant.record.kind !== 'user-authorization') throw new Error('missing grant')
    const appId = grant.record.payload.applicationCredentialId
    const freshTokens = { ...tokens, accessToken: 'fresh-access', refreshToken: 'fresh-refresh' }
    await fixture.store.rotateTokens(
      grantId,
      {
        applicationCredentialId: appId,
        application: { domain: 'feishu', appId: config.app_id, appSecret: config.app_secret },
        refreshToken: tokens.refreshToken
      },
      freshTokens
    )
    expect((await migrateFeishuCredentials(fixture.store, legacy)).migratedConnections).toEqual([row.id])
    expect(await fixture.store.read(grantId)).toMatchObject({
      status: 'ok',
      record: { payload: { tokens: freshTokens } }
    })
  })

  it('retries post-commit cleanup on restart without blocking the migrated connection', async () => {
    const { row, grantId } = await connection()
    const remove = vi.spyOn(legacy, 'remove').mockRejectedValueOnce(new Error('disk unavailable'))
    expect(await migrateFeishuCredentials(fixture.store, legacy)).toMatchObject({
      migratedConnections: [row.id],
      blockedConnections: [],
      cleanupPending: [row.id]
    })
    expect(fixture.dbh.db.select().from(externalKnowledgeConnectionTable).get()?.credentialReference).toBe(grantId)
    remove.mockRestore()
    expect((await migrateFeishuCredentials(fixture.store, legacy)).cleanupPending).toEqual([])
    expect(await legacy.read(row.credentialReference)).toEqual({ status: 'missing' })
  })
})
