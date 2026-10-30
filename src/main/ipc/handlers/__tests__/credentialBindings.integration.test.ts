import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { externalKnowledgeConnectionService } from '@data/services/ExternalKnowledgeConnectionService'
import type { CredentialStoreService } from '@main/services/credential'
import { applicationInput, setupCredentialStore } from '@main/services/credential/__tests__/credentialTestSetup'
import { credentialRequestSchemas } from '@shared/ipc/schemas/credential'

const storeMethods = vi.hoisted(() => ({ remove: vi.fn<CredentialStoreService['remove']>() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const overrides = { ...defaultServiceInstances, CredentialStoreService: storeMethods }
  return mockApplicationFactory(overrides)
})

import { IpcRouter } from '../../IpcRouter'
import { credentialHandlers } from '../credential'

describe('Credential binding admission', () => {
  const fixture = setupCredentialStore()
  const router = new IpcRouter(credentialRequestSchemas, credentialHandlers)
  const remove = (id: string) => router.dispatch('credential.remove', { id }, { senderId: 'main-window' })
  beforeEach(() => {
    storeMethods.remove.mockImplementation((...args) => fixture.store.remove(...args))
  })
  const createGrant = async () => {
    const app = await fixture.store.create(applicationInput)
    const grant = await fixture.store.create({
      connector: 'feishu',
      kind: 'user-authorization',
      label: 'Account',
      payload: { applicationCredentialId: app.id, tokens: null }
    })
    return { app, grant }
  }
  const bind = (id: string) =>
    fixture.store.withReferences([id], () =>
      externalKnowledgeConnectionService.create({
        appId: 'cli_example',
        appCredentialSource: 'custom-app',
        credentialReference: id
      })
    )

  it('serializes binding before deletion, retaining both the business row and credential', async () => {
    const { grant } = await createGrant()
    const binding = bind(grant.id)
    const deletion = remove(grant.id)
    const connection = await binding
    await expect(deletion).rejects.toMatchObject({ code: 'CREDENTIAL_IN_USE' })
    expect(fixture.dbh.db.select().from(externalKnowledgeConnectionTable).get()?.id).toBe(connection.id)
    expect(await fixture.store.read(grant.id)).toMatchObject({ status: 'ok' })
  })

  it('refuses a binding admitted after deletion without committing a dangling database reference', async () => {
    const { grant } = await createGrant()
    const deletion = remove(grant.id)
    const binding = bind(grant.id)
    expect(await deletion).toBe('removed')
    await expect(binding).rejects.toMatchObject({ code: 'missing' })
    expect(fixture.dbh.db.select().from(externalKnowledgeConnectionTable).all()).toEqual([])
  })

  it('keeps an application referenced by a grant even before a business binding exists', async () => {
    const app = await fixture.store.create(applicationInput)
    const grant = fixture.store.create({
      connector: 'feishu',
      kind: 'user-authorization',
      label: 'Pending',
      payload: { applicationCredentialId: app.id, tokens: null }
    })
    const deletion = remove(app.id)
    await grant
    await expect(deletion).rejects.toMatchObject({ code: 'CREDENTIAL_IN_USE' })
    expect(await fixture.store.read(app.id)).toMatchObject({ status: 'ok' })
  })

  it('does not delete a shared application when a Channel is removed', async () => {
    const { app, grant } = await createGrant()
    const connection = await bind(grant.id)
    const channelId = randomUUID()
    await fixture.store.withReferences([app.id], (_records, tx) => {
      tx.insert(agentChannelTable)
        .values({
          id: channelId,
          type: 'feishu',
          name: 'Shared channel',
          workspace: { type: 'system' },
          config: { applicationCredentialId: app.id },
          isActive: false
        })
        .run()
    })
    fixture.dbh.db.delete(agentChannelTable).where(eq(agentChannelTable.id, channelId)).run()
    await expect(remove(app.id)).rejects.toMatchObject({ code: 'CREDENTIAL_IN_USE' })
    expect(externalKnowledgeConnectionService.getById(connection.id)?.credentialReference).toBe(grant.id)
    expect(await fixture.store.read(app.id)).toMatchObject({ status: 'ok' })
    expect(await fixture.store.read(grant.id)).toMatchObject({ status: 'ok' })
  })

  it('checks Channel references even without Knowledge grants', async () => {
    const app = await fixture.store.create(applicationInput)
    await fixture.store.withReferences([app.id], (_records, tx) => {
      tx.insert(agentChannelTable)
        .values({
          type: 'feishu',
          name: 'Channel',
          workspace: { type: 'system' },
          config: { applicationCredentialId: app.id },
          isActive: false
        })
        .run()
    })
    await expect(remove(app.id)).rejects.toMatchObject({ code: 'CREDENTIAL_IN_USE' })
    expect(await fixture.store.read(app.id)).toMatchObject({ status: 'ok' })
  })

  it('rolls back failed binding commits and allows later removal', async () => {
    const { grant } = await createGrant()
    await expect(
      fixture.store.withReferences([grant.id], () => {
        externalKnowledgeConnectionService.create({
          appId: 'cli_example',
          appCredentialSource: 'custom-app',
          credentialReference: grant.id
        })
        throw new Error('binding failed')
      })
    ).rejects.toThrow('binding failed')
    expect(fixture.dbh.db.select().from(externalKnowledgeConnectionTable).all()).toEqual([])
    expect(await remove(grant.id)).toBe('removed')
  })

  it('refuses removal when an unreadable relationship may still reference the application', async () => {
    const app = await fixture.store.create(applicationInput)
    await writeFile(path.join(fixture.directory, `${randomUUID()}.json`), '{broken grant')
    await expect(remove(app.id)).rejects.toMatchObject({ code: 'CREDENTIAL_CORRUPT' })
    expect(await fixture.store.read(app.id)).toMatchObject({ status: 'ok' })
  })
})
