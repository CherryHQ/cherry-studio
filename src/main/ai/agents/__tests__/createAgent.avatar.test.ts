import '@data/services/AgentGlobalSkillService'
import '@data/services/AgentSessionMessageService'
import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { fileEntryTable } from '@data/db/schemas/file'
import { agentAvatarFileRefTable } from '@data/db/schemas/fileRelations'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'

const { createInternalEntry, permanentDelete, removeDirectory, waitForHeartbeat } = vi.hoisted(() => ({
  createInternalEntry: vi.fn(),
  permanentDelete: vi.fn(),
  removeDirectory: vi.fn(),
  waitForHeartbeat: vi.fn()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    FileManager: { ...defaultServiceInstances.FileManager, createInternalEntry, permanentDelete }
  })
})
vi.mock('../agentDataDirectory', () => ({
  createAgentDataDirectory: async () => undefined,
  removeAgentDataDirectory: removeDirectory
}))

const { createAgent } = await import('../createAgent')

// Catches an Agent committed before its avatar, or left behind after image/bind failure.
describe('Agent creation with a managed image', () => {
  const dbh = setupTestDatabase()
  const request = {
    type: 'claude-code' as const,
    model: 'avatar-test::model' as const,
    name: 'Image draft',
    configuration: { avatar: '🤖' }
  }
  let image: Uint8Array<ArrayBuffer>

  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    MockApplicationUtils.setService('AgentJobsService', { waitForHeartbeat })
    dbh.db.insert(userProviderTable).values({ providerId: 'avatar-test', name: 'Test provider', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'avatar-test::model',
        providerId: 'avatar-test',
        modelId: 'model',
        name: 'Test model',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
    const sharp = (await import('sharp')).default
    image = new Uint8Array(
      await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } })
        .png()
        .toBuffer()
    )
    createInternalEntry.mockImplementation(async ({ data }: { data: Uint8Array }) => {
      const id = randomUUID()
      dbh.db
        .insert(fileEntryTable)
        .values({
          id,
          name: 'image',
          ext: 'webp',
          size: data.byteLength,
          origin: 'internal',
          cleanupPolicy: 'delete_when_unreferenced',
          createdAt: Date.now()
        })
        .run()
      return { id }
    })
    permanentDelete.mockImplementation(async (id: string) => {
      dbh.db.delete(fileEntryTable).where(eq(fileEntryTable.id, id)).run()
    })
    waitForHeartbeat.mockResolvedValue(undefined)
    removeDirectory.mockResolvedValue(undefined)
  })

  it('returns and announces an Agent whose avatar is already bound', async () => {
    let announced: unknown
    let persistedAvatarAtNotification: unknown
    let notifiedInsideTransaction: boolean | undefined
    const listener = agentService.onAgentCreated(({ agent }) => {
      announced = agent
      persistedAvatarAtNotification = agentService.getAgent(agent.id)?.avatarFileId
      notifiedInsideTransaction = dbh.sqlite.inTransaction
    })
    try {
      const agent = await createAgent({ ...request, avatarImage: image })
      expect(agent.avatarFileId).toBeTruthy()
      expect(agent).toMatchObject({
        avatarSrc: application.get('FileManager').getUrl(agent.avatarFileId!),
        configuration: { avatar: '🤖' }
      })
      expect(announced).toEqual(agent)
      expect(persistedAvatarAtNotification).toBe(agent.avatarFileId)
      expect(notifiedInsideTransaction).toBe(false)
      expect(dbh.db.select().from(agentAvatarFileRefTable).all()).toMatchObject([
        { sourceId: agent.id, fileEntryId: agent.avatarFileId }
      ])
      expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    } finally {
      listener.dispose()
    }
  })

  afterEach(() => MockApplicationUtils.resetServices())

  it('rolls back a binding failure and compensates its image before a successful retry', async () => {
    const original = agentService.setAvatarSlotTx.bind(agentService)
    vi.spyOn(agentService, 'setAvatarSlotTx').mockImplementationOnce((tx, id, fileId) => {
      original(tx, id, fileId)
      throw new Error('binding failed')
    })
    await expect(createAgent({ ...request, avatarImage: image })).rejects.toThrow('binding failed')
    expect(dbh.db.select().from(agentTable).all()).toEqual([])
    expect(dbh.db.select().from(agentAvatarFileRefTable).all()).toEqual([])
    expect(dbh.db.select().from(fileEntryTable).all()).toEqual([])
    const agent = await createAgent({ ...request, avatarImage: image })
    expect(agentService.getAgent(agent.id)?.avatarFileId).toBe(agent.avatarFileId)
    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(fileEntryTable).all()).toHaveLength(1)
  })

  it('does not create an Agent on invalid image or file creation failure and permits retry', async () => {
    await expect(createAgent({ ...request, avatarImage: new Uint8Array([1, 2, 3]) })).rejects.toThrow()
    createInternalEntry.mockRejectedValueOnce(new Error('disk full'))
    await expect(createAgent({ ...request, avatarImage: image })).rejects.toThrow('disk full')
    expect(dbh.db.select().from(agentTable).all()).toEqual([])
    expect(dbh.db.select().from(fileEntryTable).all()).toEqual([])
    const agent = await createAgent({ ...request, avatarImage: image })
    expect(agentService.getAgent(agent.id)?.avatarFileId).toBeTruthy()
    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
  })

  it('retains a committed avatar when heartbeat provisioning fails', async () => {
    waitForHeartbeat.mockRejectedValueOnce(new Error('heartbeat unavailable'))
    const agent = await createAgent({ ...request, avatarImage: image })
    expect(agentService.getAgent(agent.id)?.avatarFileId).toBe(agent.avatarFileId)
    expect(dbh.db.select().from(fileEntryTable).all()).toHaveLength(1)
  })
})
