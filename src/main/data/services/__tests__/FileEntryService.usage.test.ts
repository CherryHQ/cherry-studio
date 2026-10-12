import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { fileHandlers } from '@data/api/handlers/files'
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
import { fileEntryService } from '@data/services/FileEntryService'
import type { FileEntryListResponse } from '@shared/data/api/schemas/files'
import { FileEntryIdSchema } from '@shared/data/types/file'

const ids = Array.from({ length: 5 }, (_, i) => FileEntryIdSchema.parse(`019606a0-0000-7000-8000-00000000000${i}`))

describe('file usage classification', () => {
  const dbh = setupTestDatabase()

  function seed() {
    dbh.db
      .insert(fileEntryTable)
      .values(ids.map((id, i) => ({ id, origin: 'internal', name: String(i), ext: 'txt', size: 1 })))
      .run()
    dbh.db.insert(topicTable).values({ id: 'topic', orderKey: 'a0' }).run()
    dbh.db
      .insert(messageTable)
      .values(
        withRoot(
          'topic',
          ['m1', 'm2'].map((id) => ({ id, topicId: 'topic', role: 'user', status: 'success', data: { parts: [] } }))
        )
      )
      .run()
    dbh.db
      .insert(chatMessageFileRefTable)
      .values(['m1', 'm2'].map((sourceId) => ({ sourceId, fileEntryId: ids[0], role: 'attachment' as const })))
      .run()
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
      .values({ sourceId: 'agent-message', fileEntryId: ids[1], role: 'attachment' })
      .run()
    dbh.db.insert(paintingTable).values({ id: 'painting', providerId: 'provider', prompt: '', orderKey: 'a0' }).run()
    dbh.db
      .insert(paintingFileRefTable)
      .values([ids[0], ids[2]].map((fileEntryId) => ({ sourceId: 'painting', fileEntryId, role: 'output' as const })))
      .run()
    dbh.db.update(fileEntryTable).set({ deletedAt: 123 }).where(eq(fileEntryTable.id, ids[4])).run()
  }

  it('filters before pagination, counts files once, and partitions all active files by usage', async () => {
    seed()
    const first = (await fileHandlers['/files/entries'].GET({
      query: { usage: 'conversation', sortBy: 'name', limit: 1 }
    } as never)) as FileEntryListResponse
    expect(first.total).toBe(2)
    expect(first.items.map((entry) => entry.id)).toEqual([ids[0]])
    const second = fileEntryService.listCursor({
      usage: 'conversation',
      sortBy: 'name',
      limit: 1,
      cursor: first.nextCursor
    })
    expect(second.items.map((entry) => entry.id)).toEqual([ids[1]])
    expect(second.total).toBe(2)
    expect(second.nextCursor).toBeUndefined()
    expect(fileEntryService.listCursor({ usage: 'other' }).items.map((entry) => entry.id)).toEqual([ids[2]])
    expect(fileEntryService.listCursor({ usage: 'unreferenced' }).items.map((entry) => entry.id)).toEqual([ids[3]])
    expect(fileEntryService.listCursor({ usage: 'unreferenced', fileType: 'image' }).total).toBe(0)
  })

  it('retains references from archived conversations and distinguishes conversation refs from other owners', async () => {
    seed()
    dbh.db.update(topicTable).set({ deletedAt: 123 }).run()
    dbh.db.update(agentSessionTable).set({ deletedAt: 123 }).run()
    const counts = await fileHandlers['/files/entries/ref-counts'].GET({ query: { entryIds: ids.slice(0, 4) } })
    expect(counts).toEqual([
      { entryId: ids[0], refCount: 3, conversationRefCount: 2 },
      { entryId: ids[1], refCount: 1, conversationRefCount: 1 },
      { entryId: ids[2], refCount: 1, conversationRefCount: 0 },
      { entryId: ids[3], refCount: 0, conversationRefCount: 0 }
    ])
    dbh.db.delete(topicTable).run()
    expect(fileEntryService.listCursor({ usage: 'other', sortBy: 'name' }).items.map((entry) => entry.id)).toEqual([
      ids[0],
      ids[2]
    ])
    expect(fileEntryService.listCursor({ usage: 'conversation' }).items.map((entry) => entry.id)).toEqual([ids[1]])
  })
})
