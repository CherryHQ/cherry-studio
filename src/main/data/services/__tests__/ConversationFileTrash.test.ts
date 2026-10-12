import '@data/services/MessageService'
import '@data/services/AgentSessionMessageService'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { describe, expect, it } from 'vitest'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { fileEntryTable } from '@data/db/schemas/file'
import {
  agentSessionMessageFileRefTable,
  chatMessageFileRefTable,
  paintingFileRefTable
} from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { paintingTable } from '@data/db/schemas/painting'
import { topicTable } from '@data/db/schemas/topic'
import { agentSessionService } from '@data/services/AgentSessionService'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { topicService } from '@data/services/TopicService'
import { FileEntryIdSchema } from '@shared/data/types/file'

const id = FileEntryIdSchema.parse('019606a0-0000-7000-8000-000000000001')

describe('conversation attachment Recycle Bin lifecycle', () => {
  const dbh = setupTestDatabase()

  function seedFile(cleanupPolicy: 'manual' | 'delete_when_unreferenced' = 'delete_when_unreferenced') {
    dbh.db
      .insert(fileEntryTable)
      .values({ id, origin: 'internal', name: 'attachment', ext: 'txt', size: 3, cleanupPolicy, createdAt: 1 })
      .run()
  }

  function seedTopic(topicId: string) {
    const messageId = uuidv7()
    dbh.db.insert(topicTable).values({ id: topicId, orderKey: topicId }).run()
    dbh.db
      .insert(messageTable)
      .values(withRoot(topicId, [{ id: messageId, topicId, role: 'user', status: 'success', data: { parts: [] } }]))
      .run()
    dbh.db.insert(chatMessageFileRefTable).values({ fileEntryId: id, sourceId: messageId, role: 'attachment' }).run()
  }

  function seedSession() {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'workspace', path: '/workspace', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', name: 'session', workspaceId: 'workspace', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({ id: 'agent-message', sessionId: 'session', role: 'user', status: 'success', data: { parts: [] } })
      .run()
    dbh.db
      .insert(agentSessionMessageFileRefTable)
      .values({ sourceId: 'agent-message', fileEntryId: id, role: 'attachment' })
      .run()
  }

  it('archives an exclusive attachment with its topic and restores both without losing references', () => {
    seedFile()
    seedTopic('a')
    topicService.delete('a')
    expect(fileEntryService.getById(id)).toHaveProperty('deletedAt')
    expect(fileEntryService.listCursor().items).toEqual([])
    expect(fileEntryService.listCursor({ inTrash: true }).items.map((entry) => entry.id)).toEqual([id])
    expect(fileRefService.findByEntryId(id)).toHaveLength(1)
    topicService.restore('a')
    expect(fileEntryService.getById(id)).not.toHaveProperty('deletedAt')
    expect(fileRefService.findByEntryId(id)).toHaveLength(1)
  })

  it('keeps a shared attachment active until the last conversation is archived, then restores from either owner', () => {
    seedFile()
    seedTopic('a')
    seedTopic('b')
    seedSession()
    topicService.deleteByIds(['a', 'b'])
    expect(fileEntryService.getById(id)).not.toHaveProperty('deletedAt')
    agentSessionService.delete('session')
    expect(fileEntryService.getById(id)).toHaveProperty('deletedAt')
    topicService.restore('a')
    expect(fileEntryService.getById(id)).not.toHaveProperty('deletedAt')
    topicService.delete('a')
    expect(fileEntryService.getById(id)).toHaveProperty('deletedAt')
    agentSessionService.restore('session')
    expect(fileEntryService.getById(id)).not.toHaveProperty('deletedAt')
  })

  it('preserves library imports and attachments still used by other content', () => {
    seedFile('manual')
    seedTopic('a')
    topicService.delete('a')
    expect(fileEntryService.getById(id)).not.toHaveProperty('deletedAt')
    topicService.restore('a')
    dbh.db
      .update(fileEntryTable)
      .set({ cleanupPolicy: 'delete_when_unreferenced' })
      .where(eq(fileEntryTable.id, id))
      .run()
    dbh.db.insert(paintingTable).values({ id: 'painting', providerId: 'provider', prompt: '', orderKey: 'a0' }).run()
    dbh.db.insert(paintingFileRefTable).values({ sourceId: 'painting', fileEntryId: id, role: 'output' }).run()
    topicService.delete('a')
    expect(fileEntryService.getById(id)).not.toHaveProperty('deletedAt')
  })

  it('keeps attachments recoverable after permanent conversation deletion instead of reclaiming them immediately', () => {
    seedFile()
    seedTopic('a')
    topicService.deleteByIds(['a'], { permanent: true, targetState: 'active' })
    expect(fileEntryService.getById(id)).toHaveProperty('deletedAt')
    expect(fileRefService.findByEntryId(id)).toEqual([])
    expect(fileEntryService.findCleanupCandidates({ graceMs: 0, limit: 100 })).toEqual([])
  })

  it('rolls back attachment and conversation archive together when the enclosing transaction fails', () => {
    seedFile()
    seedSession()
    expect(() =>
      application.get('DbService').withWriteTx((tx) => {
        agentSessionService.trashByIdsTx(tx, ['session'])
        throw new Error('abort')
      })
    ).toThrow('abort')
    expect(fileEntryService.getById(id)).not.toHaveProperty('deletedAt')
    expect(dbh.db.select().from(agentSessionTable).all()[0].deletedAt).toBeNull()
  })
})
