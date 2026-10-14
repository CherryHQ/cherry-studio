import '@data/services/MessageService'
import { createHash } from 'node:crypto'

import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { count as rowCount, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { assistantTable } from '@data/db/schemas/assistant'
import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { pinTable } from '@data/db/schemas/pin'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { topicTable } from '@data/db/schemas/topic'
import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { AiStreamManager } from '@main/ai/streamManager/AiStreamManager'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { TrashService } from '@main/services/trash/TrashService'
import { ErrorCode } from '@shared/data/api/errors'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { IpcChannel } from '@shared/IpcChannel'

describe('TopicService permanent purge integration', () => {
  const dbh = setupTestDatabase()
  const broadcast = () => vi.mocked(application.get('WindowManager').broadcast)

  beforeEach(() => broadcast().mockReset())

  function variableLimit(): number {
    const options = dbh.sqlite.pragma('compile_options') as Array<{ compile_options: string }>
    const option = options.find((row) => row.compile_options.startsWith('MAX_VARIABLE_NUMBER='))
    if (!option) throw new Error('Missing native MAX_VARIABLE_NUMBER')
    return Number(option.compile_options.split('=')[1])
  }

  function digest(): string {
    const rows = ['assistant', 'topic', 'message', 'entity_tag', 'pin', 'file_entry', 'chat_message_file_ref'].map(
      (table) => dbh.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    )
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }

  function seed(count: number, activeCount = 0): string[] {
    const ids = Array.from({ length: count }, (_, i) => `t-${i}`)
    const keys = generateOrderKeySequence(count)
    dbh.db.transaction((tx) => {
      tx.insert(assistantTable)
        .values({ id: 'owner', name: 'Owner', emoji: '', settings: DEFAULT_ASSISTANT_SETTINGS, orderKey: 'a0' })
        .run()
      for (let offset = 0; offset < count; offset += 200) {
        const chunk = ids.slice(offset, offset + 200)
        tx.insert(topicTable)
          .values(
            chunk.map((id, i) => ({
              id,
              assistantId: 'owner',
              orderKey: keys[offset + i],
              deletedAt: offset + i < activeCount ? null : 123
            }))
          )
          .run()
        tx.insert(messageTable)
          .values(chunk.flatMap((id) => withRoot(id, [])))
          .run()
      }
      tx.insert(topicTable).values({ id: 'unrelated', name: 'Keep', orderKey: 'b00' }).run()
      tx.insert(messageTable).values(withRoot('unrelated', [])).run()
      tx.insert(tagTable).values({ id: 'tag', name: 'Keep definition' }).run()
      tx.insert(fileEntryTable).values({ id: 'file', origin: 'internal', name: 'Shared', ext: 'txt', size: 1 }).run()
      for (const id of [ids[0], ids[count - 1], 'unrelated']) {
        tx.insert(messageTable)
          .values([
            {
              id: `user-${id}`,
              parentId: `vroot-${id}`,
              topicId: id,
              role: 'user',
              data: { parts: [{ type: 'text', text: `sentinel ${id}` }] },
              status: 'success'
            },
            {
              id: `reply-${id}`,
              parentId: `user-${id}`,
              topicId: id,
              role: 'assistant',
              data: { parts: [{ type: 'text', text: 'reply' }] },
              status: 'success'
            }
          ])
          .run()
        tx.insert(chatMessageFileRefTable)
          .values({ fileEntryId: 'file', sourceId: `user-${id}`, role: 'attachment' })
          .run()
        tx.insert(entityTagTable).values({ entityType: 'topic', entityId: id, tagId: 'tag' }).run()
        tx.insert(pinTable).values({ entityType: 'topic', entityId: id, orderKey: 'a0' }).run()
      }
    })
    return ids
  }

  function assertPurged(ids: string[], deletedIds: string[]): void {
    expect(new Set(deletedIds)).toEqual(new Set(ids))
    expect(deletedIds).toHaveLength(ids.length)
    expect(dbh.db.select({ id: topicTable.id }).from(topicTable).all()).toEqual([{ id: 'unrelated' }])
    expect(
      dbh.db
        .select()
        .from(messageTable)
        .all()
        .every((row) => row.topicId === 'unrelated')
    ).toBe(true)
    expect(dbh.db.select().from(messageTable).all()).toHaveLength(3)
    expect(dbh.db.select({ entityId: entityTagTable.entityId }).from(entityTagTable).all()).toEqual([
      { entityId: 'unrelated' }
    ])
    expect(dbh.db.select({ entityId: pinTable.entityId }).from(pinTable).all()).toEqual([{ entityId: 'unrelated' }])
    expect(dbh.db.select({ sourceId: chatMessageFileRefTable.sourceId }).from(chatMessageFileRefTable).all()).toEqual([
      { sourceId: 'user-unrelated' }
    ])
    expect(dbh.db.select({ id: fileEntryTable.id }).from(fileEntryTable).all()).toEqual([{ id: 'file' }])
    expect(
      dbh.sqlite.prepare("SELECT count(*) AS count FROM message_fts WHERE message_fts MATCH 'sentinel'").get()
    ).toEqual({
      count: 1
    })
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  }

  it.each([0, 1])(
    'purges trashed topics at native limit + %i and preserves unrelated data',
    (delta) => {
      const ids = seed(variableLimit() + delta)
      const observedStates: Array<{ inTransaction: boolean; topicCount: number | undefined }> = []
      broadcast().mockImplementation((channel) => {
        if (channel !== IpcChannel.DataApi_DataChanged) return
        observedStates.push({
          inTransaction: dbh.sqlite.inTransaction,
          topicCount: dbh.db.select({ count: rowCount() }).from(topicTable).get()?.count
        })
      })
      const result = topicService.deleteByIds(ids, { permanent: true })
      assertPurged(ids, result.deletedIds)
      expect(result.deletedCount).toBe(ids.length)
      expect(observedStates.length).toBeGreaterThan(0)
      expect(observedStates.every((state) => !state.inTransaction && state.topicCount === 1)).toBe(true)
    },
    60000
  )

  it('deletes an active assistant and every active topic above the native limit', () => {
    const count = variableLimit() + 1
    const ids = seed(count, count)
    const result = assistantDataService.delete('owner', { permanent: true, targetState: 'active', deleteTopics: true })
    expect(result.deleted).toBe(true)
    assertPurged(ids, result.deletedTopicIds ?? [])
    expect(dbh.db.select().from(assistantTable).all()).toEqual([])
  }, 60000)

  it('purges mixed assistant topics through real TrashService and dispatch locks', async () => {
    const ids = seed(variableLimit() + 1, 1)
    BaseService.resetInstances()
    const manager = new AiStreamManager()
    const service = new TrashService()
    const container = application.getContainer()
    const get = container.get.bind(container)
    const lookup = vi
      .spyOn(container, 'get')
      .mockImplementation((name) => (name === 'AiStreamManager' ? manager : get(name)))
    try {
      const result = await service.deleteActiveAssistantPermanently('owner', true)
      assertPurged(ids, result.deletedTopicIds ?? [])
      expect(result.deleted).toBe(true)
      expect(dbh.db.select().from(assistantTable).all()).toEqual([])
    } finally {
      lookup.mockRestore()
    }
  }, 60000)

  it.each(['missing', 'wrong-state'])('validates a late %s ID before any purge writes', (invalid) => {
    const ids = seed(1001)
    const invalidId = invalid === 'missing' ? 'missing' : ids[ids.length - 1]
    if (invalid === 'missing') ids.push(invalidId)
    else dbh.db.update(topicTable).set({ deletedAt: null }).where(eq(topicTable.id, invalidId)).run()
    const before = digest()
    dbh.sqlite.exec(`CREATE TEMP TRIGGER guard_purge BEFORE DELETE ON topic
      BEGIN SELECT RAISE(ABORT, 'purge before validation'); END`)
    try {
      expect(() => topicService.deleteByIds(ids, { permanent: true })).toThrow(
        expect.objectContaining({ code: ErrorCode.NOT_FOUND, details: { resource: 'Topic', id: invalidId } })
      )
      expect(digest()).toBe(before)
      expect(broadcast().mock.calls).toHaveLength(0)
    } finally {
      dbh.sqlite.exec('DROP TRIGGER guard_purge')
    }
  })

  it.each(['topic', 'assistant'])('rolls back earlier purge batches when a later delete fails: %s', (entry) => {
    const ids = seed(1001, entry === 'assistant' ? 1001 : 0)
    const before = digest()
    let sawDeletedTopic = false
    dbh.sqlite.function('observe_purge', () => {
      sawDeletedTopic = true
      return 0
    })
    dbh.sqlite.exec(`CREATE TEMP TRIGGER observe_purge AFTER DELETE ON topic
      BEGIN SELECT observe_purge(); END;
      CREATE TEMP TRIGGER fail_purge BEFORE DELETE ON topic WHEN OLD.id = 't-999'
      BEGIN SELECT RAISE(ABORT, 'late purge failure'); END`)
    try {
      expect(() =>
        entry === 'assistant'
          ? assistantDataService.delete('owner', { permanent: true, targetState: 'active', deleteTopics: true })
          : topicService.deleteByIds(ids, { permanent: true })
      ).toThrow('late purge failure')
      expect(sawDeletedTopic).toBe(true)
      expect(dbh.sqlite.inTransaction).toBe(false)
      expect(digest()).toBe(before)
      expect(broadcast().mock.calls).toHaveLength(0)
      expect(
        dbh.sqlite.prepare("SELECT count(*) AS count FROM message_fts WHERE message_fts MATCH 'sentinel'").get()
      ).toEqual({ count: 3 })
    } finally {
      dbh.sqlite.exec('DROP TRIGGER fail_purge; DROP TRIGGER observe_purge')
    }
  })

  it('deduplicates IDs spanning batches before deleting and counting them', () => {
    const ids = seed(1001)
    const result = topicService.deleteByIds([...ids, ...ids.slice(0, 700)], { permanent: true })
    assertPurged(ids, result.deletedIds)
    expect(result.deletedCount).toBe(ids.length)
  })

  it('keeps the active-only state check across batches', () => {
    const ids = seed(1001, 1001)
    const result = topicService.deleteByIds(ids, { permanent: true, targetState: 'active' })
    assertPurged(ids, result.deletedIds)
  })
})
