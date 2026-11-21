import '@data/services/AgentSessionMessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { fileEntryTable } from '@data/db/schemas/file'
import { agentSessionMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { t } from '@main/i18n'

const { createInternalEntry, permanentDelete, readImage, transcode } = vi.hoisted(() => ({
  createInternalEntry: vi.fn(),
  permanentDelete: vi.fn(),
  readImage: vi.fn(),
  transcode: vi.fn()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    FileManager: { ...defaultServiceInstances.FileManager, createInternalEntry, permanentDelete, read: readImage }
  })
})
vi.mock('@main/utils/image', () => ({ transcodeToEntityWebp: transcode }))

const { agentAvatarService } = await import('../AgentAvatarService')

describe('agent avatar', () => {
  const dbh = setupTestDatabase()
  const agentId = 'avatar-agent'
  const image = { kind: 'image' as const, data: new Uint8Array([1, 2, 3]) }
  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
    transcode.mockReset().mockImplementation(async (bytes: Uint8Array) => bytes)
    readImage.mockReset().mockResolvedValue({ content: image.data, mime: 'image/webp' })
    permanentDelete.mockImplementation(async (id: string) => {
      dbh.db.delete(fileEntryTable).where(eq(fileEntryTable.id, id)).run()
    })
    dbh.db
      .insert(agentTable)
      .values({
        id: agentId,
        name: 'Avatar',
        type: 'claude-code',
        instructions: '',
        orderKey: 'a0',
        configuration: { avatar: '🌟' }
      })
      .run()
    createInternalEntry.mockImplementation(async () => {
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
  })

  it('replaces the image in one slot and preserves the emoji fallback on reset', async () => {
    await agentAvatarService.apply({ agentId, avatar: image })
    const first = agentService.getAgent(agentId)!.avatarFileId!
    expect(agentService.getAgent(agentId)).toMatchObject({
      avatarFileId: first,
      avatarSrc: application.get('FileManager').getUrl(first),
      configuration: { avatar: '🌟' }
    })
    await agentAvatarService.apply({ agentId, avatar: image })
    expect(agentService.getAgent(agentId)!.avatarFileId).not.toBe(first)
    expect(
      dbh.db.all<{ count: number }>(
        "SELECT count(*) AS count FROM agent_avatar_file_ref WHERE source_id = 'avatar-agent'"
      )[0].count
    ).toBe(1)
    await agentAvatarService.apply({ agentId, avatar: { kind: 'default' } })
    expect(agentService.getAgent(agentId)).toMatchObject({ configuration: { avatar: '🌟' } })
    expect(agentService.getAgent(agentId)!.avatarFileId).toBeUndefined()
  })

  it('makes a reset visible to freshness-filtered reads', async () => {
    await agentAvatarService.apply({ agentId, avatar: image })
    const cutoff = Date.now() - 30_000
    dbh.db
      .update(agentTable)
      .set({ updatedAt: cutoff - 30_000 })
      .where(eq(agentTable.id, agentId))
      .run()
    expect(agentService.search({ q: 'Avatar', limit: 10, updatedAtFrom: cutoff })).toEqual([])
    await agentAvatarService.apply({ agentId, avatar: { kind: 'default' } })
    expect(agentService.search({ q: 'Avatar', limit: 10, updatedAtFrom: cutoff })).toContainEqual(
      expect.objectContaining({ id: agentId })
    )
  })

  it('holds the previous image for cleanup and restores it once', async () => {
    await agentAvatarService.apply({ agentId, avatar: image })
    const previousId = agentService.getAgent(agentId)!.avatarFileId!
    const signal = new AbortController().signal

    await agentAvatarService.replaceWithBackup(agentId, image.data, signal)
    expect(agentService.getAgent(agentId)?.avatarFileId).not.toBe(previousId)
    expect(fileRefService.countByEntryIds([previousId]).get(previousId)).toBe(1)
    const source = { sourceType: 'agent_avatar_backup', sourceId: agentId } as const
    const backupRef = expect.objectContaining({ ...source, fileEntryId: previousId })
    expect(fileRefService.findByEntryId(previousId)).toEqual([backupRef])
    expect(fileRefService.findBySource(source)).toEqual([backupRef])
    expect(fileEntryService.findCleanupCandidates({ graceMs: 0, limit: 10 })).toEqual([])

    await expect(agentAvatarService.restoreBackup(agentId, signal)).resolves.toBe('Avatar')
    expect(agentService.getAgent(agentId)?.avatarFileId).toBe(previousId)
    await expect(agentAvatarService.restoreBackup(agentId, signal)).rejects.toThrow(t('agent.avatar_tool.no_backup'))
  })

  it('preserves the current avatar and backup when the previous image can no longer be decoded', async () => {
    const signal = new AbortController().signal
    await agentAvatarService.apply({ agentId, avatar: image })
    const previousId = agentService.getAgent(agentId)?.avatarFileId
    await agentAvatarService.replaceWithBackup(agentId, image.data, signal)
    const currentId = agentService.getAgent(agentId)?.avatarFileId
    transcode.mockRejectedValueOnce(new Error('Invalid WebP data'))

    await expect(agentAvatarService.restoreBackup(agentId, signal)).rejects.toThrow(
      t('agent.avatar_tool.unreadable_backup')
    )
    expect(agentService.getAgent(agentId)?.avatarFileId).toBe(currentId)
    await agentAvatarService.restoreBackup(agentId, signal)
    expect(agentService.getAgent(agentId)?.avatarFileId).toBe(previousId)
  })

  it('restores the emoji fallback and lets a manual avatar edit supersede a later backup', async () => {
    const signal = new AbortController().signal
    await agentAvatarService.replaceWithBackup(agentId, image.data, signal)
    await agentAvatarService.restoreBackup(agentId, signal)
    expect(agentService.getAgent(agentId)).toMatchObject({ configuration: { avatar: '🌟' } })
    expect(agentService.getAgent(agentId)?.avatarFileId).toBeUndefined()

    await agentAvatarService.replaceWithBackup(agentId, image.data, signal)
    await agentAvatarService.apply({ agentId, avatar: { kind: 'emoji', emoji: '🐈' } })
    await expect(agentAvatarService.restoreBackup(agentId, signal)).rejects.toThrow(t('agent.avatar_tool.no_backup'))
    expect(agentService.getAgent(agentId)).toMatchObject({ configuration: { avatar: '🐈' } })
  })

  it('preserves the current and previous avatars when a replacement cannot be bound', async () => {
    const signal = new AbortController().signal
    await agentAvatarService.apply({ agentId, avatar: image })
    const previousId = agentService.getAgent(agentId)?.avatarFileId
    await agentAvatarService.replaceWithBackup(agentId, image.data, signal)
    const currentId = agentService.getAgent(agentId)?.avatarFileId

    const bindAvatar = agentService.setAvatarSlotTx.bind(agentService)
    const binding = vi.spyOn(agentService, 'setAvatarSlotTx').mockImplementationOnce((...args) => {
      bindAvatar(...args)
      throw new Error('Avatar binding failed')
    })
    await expect(agentAvatarService.replaceWithBackup(agentId, image.data, signal)).rejects.toThrow(
      'Avatar binding failed'
    )
    binding.mockRestore()
    expect(dbh.db.select({ id: fileEntryTable.id }).from(fileEntryTable).all()).toHaveLength(2)
    expect(agentService.getAgent(agentId)?.avatarFileId).toBe(currentId)
    await agentAvatarService.restoreBackup(agentId, signal)
    expect(agentService.getAgent(agentId)?.avatarFileId).toBe(previousId)
  })

  it('keeps a historical avatar reference after replacement and reset', async () => {
    await agentAvatarService.apply({ agentId, avatar: image })
    const first = agentService.getAgent(agentId)!.avatarFileId!
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'ws', name: 'ws', path: '/tmp/ws', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', agentId, workspaceId: 'ws', name: 'Session', orderKey: 'a0', lastActivityAt: 1 })
      .run()
    const message = {
      id: uuidv7(),
      role: 'assistant' as const,
      status: 'success' as const,
      data: { parts: [] },
      messageSnapshot: {
        id: agentId,
        name: 'Avatar',
        emoji: '🌟',
        avatarFileId: first,
        model: { id: 'm', name: 'M', provider: 'p' }
      }
    }
    agentSessionMessageService.saveMessage({ sessionId: 'session', message })
    await agentAvatarService.apply({ agentId, avatar: image })
    await agentAvatarService.apply({ agentId, avatar: { kind: 'default' } })
    agentSessionMessageService.saveMessage({ sessionId: 'session', message })
    expect(
      dbh.db
        .select()
        .from(agentSessionMessageFileRefTable)
        .where(eq(agentSessionMessageFileRefTable.sourceId, message.id))
        .all()
    ).toEqual([expect.objectContaining({ fileEntryId: first, role: 'author_avatar' })])
    expect(dbh.db.select().from(fileEntryTable).where(eq(fileEntryTable.id, first)).all()).toHaveLength(1)
  })
})
