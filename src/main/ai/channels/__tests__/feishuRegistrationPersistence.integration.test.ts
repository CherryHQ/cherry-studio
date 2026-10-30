import { randomUUID } from 'node:crypto'

import { defaultServiceInstances } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentChannelService } from '@data/services/AgentChannelService'
import { applicationInput, setupCredentialStore } from '@main/services/credential/__tests__/credentialTestSetup'
import { registrationBegin, registrationPoll } from '@main/services/feishuAppRegistration'
import { FeishuRegistrationService } from '@main/services/FeishuRegistrationService'

import { ChannelAdapter } from '../ChannelAdapter'
import { loadChannelAdapter } from '../channelAdapterLoader'
import { ChannelManager } from '../ChannelManager'

vi.mock('@main/services/feishuAppRegistration', () => ({ registrationBegin: vi.fn(), registrationPoll: vi.fn() }))

vi.mock('../channelAdapterLoader', () => ({ loadChannelAdapter: vi.fn() }))

class RegistrationAdapter extends ChannelAdapter {
  protected async performConnect(): Promise<void> {}
  protected async performDisconnect(): Promise<void> {}
  async sendMessage(): Promise<void> {}
  async sendTypingIndicator(): Promise<void> {}
}

describe('Feishu registration persistence', () => {
  const fixture = setupCredentialStore()
  let manager: ChannelManager
  let registration: FeishuRegistrationService
  let agentId: string
  let channelId: string
  let events: Array<{ status: string; config: unknown }>

  beforeEach(async () => {
    const fallback = vi.mocked(application.get).getMockImplementation()!
    vi.mocked(application.get).mockImplementation((name) => {
      if (name === 'FeishuRegistrationService') return registration
      if (name === 'CredentialStoreService') return fixture.store
      if (name === 'FeishuCredentialMigrationService') return { isChannelBlocked: () => false } as never
      return fallback(name)
    })
    registration = new FeishuRegistrationService()
    await registration._doInit()
    vi.mocked(registrationBegin).mockResolvedValue({
      deviceCode: 'code',
      verificationUri: 'https://accounts.feishu.cn/verify',
      interval: 1,
      expiresIn: 600
    })
    vi.mocked(registrationPoll).mockResolvedValue({ appId: 'cli_registered', appSecret: 'registered-secret' })
    agentId = randomUUID()
    fixture.dbh.db
      .insert(agentTable)
      .values({
        id: agentId,
        type: 'claude-code',
        name: 'Agent',
        instructions: '',
        model: null,
        orderKey: 'a0'
      })
      .run()
    const channel = agentChannelService.createChannel({
      type: 'feishu',
      name: 'Bot',
      agentId,
      workspace: { type: 'system' },
      isActive: true,
      config: { applicationCredentialId: null, allowed_chat_ids: ['chat'] }
    })
    channelId = channel.id
    vi.mocked(loadChannelAdapter).mockImplementation(
      async (row, owner) =>
        new RegistrationAdapter({
          channelId: row.id,
          channelType: 'feishu',
          agentId: owner,
          channelConfig: {
            app_id: '',
            app_secret: '',
            domain: 'feishu',
            encrypt_key: '',
            verification_token: '',
            allowed_chat_ids: ['chat']
          }
        })
    )
    events = []
    defaultServiceInstances.IpcApiService.broadcastToType.mockImplementation((_window, event, payload) => {
      if (event === 'channel.feishu.qr_login')
        events.push({
          status: payload.status,
          config: agentChannelService.getChannel(channelId)?.config
        })
    })
    manager = new ChannelManager()
    await manager.start()
    expect(manager.getAdapter(channelId)).toBeUndefined()
  })

  afterEach(async () => {
    await manager?.stop()
    await registration?._doStop()
  })

  it('confirms only after the application file and reference are saved', async () => {
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const create = fixture.store.create.bind(fixture.store)
    vi.spyOn(fixture.store, 'create').mockImplementationOnce(async (input) => {
      entered.resolve()
      await gate.promise
      return create(input)
    })
    await manager.waitForQrAndReconcile(agentId, channelId)
    await entered.promise
    expect(events).toEqual([])
    expect(agentChannelService.getChannel(channelId)?.config).toEqual({
      applicationCredentialId: null,
      allowed_chat_ids: ['chat']
    })
    gate.resolve()
    await vi.waitFor(() => expect(events).toHaveLength(1))
    const applications = await fixture.store.listSummaries()
    expect(applications).toHaveLength(1)
    expect(events).toEqual([
      { status: 'confirmed', config: { applicationCredentialId: applications[0].id, allowed_chat_ids: ['chat'] } }
    ])
    expect(await fixture.store.read(applications[0].id)).toMatchObject({
      status: 'ok',
      record: { payload: { appId: 'cli_registered', appSecret: 'registered-secret' } }
    })
  })

  it('reports persistence failure without confirming or replacing the unconfigured channel', async () => {
    vi.spyOn(fixture.store, 'create').mockRejectedValueOnce(new Error('disk unavailable'))
    await manager.waitForQrAndReconcile(agentId, channelId)
    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events).toEqual([{ status: 'error', config: { applicationCredentialId: null, allowed_chat_ids: ['chat'] } }])
    expect(await fixture.store.listSummaries()).toEqual([])
  })

  it('does not bind or confirm an old registration after the user selects another application', async () => {
    const selected = await fixture.store.create(applicationInput)
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const create = fixture.store.create.bind(fixture.store)
    vi.spyOn(fixture.store, 'create').mockImplementationOnce(async (input) => {
      entered.resolve()
      await gate.promise
      return create(input)
    })
    await manager.waitForQrAndReconcile(agentId, channelId)
    await entered.promise
    agentChannelService.updateChannel(channelId, { configPatch: { applicationCredentialId: selected.id } })
    await manager.reconcileChannel(channelId)
    gate.resolve()
    await registration._doStop()
    expect(agentChannelService.getChannel(channelId)?.config).toEqual({
      applicationCredentialId: selected.id,
      allowed_chat_ids: ['chat']
    })
    expect(events).toEqual([])
  })
})
