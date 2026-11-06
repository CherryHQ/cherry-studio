import '@data/services/MessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { assistantDataService } from '@data/services/AssistantService'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'

const { createInternalEntry, permanentDelete, notify } = vi.hoisted(() => ({
  createInternalEntry: vi.fn(),
  permanentDelete: vi.fn(),
  notify: vi.fn()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    FileManager: { ...defaultServiceInstances.FileManager, createInternalEntry, permanentDelete }
  })
})
vi.mock('@main/utils/image', () => ({ transcodeToEntityWebp: async (bytes: Uint8Array) => bytes }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notify }))

const { assistantAvatarService } = await import('../AssistantAvatarService')

describe('AssistantAvatarService', () => {
  const dbh = setupTestDatabase()
  const image = { kind: 'image' as const, data: new Uint8Array([1, 2, 3]) }
  let assistantId: string
  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
    createInternalEntry.mockReset().mockImplementation(async () => {
      const id = uuidv7()
      dbh.db
        .insert(fileEntryTable)
        .values({
          id,
          name: 'image',
          ext: 'webp',
          size: 3,
          origin: 'internal',
          cleanupPolicy: 'delete_when_unreferenced',
          createdAt: 1
        })
        .run()
      return { id }
    })
    permanentDelete.mockReset().mockImplementation(async (id: string) => {
      dbh.db.delete(fileEntryTable).where(eq(fileEntryTable.id, id)).run()
    })
    notify.mockReset()
    assistantId = assistantDataService.create({ name: 'Avatar owner', modelId: null }).id
  })
  afterEach(() => vi.restoreAllMocks())

  async function upload() {
    await assistantAvatarService.apply({ assistantId, avatar: image })
    return assistantDataService.getById(assistantId).avatarFileId!
  }

  it('binds uploads and preserves frozen images until their final message reference disappears', async () => {
    const first = await upload()
    expect(assistantDataService.getById(assistantId)).toMatchObject({
      avatarFileId: first,
      avatarSrc: application.get('FileManager').getUrl(first)
    })
    const topic = topicService.create({ name: 'History' })
    const message = messageService.create(topic.id, {
      role: 'assistant',
      data: { parts: [] },
      messageSnapshot: {
        id: assistantId,
        name: 'Avatar owner',
        emoji: '🌟',
        avatarFileId: first,
        model: { id: 'm', name: 'M', provider: 'p' }
      }
    })
    const second = await upload()
    expect(second).not.toBe(first)
    expect(dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, first)).all()).toHaveLength(1)
    expect(fileRefService.countByEntryIds([first, second])).toEqual(
      new Map([
        [first, 1],
        [second, 1]
      ])
    )
    expect(fileEntryService.findCleanupCandidates({ graceMs: 0, limit: 100 }).map((f) => f.id)).not.toContain(first)
    messageService.delete(message.id)
    expect(fileEntryService.findCleanupCandidates({ graceMs: 0, limit: 100 }).map((f) => f.id)).toContain(first)
    expect(permanentDelete).not.toHaveBeenCalled()
  })

  it('clears the slot for emoji and default without deleting files or overwriting the fallback on reset', async () => {
    const first = await upload()
    await assistantAvatarService.apply({ assistantId, avatar: { kind: 'emoji', emoji: '🎉' } })
    expect(assistantDataService.getById(assistantId)).toMatchObject({ emoji: '🎉' })
    expect(assistantDataService.getById(assistantId).avatarFileId).toBeUndefined()
    expect(fileEntryService.findCleanupCandidates({ graceMs: 0, limit: 100 }).map((f) => f.id)).toContain(first)
    await upload()
    await assistantAvatarService.apply({ assistantId, avatar: { kind: 'default' } })
    expect(assistantDataService.getById(assistantId).emoji).toBe('🎉')
    expect(assistantDataService.getById(assistantId).avatarFileId).toBeUndefined()
  })

  it('rolls back failed binding and compensates only the newly created file', async () => {
    const first = await upload()
    const bind = assistantDataService.setAvatarSlotTx.bind(assistantDataService)
    vi.spyOn(assistantDataService, 'setAvatarSlotTx').mockImplementationOnce((tx, id, fileId) => {
      bind(tx, id, fileId)
      throw new Error('binding failed')
    })
    await expect(upload()).rejects.toThrow('binding failed')
    expect(assistantDataService.getById(assistantId).avatarFileId).toBe(first)
    expect(dbh.db.select({ id: fileEntryTable.id }).from(fileEntryTable).all()).toEqual([{ id: first }])
    expect(permanentDelete).toHaveBeenCalledTimes(1)
  })

  it('does not compensate a committed file if post-commit notification fails', async () => {
    notify.mockImplementationOnce(() => {
      throw new Error('notify failed')
    })
    await expect(upload()).rejects.toThrow('notify failed')
    const fileId = assistantDataService.getById(assistantId).avatarFileId!
    expect(fileRefService.countByEntryIds([fileId]).get(fileId)).toBe(1)
    expect(dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, fileId)).all()).toHaveLength(1)
    expect(permanentDelete).not.toHaveBeenCalled()
  })

  it('serializes concurrent commands and leaves the last requested state', async () => {
    let unblock!: () => void
    const gate = new Promise<void>((resolve) => {
      unblock = resolve
    })
    const create = createInternalEntry.getMockImplementation()!
    createInternalEntry.mockImplementationOnce(async (...args) => {
      await gate
      return create(...args)
    })
    const first = assistantAvatarService.apply({ assistantId, avatar: image })
    const second = assistantAvatarService.apply({ assistantId, avatar: { kind: 'emoji', emoji: '🔥' } })
    await Promise.resolve()
    expect(assistantDataService.getById(assistantId).emoji).toBe('🌟')
    unblock()
    await Promise.all([first, second])
    expect(assistantDataService.getById(assistantId).emoji).toBe('🔥')
    expect(assistantDataService.getById(assistantId).avatarFileId).toBeUndefined()
  })

  it('rechecks owner liveness after image creation and compensates a concurrent deletion', async () => {
    const create = createInternalEntry.getMockImplementation()!
    createInternalEntry.mockImplementationOnce(async (...args) => {
      const entry = await create(...args)
      assistantDataService.delete(assistantId)
      return entry
    })
    await expect(upload()).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(dbh.db.select().from(fileEntryTable).all()).toEqual([])
    expect(permanentDelete).toHaveBeenCalledTimes(1)
  })

  it('rejects missing and soft-deleted owners before creating a file', async () => {
    await expect(assistantAvatarService.apply({ assistantId: uuidv7(), avatar: image })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
    assistantDataService.delete(assistantId)
    await expect(upload()).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(createInternalEntry).not.toHaveBeenCalled()
    expect(dbh.db.select().from(fileEntryTable).all()).toEqual([])
  })
})
