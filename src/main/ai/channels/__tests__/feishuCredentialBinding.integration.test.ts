import { randomUUID } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { agentChannelService } from '@data/services/AgentChannelService'
import type { CredentialStoreService } from '@main/services/credential'
import { applicationInput, setupCredentialStore } from '@main/services/credential/__tests__/credentialTestSetup'

const methods = vi.hoisted(() => ({ withReferences: vi.fn<CredentialStoreService['withReferences']>() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    ...defaultServiceInstances,
    ...{
      CredentialStoreService: methods,
      ChannelManager: { requestReconcile: vi.fn() }
    }
  })
})

import { createAgentChannel, updateAgentChannel } from '../channelCommands'

describe('Feishu channel credential binding', () => {
  const fixture = setupCredentialStore()
  beforeEach(() => {
    methods.withReferences.mockImplementation((...args) => fixture.store.withReferences(...args))
  })
  const input = { type: 'feishu' as const, name: 'Bot', workspace: { type: 'system' as const }, isActive: false }

  it('stores only the application reference and rejects missing or user-grant references before committing', async () => {
    const app = await fixture.store.create(applicationInput)
    const channel = await createAgentChannel({
      ...input,
      config: { applicationCredentialId: app.id, allowed_chat_ids: ['chat'] }
    })
    expect(fixture.dbh.db.select().from(agentChannelTable).get()?.config).toEqual({
      applicationCredentialId: app.id,
      allowed_chat_ids: ['chat']
    })
    const grant = await fixture.store.create({
      connector: 'feishu',
      kind: 'user-authorization',
      label: 'Account',
      payload: { applicationCredentialId: app.id, tokens: null }
    })
    for (const id of [grant.id, randomUUID()]) {
      await expect(
        updateAgentChannel(channel.id, { configPatch: { applicationCredentialId: id } })
      ).rejects.toBeInstanceOf(Error)
      expect(agentChannelService.getChannel(channel.id)?.config).toEqual(channel.config)
    }
    expect(JSON.stringify(agentChannelService.listChannels())).not.toContain(applicationInput.payload.appSecret)
  })

  it('rejects a binding after its application was removed instead of recreating its credentials', async () => {
    const app = await fixture.store.create(applicationInput)
    await fixture.store.remove(app.id, () => false)
    await expect(
      createAgentChannel({ ...input, config: { applicationCredentialId: app.id, allowed_chat_ids: [] } })
    ).rejects.toMatchObject({ code: 'missing' })
    expect(agentChannelService.listChannels()).toEqual([])
    expect(await fixture.store.read(app.id)).toEqual({ status: 'missing' })
  })

  it('keeps blocked legacy secrets on disk while excluding them from Channel list/get responses', () => {
    const id = randomUUID()
    const config = {
      app_id: 'cli_legacy',
      app_secret: 'private-legacy-secret',
      encrypt_key: 'private-key',
      domain: 'feishu',
      allowed_chat_ids: ['chat']
    }
    fixture.dbh.db
      .insert(agentChannelTable)
      .values({ ...input, id, config })
      .run()
    expect(agentChannelService.getChannel(id)?.config).toEqual({
      applicationCredentialId: null,
      allowed_chat_ids: ['chat']
    })
    expect(JSON.stringify(agentChannelService.listChannels())).not.toContain('private-')
    expect(fixture.dbh.db.select().from(agentChannelTable).get()?.config).toEqual(config)
  })
})
