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

const { createInternalEntry } = vi.hoisted(() => ({ createInternalEntry: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ FileManager: { ...defaultServiceInstances.FileManager, createInternalEntry } })
})
vi.mock('@main/utils/image', () => ({ transcodeToEntityWebp: async (bytes: Uint8Array) => bytes }))

const { agentAvatarService } = await import('../AgentAvatarService')

describe('agent avatar', () => {
  const dbh = setupTestDatabase()
  const agentId = 'avatar-agent'
  const image = { kind: 'image' as const, data: new Uint8Array([1, 2, 3]) }
  beforeEach(() => {
    MockMainDbServiceUtils.setDb(dbh.db)
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
