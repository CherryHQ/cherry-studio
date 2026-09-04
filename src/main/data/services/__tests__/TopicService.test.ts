// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/MessageService'

import { application } from '@application'
import { assistantTable } from '@data/db/schemas/assistant'
import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { messageTable } from '@data/db/schemas/message'
import { pinTable } from '@data/db/schemas/pin'
import { entityTagTable, tagTable } from '@data/db/schemas/tagging'
import { topicTable } from '@data/db/schemas/topic'
import { TopicService, topicService } from '@data/services/TopicService'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { describe, expect, it, type Mock, vi } from 'vitest'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

describe('TopicService', () => {
  const dbh = setupTestDatabase()

  describe('search', () => {
    it('orders matching topics and exposes timestamps by conversation activity', async () => {
      const service = new TopicService()
      await dbh.db.insert(assistantTable).values({
        id: 'asst-search',
        name: 'Needle Assistant',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      })
      await dbh.db.insert(topicTable).values([
        {
          id: 'topic-search-old',
          name: 'Needle Old Topic',
          assistantId: 'asst-search',
          orderKey: 'a0',
          lastActivityAt: 100,
          updatedAt: 300
        },
        {
          id: 'topic-search-new',
          name: 'Needle New Topic',
          assistantId: 'asst-search',
          orderKey: 'a1',
          lastActivityAt: 200,
          updatedAt: 100
        },
        {
          id: 'topic-search-miss',
          name: 'Other Topic',
          assistantId: 'asst-search',
          orderKey: 'a2',
          lastActivityAt: 300,
          updatedAt: 300
        }
      ])

      const result = service.search({ q: 'Needle', limit: 5 })

      expect(result).toEqual([
        {
          type: 'topic',
          id: 'topic-search-new',
          title: 'Needle New Topic',
          subtitle: 'Needle Assistant',
          lastActivityAt: '1970-01-01T00:00:00.200Z',
          target: { topicId: 'topic-search-new', assistantId: 'asst-search' }
        },
        {
          type: 'topic',
          id: 'topic-search-old',
          title: 'Needle Old Topic',
          subtitle: 'Needle Assistant',
          lastActivityAt: '1970-01-01T00:00:00.100Z',
          target: { topicId: 'topic-search-old', assistantId: 'asst-search' }
        }
      ])
      expect(result[0]).not.toHaveProperty('orderKey')
    })
  })

  it('keeps audit and activity timestamps unchanged for an older activity signal', async () => {
    await dbh.db.insert(topicTable).values({
      id: 'topic-stale-activity',
      name: 'Stale activity',
      orderKey: 'a0',
      lastActivityAt: 500,
      createdAt: 100,
      updatedAt: 700
    })

    dbh.db.transaction((tx) => topicService.advanceLastActivityAtTx(tx, 'topic-stale-activity', 400))

    const [row] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 'topic-stale-activity'))
    expect(row).toMatchObject({ lastActivityAt: 500, updatedAt: 700 })
  })

  it('creates and reuses a topic-level trace id', async () => {
    await dbh.db.insert(topicTable).values({ id: 'topic-trace', name: 'Trace', orderKey: 'a0' })

    const traceId = topicService.ensureTraceId('topic-trace')

    expect(traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(topicService.ensureTraceId('topic-trace')).toBe(traceId)
    expect(topicService.getById('topic-trace').traceId).toBe(traceId)
  })

  it('treats name-only updates as manual topic renames', async () => {
    await dbh.db.insert(topicTable).values({
      id: 'topic-name-only',
      name: 'Before name-only update',
      isNameManuallyEdited: false,
      orderKey: 'a0'
    })

    notifyDataApiDataChangeMock.mockClear()
    const updated = topicService.update('topic-name-only', {
      name: 'Manual topic name'
    })

    expect(updated).toMatchObject({
      id: 'topic-name-only',
      name: 'Manual topic name',
      isNameManuallyEdited: true
    })
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
      { endpoint: '/topics', kind: 'projection', entityIds: ['topic-name-only'] },
      { endpoint: '/topics', kind: 'order', dimension: 'lastActivityAt', entityIds: ['topic-name-only'] },
      { endpoint: '/topics/:id', entityIds: ['topic-name-only'] },
      { endpoint: '/topics/latest' }
    ])
  })

  it('routes topic updates through serialized write transactions', async () => {
    await dbh.db.insert(topicTable).values({
      id: 'topic-serialized-update',
      name: 'Before serialized update',
      orderKey: 'a0'
    })

    const withWriteTx = application.get('DbService').withWriteTx as Mock
    withWriteTx.mockClear()

    const updated = topicService.update('topic-serialized-update', {
      name: 'After serialized update',
      isNameManuallyEdited: false
    })

    expect(withWriteTx).toHaveBeenCalledTimes(1)
    expect(updated).toMatchObject({
      id: 'topic-serialized-update',
      name: 'After serialized update',
      isNameManuallyEdited: false
    })
  })

  it('preserves explicit automatic topic renames', async () => {
    await dbh.db.insert(topicTable).values({
      id: 'topic-auto-name',
      name: 'Before automatic update',
      isNameManuallyEdited: false,
      orderKey: 'a1'
    })

    const updated = topicService.update('topic-auto-name', {
      name: 'Automatic topic name',
      isNameManuallyEdited: false
    })

    expect(updated).toMatchObject({
      id: 'topic-auto-name',
      name: 'Automatic topic name',
      isNameManuallyEdited: false
    })
  })

  it('validates topic assistant updates against active assistants', async () => {
    await dbh.db.insert(assistantTable).values([
      {
        id: 'assistant-active',
        name: 'Active Assistant',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      },
      {
        id: 'assistant-deleted',
        name: 'Deleted Assistant',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a1',
        deletedAt: 100
      }
    ])
    await dbh.db.insert(topicTable).values({
      id: 'topic-assistant-update',
      name: 'Before assistant update',
      orderKey: 'a0'
    })

    const moved = topicService.update('topic-assistant-update', { assistantId: 'assistant-active' })

    expect(moved.assistantId).toBe('assistant-active')

    let err: unknown
    try {
      topicService.update('topic-assistant-update', { assistantId: 'assistant-deleted' })
    } catch (e) {
      err = e
    }
    expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(topicService.getById('topic-assistant-update').assistantId).toBe('assistant-active')

    const unlinked = topicService.update('topic-assistant-update', { assistantId: null })
    expect(unlinked.assistantId).toBeUndefined()
  })

  describe('listByCursor', () => {
    it('returns all non-deleted topics across assistants ordered by orderKey', async () => {
      const service = new TopicService()
      // FK: topic.assistantId → assistant.id — seed both assistants first.
      await dbh.db.insert(assistantTable).values([
        {
          id: 'asst-1',
          name: 'A',
          emoji: '🌟',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a0',
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'asst-2',
          name: 'B',
          emoji: '🌟',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a1',
          createdAt: 1,
          updatedAt: 1
        }
      ])
      await dbh.db.insert(topicTable).values({
        id: 't1',
        name: 'A',
        assistantId: 'asst-1',
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 100
      })
      // Soft-deleted row — must be excluded.
      await dbh.db.insert(topicTable).values({
        id: 't2',
        name: 'B',
        assistantId: 'asst-1',
        orderKey: 'a1',
        deletedAt: 999,
        createdAt: 2,
        updatedAt: 200
      })
      // Different assistant — must still be returned (client filters by assistantId).
      await dbh.db.insert(topicTable).values({
        id: 't3',
        name: 'Other',
        assistantId: 'asst-2',
        orderKey: 'a2',
        createdAt: 3,
        updatedAt: 300
      })

      const result = service.listByCursor()
      expect(result.items.map((t) => t.id).sort()).toEqual(['t1', 't3'])
      expect(result.nextCursor).toBeUndefined()
    })

    it('orders unpinned topics by orderKey ASC with id tiebreaker', async () => {
      // Default list order is the manual/creation `orderKey` (drag order), not
      // recency. orderKey here disagrees with updatedAt so the assertion pins the
      // key; the id tiebreak keeps rows tied on orderKey stable across revalidates.
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'first', name: 'first', orderKey: 'a0', createdAt: 1, updatedAt: 300 },
        { id: 'tied-b', name: 'tied-b', orderKey: 'a1', createdAt: 1, updatedAt: 200 },
        { id: 'tied-a', name: 'tied-a', orderKey: 'a1', createdAt: 1, updatedAt: 100 },
        { id: 'last', name: 'last', orderKey: 'a2', createdAt: 1, updatedAt: 250 }
      ])

      const result = service.listByCursor()
      expect(result.items.map((t) => t.id)).toEqual(['first', 'tied-a', 'tied-b', 'last'])
    })

    it('returns pinned topics first, ordered by pin.orderKey, then unpinned by orderKey ASC', async () => {
      // Two pinned topics + two unpinned. Pin order follows pin.orderKey
      // (user-controlled drag); unpinned section follows topic.orderKey ASC.
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 't-pinned-1', name: 'P1', orderKey: 'a3', createdAt: 1, updatedAt: 1 },
        { id: 't-pinned-2', name: 'P2', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 't-unpinned-1', name: 'U1', orderKey: 'a1', createdAt: 1, updatedAt: 1 },
        { id: 't-unpinned-2', name: 'U2', orderKey: 'a2', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db.insert(pinTable).values([
        { id: 'pin-1', entityType: 'topic', entityId: 't-pinned-1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'pin-2', entityType: 'topic', entityId: 't-pinned-2', orderKey: 'a1', createdAt: 1, updatedAt: 1 }
      ])

      const result = service.listByCursor()
      expect(result.items.map((t) => t.id)).toEqual(['t-pinned-1', 't-pinned-2', 't-unpinned-1', 't-unpinned-2'])
      expect(result.nextCursor).toBeUndefined()
    })

    it('paginates pin section then unpinned section via cursor', async () => {
      // limit=2, 3 pinned + 2 unpinned. Page 1 returns 2 pinned with a
      // pin-section cursor. Page 2 returns 1 pinned + 1 unpinned (spillover)
      // with a topic-section cursor. Page 3 returns the last unpinned.
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'p1', name: 'P1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'p2', name: 'P2', orderKey: 'a1', createdAt: 1, updatedAt: 1 },
        { id: 'p3', name: 'P3', orderKey: 'a2', createdAt: 1, updatedAt: 1 },
        { id: 'u1', name: 'U1', orderKey: 'a3', createdAt: 1, updatedAt: 1 },
        { id: 'u2', name: 'U2', orderKey: 'a4', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db.insert(pinTable).values([
        { id: 'pin-1', entityType: 'topic', entityId: 'p1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'pin-2', entityType: 'topic', entityId: 'p2', orderKey: 'a1', createdAt: 1, updatedAt: 1 },
        { id: 'pin-3', entityType: 'topic', entityId: 'p3', orderKey: 'a2', createdAt: 1, updatedAt: 1 }
      ])

      const page1 = service.listByCursor({ limit: 2 })
      expect(page1.items.map((t) => t.id)).toEqual(['p1', 'p2'])
      expect(page1.nextCursor).toBeDefined()

      const page2 = service.listByCursor({ limit: 2, cursor: page1.nextCursor })
      expect(page2.items.map((t) => t.id)).toEqual(['p3', 'u1'])
      expect(page2.nextCursor).toBeDefined()

      const page3 = service.listByCursor({ limit: 2, cursor: page2.nextCursor })
      expect(page3.items.map((t) => t.id)).toEqual(['u2'])
      expect(page3.nextCursor).toBeUndefined()
    })

    it('does not skip pinned topics with the same orderKey across pages', async () => {
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'p1', name: 'P1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'p2', name: 'P2', orderKey: 'a1', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db.insert(pinTable).values([
        { id: 'pin-1', entityType: 'topic', entityId: 'p1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'pin-2', entityType: 'topic', entityId: 'p2', orderKey: 'a0', createdAt: 1, updatedAt: 1 }
      ])

      const page1 = service.listByCursor({ limit: 1 })
      const page2 = service.listByCursor({ limit: 1, cursor: page1.nextCursor })

      expect(page1.items.map((topic) => topic.id)).toEqual(['p1'])
      expect(page2.items.map((topic) => topic.id)).toEqual(['p2'])
    })

    it('spills partially-filled pin section into unpinned in the same page', async () => {
      // Single pinned topic, limit=3 — pin section fills 1, unpinned fills
      // remaining 2 in the same response (no extra round-trip).
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'p1', name: 'P1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'u1', name: 'U1', orderKey: 'a1', createdAt: 1, updatedAt: 1 },
        { id: 'u2', name: 'U2', orderKey: 'a2', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db
        .insert(pinTable)
        .values({ id: 'pin-1', entityType: 'topic', entityId: 'p1', orderKey: 'a0', createdAt: 1, updatedAt: 1 })

      const result = service.listByCursor({ limit: 3 })
      expect(result.items.map((t) => t.id)).toEqual(['p1', 'u1', 'u2'])
      expect(result.nextCursor).toBeUndefined()
    })

    it.each([
      ['100%', ['p100', 'p100x']], // % must match literal %, not anything
      ['a_b', ['a_b']] // _ must match literal _, not any single char
    ])('escapes LIKE wildcards in search filter q=%s', async (q, expected) => {
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'p100', name: '100%', orderKey: 'a0', createdAt: 1, updatedAt: 4 },
        { id: 'p100x', name: '100% off', orderKey: 'a1', createdAt: 1, updatedAt: 3 },
        { id: 'foo', name: 'unrelated', orderKey: 'a2', createdAt: 1, updatedAt: 2 },
        { id: 'a_b', name: 'a_b', orderKey: 'a3', createdAt: 1, updatedAt: 6 },
        { id: 'a-b', name: 'a-b', orderKey: 'a4', createdAt: 1, updatedAt: 5 } // would match 'a_b' if _ were a wildcard
      ])
      const result = service.listByCursor({ q })
      expect(result.items.map((t) => t.id).sort()).toEqual([...expected].sort())
    })

    it('applies search filter q to both pin and unpinned sections', async () => {
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'p1', name: 'apple pie', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'p2', name: 'banana split', orderKey: 'a1', createdAt: 1, updatedAt: 1 },
        { id: 'u1', name: 'apple juice', orderKey: 'a2', createdAt: 1, updatedAt: 1 },
        { id: 'u2', name: 'cherry tart', orderKey: 'a3', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db.insert(pinTable).values([
        { id: 'pin-1', entityType: 'topic', entityId: 'p1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'pin-2', entityType: 'topic', entityId: 'p2', orderKey: 'a1', createdAt: 1, updatedAt: 1 }
      ])

      const result = service.listByCursor({ q: 'apple' })
      expect(result.items.map((t) => t.id)).toEqual(['p1', 'u1'])
    })

    it('ignores pin rows with entityType other than topic', async () => {
      // Polymorphic pin table — only entityType='topic' should join into the
      // topic listing. A stray pin for a different entityType must not affect
      // the result (or worse, dedupe a topic out of the unpinned section).
      const service = new TopicService()
      await dbh.db.insert(topicTable).values({ id: 't1', name: 'T1', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(pinTable).values({
        id: 'pin-other',
        entityType: 'session',
        entityId: 't1', // accidentally same id, different namespace
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })

      const result = service.listByCursor()
      expect(result.items.map((t) => t.id)).toEqual(['t1'])
    })

    it.each([
      'gibberish',
      'topic:123:legacy-id', // legacy pre-rename cursor → unknown section, safe fallback
      'pin:a0', // legacy orderKey-only pin cursor → missing stable id, safe fallback
      'entity:orphan-no-id', // malformed: entity section missing id separator
      'unknown-section:foo',
      'pin' // missing colon
    ])('falls back to first page when cursor is malformed (%s)', async (badCursor) => {
      // A renderer holding a stale cursor from a previous app version should
      // not be locked out — the warn+fallback in decodePinnedListCursor returns
      // the first page instead of throwing VALIDATION_ERROR.
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 't1', name: 'T1', orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        { id: 't2', name: 'T2', orderKey: 'a1', createdAt: 1, updatedAt: 200 }
      ])
      const result = service.listByCursor({ cursor: badCursor })
      expect(result.items.map((t) => t.id).sort()).toEqual(['t1', 't2'])
    })

    it('stale pin cursor (anchor pin row deleted) advances to unpinned section, no duplicates', async () => {
      // Renderer paged into the pin section, the anchor pin was unpinned
      // before the next page. Without the empty-result guard, the unpinned
      // section would restart from the top and the renderer would see
      // duplicates of items it already received.
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'u1', name: 'U1', orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        { id: 'u2', name: 'U2', orderKey: 'a1', createdAt: 1, updatedAt: 200 }
      ])
      // Cursor points at a pin tuple for a row that no longer exists.
      const result = service.listByCursor({ cursor: 'pin:a99:missing-topic-id' })
      expect(result.items).toHaveLength(0)
      expect(result.nextCursor).toBe('entity:')

      const next = service.listByCursor({ cursor: result.nextCursor })
      expect(next.items.map((t) => t.id)).toEqual(['u1', 'u2'])
    })
  })

  describe('delete', () => {
    it('moves the topic to the Recycle Bin (row survives with deletedAt), keeps messages, and purges entity tags', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-1', name: 'Topic', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-1', [
          {
            parentId: null,
            topicId: 'topic-1',
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )
      await dbh.db.insert(tagTable).values({ id: 'tag-1', name: 'work', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(entityTagTable).values({
        entityType: 'topic',
        entityId: 'topic-1',
        tagId: 'tag-1',
        createdAt: 1,
        updatedAt: 1
      })

      notifyDataApiDataChangeMock.mockClear()
      topicService.delete('topic-1')

      // Recycle Bin: row still present, marked deleted.
      const [topicRow] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 'topic-1'))
      expect(topicRow.deletedAt).not.toBeNull()
      expect(topicRow.deletionBatchId).toBeNull()
      // Messages untouched — hidden via the trashed container, restore stays lossless.
      const messages = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, 'topic-1'))
      expect(messages).toHaveLength(2)
      expect(messages.every((m) => m.deletedAt === null)).toBe(true)
      // Tags purged immediately (not restored on restore).
      expect(await dbh.db.select().from(entityTagTable)).toHaveLength(0)
      expect(notifyDataApiDataChangeMock).toHaveBeenNthCalledWith(1, [
        { endpoint: '/topics', kind: 'membership', entityIds: ['topic-1'] },
        { endpoint: '/topics', kind: 'order', dimension: 'lastActivityAt', entityIds: ['topic-1'] },
        { endpoint: '/topics/:id', routeParams: { id: 'topic-1' }, entityIds: ['topic-1'] },
        { endpoint: '/topics/latest' }
      ])
      expect(notifyDataApiDataChangeMock).toHaveBeenNthCalledWith(2, [{ endpoint: '/pins', kind: 'membership' }])
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledTimes(2)
    })

    it('emits one broadcast-wide by-id effect for batch deletes and a scoped one for single deletes', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'topic-1', name: 'Topic 1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'topic-2', name: 'Topic 2', orderKey: 'a1', createdAt: 1, updatedAt: 1 }
      ])

      notifyDataApiDataChangeMock.mockClear()
      topicService.deleteByIds(['topic-1', 'topic-2'])
      expect(notifyDataApiDataChangeMock).toHaveBeenNthCalledWith(1, [
        { endpoint: '/topics', kind: 'membership', entityIds: ['topic-1', 'topic-2'] },
        { endpoint: '/topics', kind: 'order', dimension: 'lastActivityAt', entityIds: ['topic-1', 'topic-2'] },
        { endpoint: '/topics/:id', entityIds: ['topic-1', 'topic-2'] },
        { endpoint: '/topics/latest' }
      ])

      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-3', name: 'Topic 3', orderKey: 'a2', createdAt: 1, updatedAt: 1 })
      notifyDataApiDataChangeMock.mockClear()
      topicService.deleteByIds(['topic-3'])
      expect(notifyDataApiDataChangeMock).toHaveBeenNthCalledWith(1, [
        { endpoint: '/topics', kind: 'membership', entityIds: ['topic-3'] },
        { endpoint: '/topics', kind: 'order', dimension: 'lastActivityAt', entityIds: ['topic-3'] },
        { endpoint: '/topics/:id', routeParams: { id: 'topic-3' }, entityIds: ['topic-3'] },
        { endpoint: '/topics/latest' }
      ])
    })

    it('permanently deletes a topic containing a multi-model sibling group without a unique-index crash', async () => {
      // Regression: purgeByTopicIdsTx is one multi-row DELETE. Under the old self-FK
      // ON DELETE SET NULL, removing u1 (parent of the a1/a2 multi-model group) nulled
      // both surviving children mid-statement → a second parentId-NULL row colliding
      // with message_topic_root_uniq. ON DELETE CASCADE removes the subtree instead.
      await dbh.db.insert(topicTable).values({ id: 'topic-mm', name: 'MM', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-mm', [
          {
            id: 'u1',
            parentId: null,
            topicId: 'topic-mm',
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 10,
            updatedAt: 10
          },
          {
            id: 'a1',
            parentId: 'u1',
            topicId: 'topic-mm',
            role: 'assistant',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 1,
            createdAt: 20,
            updatedAt: 20
          },
          {
            id: 'a2',
            parentId: 'u1',
            topicId: 'topic-mm',
            role: 'assistant',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 1,
            createdAt: 21,
            updatedAt: 21
          }
        ])
      )

      topicService.delete('topic-mm')
      topicService.delete('topic-mm', { permanent: true })

      expect(await dbh.db.select().from(topicTable)).toHaveLength(0)
      expect(await dbh.db.select().from(messageTable)).toHaveLength(0)
    })

    it('purges the pin row when an underlying topic moves to the Recycle Bin', async () => {
      // Without purgeForEntitiesTx in the Delete transaction, the pin row would survive
      // and listByCursor's JOIN would silently hide the topic from both sections.
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-1', name: 'Topic', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db
        .insert(pinTable)
        .values({ id: 'pin-1', entityType: 'topic', entityId: 'topic-1', orderKey: 'a0', createdAt: 1, updatedAt: 1 })

      topicService.delete('topic-1')

      expect(await dbh.db.select().from(pinTable)).toHaveLength(0)
    })

    it('keeps all selected topics when any selected id is missing', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'topic-1', name: 'Topic 1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'topic-2', name: 'Topic 2', orderKey: 'a1', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db.insert(messageTable).values(
        withRoot('topic-1', [
          {
            id: 'message-1',
            parentId: null,
            topicId: 'topic-1',
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )

      let err: unknown
      try {
        topicService.deleteByIds(['topic-1', 'missing-topic'])
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })

      const topics = await dbh.db
        .select({ id: topicTable.id, deletedAt: topicTable.deletedAt })
        .from(topicTable)
        .orderBy(asc(topicTable.id))
      expect(topics.map((topic) => topic.id)).toEqual(['topic-1', 'topic-2'])
      // Rolled back: neither topic was moved to the Recycle Bin.
      expect(topics.every((topic) => topic.deletedAt === null)).toBe(true)
      // virtual root + message-1 both survive the rejected delete
      expect(await dbh.db.select().from(messageTable)).toHaveLength(2)
    })

    it('permanent=true removes the topic row, its messages, and chat message file refs', async () => {
      const fileEntryId = '019606a0-0000-7000-8000-00000000fb02' as FileEntryId
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-purge', name: 'Purge', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(fileEntryTable).values({
        id: fileEntryId,
        origin: 'internal',
        name: 'purge-attachment',
        ext: 'txt',
        size: 1,
        createdAt: 1,
        updatedAt: 1
      })
      await dbh.db.insert(messageTable).values(
        withRoot('topic-purge', [
          {
            id: 'purge-m1',
            parentId: null,
            topicId: 'topic-purge',
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )
      await dbh.db.insert(chatMessageFileRefTable).values({
        id: '22222222-2222-4222-8222-123456789abc',
        fileEntryId,
        sourceId: 'purge-m1',
        role: 'attachment',
        createdAt: 1,
        updatedAt: 1
      })

      topicService.delete('topic-purge')
      topicService.delete('topic-purge', { permanent: true })

      expect(await dbh.db.select().from(topicTable)).toHaveLength(0)
      expect(await dbh.db.select().from(messageTable)).toHaveLength(0)
      expect(await dbh.db.select().from(chatMessageFileRefTable)).toHaveLength(0)
    })

    it('permanent=true purges an already-trashed topic from the Recycle Bin', async () => {
      await dbh.db.insert(topicTable).values({
        id: 'topic-trashed',
        name: 'Trashed',
        orderKey: 'a0',
        deletedAt: 999,
        createdAt: 1,
        updatedAt: 1
      })

      topicService.delete('topic-trashed', { permanent: true })

      expect(await dbh.db.select().from(topicTable)).toHaveLength(0)
    })

    it('rejects permanent deletion of an active topic and keeps it active', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-active', name: 'Active', orderKey: 'a0', createdAt: 1, updatedAt: 1 })

      let err: unknown
      try {
        topicService.delete('topic-active', { permanent: true })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })

      const [row] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 'topic-active'))
      expect(row).toMatchObject({ id: 'topic-active', deletedAt: null })
    })

    it('rejects a stale permanent delete after the topic has been restored', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'topic-restored', name: 'Restored', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      topicService.delete('topic-restored')
      topicService.restore('topic-restored')

      let err: unknown
      try {
        topicService.delete('topic-restored', { permanent: true })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })

      const [row] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 'topic-restored'))
      expect(row).toMatchObject({ id: 'topic-restored', deletedAt: null })
    })

    it('moving an already-trashed topic to the Recycle Bin throws NOT_FOUND', async () => {
      await dbh.db.insert(topicTable).values({
        id: 'topic-gone',
        name: 'Gone',
        orderKey: 'a0',
        deletedAt: 999,
        createdAt: 1,
        updatedAt: 1
      })

      let err: unknown
      try {
        topicService.delete('topic-gone')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('trash listing (inTrash)', () => {
    it('hides trashed topics from the default list and shows them with inTrash', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 't-live', name: 'Live', orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        { id: 't-trash', name: 'Trash', orderKey: 'a1', createdAt: 1, updatedAt: 200 }
      ])

      topicService.delete('t-trash')

      const active = topicService.listByCursor()
      expect(active.items.map((t) => t.id)).toEqual(['t-live'])
      expect(active.items[0].deletedAt).toBeUndefined()

      const trash = topicService.listByCursor({ inTrash: true })
      expect(trash.items.map((t) => t.id)).toEqual(['t-trash'])
      expect(trash.items[0].deletedAt).toEqual(expect.any(String))
    })

    it('moving a pinned topic to the Recycle Bin keeps it out of the default list and visible in trash mode', async () => {
      // A surviving pin row would make listByCursor's JOIN hide the topic from
      // both sections — Delete must purge the pin so trash mode can list it.
      await dbh.db.insert(topicTable).values([
        { id: 't-pinned', name: 'Pinned', orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        { id: 't-other', name: 'Other', orderKey: 'a1', createdAt: 1, updatedAt: 200 }
      ])
      await dbh.db
        .insert(pinTable)
        .values({ id: 'pin-1', entityType: 'topic', entityId: 't-pinned', orderKey: 'a0', createdAt: 1, updatedAt: 1 })

      topicService.delete('t-pinned')

      const active = topicService.listByCursor()
      expect(active.items.map((t) => t.id)).toEqual(['t-other'])

      const trash = topicService.listByCursor({ inTrash: true })
      expect(trash.items.map((t) => t.id)).toEqual(['t-pinned'])
    })

    it('paginates the trash with the (updatedAt DESC, id ASC) tuple cursor', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'tr-1', name: 'T1', orderKey: 'a0', deletedAt: 10, createdAt: 1, updatedAt: 100 },
        { id: 'tr-2', name: 'T2', orderKey: 'a1', deletedAt: 10, createdAt: 1, updatedAt: 200 },
        { id: 'tr-3', name: 'T3', orderKey: 'a2', deletedAt: 10, createdAt: 1, updatedAt: 300 }
      ])

      const page1 = topicService.listByCursor({ inTrash: true, limit: 2 })
      expect(page1.items.map((t) => t.id)).toEqual(['tr-3', 'tr-2'])
      expect(page1.nextCursor).toBeDefined()

      const page2 = topicService.listByCursor({ inTrash: true, limit: 2, cursor: page1.nextCursor })
      expect(page2.items.map((t) => t.id)).toEqual(['tr-1'])
      expect(page2.nextCursor).toBeUndefined()
    })
  })

  describe('restore', () => {
    it('makes a trashed topic visible again with messages intact', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 't-restore', name: 'Restore me', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values(
        withRoot('t-restore', [
          {
            id: 'rm-1',
            parentId: null,
            topicId: 't-restore',
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )

      topicService.delete('t-restore')
      const restored = topicService.restore('t-restore')

      expect(restored.id).toBe('t-restore')
      expect(restored.deletedAt).toBeUndefined()
      expect(topicService.listByCursor().items.map((t) => t.id)).toEqual(['t-restore'])
      // Messages were never touched by Delete/Restore.
      const messages = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, 't-restore'))
      expect(messages).toHaveLength(2)
      expect(messages.every((m) => m.deletedAt === null)).toBe(true)
    })

    it('does not resurrect pins purged at Delete time', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 't-pin-restore', name: 'P', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(pinTable).values({
        id: 'pin-1',
        entityType: 'topic',
        entityId: 't-pin-restore',
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })

      topicService.delete('t-pin-restore')
      topicService.restore('t-pin-restore')

      expect(await dbh.db.select().from(pinTable)).toHaveLength(0)
    })

    it('restores a topic independently while its assistant remains trashed', async () => {
      await dbh.db.insert(assistantTable).values({
        id: 'asst-trashed',
        name: 'Trashed assistant',
        emoji: '✨',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0',
        deletedAt: 500,
        deletionBatchId: 'assistant-batch'
      })
      await dbh.db.insert(topicTable).values({
        id: 'topic-independent-restore',
        name: 'Restore independently',
        assistantId: 'asst-trashed',
        orderKey: 'a0',
        deletedAt: 500,
        deletionBatchId: 'assistant-batch'
      })

      const restored = topicService.restore('topic-independent-restore')

      expect(restored).toMatchObject({ id: 'topic-independent-restore', assistantId: 'asst-trashed' })
      expect(restored.deletedAt).toBeUndefined()
      expect(restored).not.toHaveProperty('deletionBatchId')
      const [assistant] = await dbh.db.select().from(assistantTable).where(eq(assistantTable.id, 'asst-trashed'))
      expect(assistant).toMatchObject({ deletedAt: 500, deletionBatchId: 'assistant-batch' })
      const [topic] = await dbh.db
        .select({ deletionBatchId: topicTable.deletionBatchId })
        .from(topicTable)
        .where(eq(topicTable.id, 'topic-independent-restore'))
      expect(topic.deletionBatchId).toBeNull()
    })

    it('restores only topics from the matching assistant trash batch', async () => {
      await dbh.db.insert(assistantTable).values([
        {
          id: 'asst-restore-owner',
          name: 'Restore owner',
          emoji: '✨',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a0'
        },
        {
          id: 'asst-other-owner',
          name: 'Other owner',
          emoji: '🌟',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a1'
        }
      ])
      await dbh.db.insert(topicTable).values([
        {
          id: 'topic-matching-batch',
          name: 'Matching batch',
          assistantId: 'asst-restore-owner',
          orderKey: 'a0',
          deletedAt: 500,
          deletionBatchId: 'matching-batch'
        },
        {
          id: 'topic-older-trash',
          name: 'Older trash',
          assistantId: 'asst-restore-owner',
          orderKey: 'a1',
          deletedAt: 400,
          deletionBatchId: 'older-batch'
        },
        {
          id: 'topic-other-owner',
          name: 'Other owner',
          assistantId: 'asst-other-owner',
          orderKey: 'a2',
          deletedAt: 500,
          deletionBatchId: 'matching-batch'
        },
        {
          id: 'topic-already-active',
          name: 'Already active',
          assistantId: 'asst-restore-owner',
          orderKey: 'a3'
        }
      ])

      const restoredIds = dbh.db.transaction((tx) =>
        topicService.restoreTrashedWithAssistantTx(tx, 'asst-restore-owner', 'matching-batch')
      )

      expect(restoredIds).toEqual(['topic-matching-batch'])
      const rows = await dbh.db
        .select({ id: topicTable.id, deletedAt: topicTable.deletedAt, deletionBatchId: topicTable.deletionBatchId })
        .from(topicTable)
        .orderBy(asc(topicTable.id))
      expect(rows).toEqual([
        { id: 'topic-already-active', deletedAt: null, deletionBatchId: null },
        { id: 'topic-matching-batch', deletedAt: null, deletionBatchId: null },
        { id: 'topic-older-trash', deletedAt: 400, deletionBatchId: 'older-batch' },
        { id: 'topic-other-owner', deletedAt: 500, deletionBatchId: 'matching-batch' }
      ])
    })

    it('throws NOT_FOUND when restoring a missing or active topic', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 't-active', name: 'Active', orderKey: 'a0', createdAt: 1, updatedAt: 1 })

      for (const id of ['missing-topic', 't-active']) {
        let err: unknown
        try {
          topicService.restore(id)
        } catch (e) {
          err = e
        }
        expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
      }
    })
  })

  describe('purgeExpiredTx', () => {
    it('hard-deletes only trashed topics past the cutoff, respecting the limit', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 't-old-1', name: 'Old 1', orderKey: 'a0', deletedAt: 100, createdAt: 1, updatedAt: 1 },
        { id: 't-old-2', name: 'Old 2', orderKey: 'a1', deletedAt: 200, createdAt: 1, updatedAt: 1 },
        { id: 't-fresh', name: 'Fresh', orderKey: 'a2', deletedAt: 900, createdAt: 1, updatedAt: 1 },
        { id: 't-live', name: 'Live', orderKey: 'a3', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db.insert(messageTable).values(withRoot('t-old-1', []))

      const firstBatch = topicService.purgeExpiredTx(dbh.db, 500, 1)
      expect(firstBatch).toHaveLength(1)

      const secondBatch = topicService.purgeExpiredTx(dbh.db, 500, 10)
      expect(secondBatch).toHaveLength(1)
      expect([...firstBatch, ...secondBatch].sort()).toEqual(['t-old-1', 't-old-2'])

      // Fresh-in-trash and live rows survive; purged topic's messages are gone.
      const remaining = await dbh.db.select({ id: topicTable.id }).from(topicTable).orderBy(asc(topicTable.id))
      expect(remaining.map((r) => r.id)).toEqual(['t-fresh', 't-live'])
      expect(await dbh.db.select().from(messageTable)).toHaveLength(0)
    })

    it('returns an empty array when nothing is expired', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 't-fresh', name: 'Fresh', orderKey: 'a0', deletedAt: 900, createdAt: 1, updatedAt: 1 })

      expect(topicService.purgeExpiredTx(dbh.db, 500, 10)).toEqual([])
      expect(await dbh.db.select().from(topicTable)).toHaveLength(1)
    })
  })

  describe('deleteByAssistantId', () => {
    async function seedAssistant(id: string, orderKey: string, deletedAt: number | null = null) {
      await dbh.db.insert(assistantTable).values({
        id,
        name: id,
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey,
        deletedAt,
        createdAt: 1,
        updatedAt: 1
      })
    }

    it('moves only the assistant non-deleted topics to the Recycle Bin, keeps messages, and purges tags/pins', async () => {
      await seedAssistant('asst-1', 'a0')
      await dbh.db.insert(topicTable).values([
        { id: 'topic-1', name: 'Topic 1', assistantId: 'asst-1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'topic-2', name: 'Topic 2', assistantId: 'asst-1', orderKey: 'a1', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db.insert(messageTable).values(
        withRoot('topic-1', [
          {
            id: 'message-1',
            parentId: null,
            topicId: 'topic-1',
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )
      await dbh.db.insert(tagTable).values({ id: 'tag-1', name: 'work', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(entityTagTable).values({
        entityType: 'topic',
        entityId: 'topic-1',
        tagId: 'tag-1',
        createdAt: 1,
        updatedAt: 1
      })
      await dbh.db
        .insert(pinTable)
        .values({ id: 'pin-1', entityType: 'topic', entityId: 'topic-2', orderKey: 'a0', createdAt: 1, updatedAt: 1 })

      const result = topicService.deleteByAssistantId('asst-1')

      expect(result.deletedIds.sort()).toEqual(['topic-1', 'topic-2'])
      expect(result.deletedCount).toBe(2)
      // Trashed, not purged: rows survive with deletedAt set.
      const topics = await dbh.db.select().from(topicTable).orderBy(asc(topicTable.id))
      expect(topics.map((topic) => topic.id)).toEqual(['topic-1', 'topic-2'])
      expect(topics.every((topic) => topic.deletedAt !== null)).toBe(true)
      expect(topics.every((topic) => topic.deletionBatchId === null)).toBe(true)
      // Messages stay in place; tags/pins are purged immediately.
      expect(await dbh.db.select().from(messageTable)).toHaveLength(2)
      expect(await dbh.db.select().from(entityTagTable)).toHaveLength(0)
      expect(await dbh.db.select().from(pinTable)).toHaveLength(0)
    })

    it('only trashes topics scoped to the target assistant', async () => {
      await seedAssistant('asst-1', 'a0')
      await seedAssistant('asst-2', 'a1')
      await dbh.db.insert(topicTable).values([
        { id: 'topic-1', name: 'Topic 1', assistantId: 'asst-1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'topic-2', name: 'Topic 2', assistantId: 'asst-2', orderKey: 'a1', createdAt: 1, updatedAt: 1 }
      ])

      const result = topicService.deleteByAssistantId('asst-1')

      expect(result).toEqual({ deletedIds: ['topic-1'], deletedCount: 1 })
      const remaining = await dbh.db
        .select({ id: topicTable.id })
        .from(topicTable)
        .where(isNull(topicTable.deletedAt))
        .orderBy(asc(topicTable.id))
      expect(remaining.map((topic) => topic.id)).toEqual(['topic-2'])
    })

    it('excludes soft-deleted topics from the count', async () => {
      await seedAssistant('asst-1', 'a0')
      await dbh.db.insert(topicTable).values([
        { id: 'topic-live', name: 'Live', assistantId: 'asst-1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        {
          id: 'topic-gone',
          name: 'Gone',
          assistantId: 'asst-1',
          orderKey: 'a1',
          deletedAt: 999,
          createdAt: 1,
          updatedAt: 1
        }
      ])

      const result = topicService.deleteByAssistantId('asst-1')

      expect(result).toEqual({ deletedIds: ['topic-live'], deletedCount: 1 })
      // The already-trashed row keeps its original deletedAt (untouched by another Delete).
      const rows = await dbh.db
        .select({ id: topicTable.id, deletedAt: topicTable.deletedAt })
        .from(topicTable)
        .orderBy(asc(topicTable.id))
      expect(rows.find((row) => row.id === 'topic-gone')?.deletedAt).toBe(999)
      expect(rows.find((row) => row.id === 'topic-live')?.deletedAt).not.toBeNull()
    })

    it('uses the caller trash identity for active topics and leaves earlier trash untouched', async () => {
      await seedAssistant('asst-batch', 'a0')
      await dbh.db.insert(topicTable).values([
        { id: 'topic-active-1', name: 'Active 1', assistantId: 'asst-batch', orderKey: 'a0' },
        { id: 'topic-active-2', name: 'Active 2', assistantId: 'asst-batch', orderKey: 'a1' },
        {
          id: 'topic-previously-trashed',
          name: 'Earlier trash',
          assistantId: 'asst-batch',
          orderKey: 'a2',
          deletedAt: 99
        }
      ])

      const deletedIds = dbh.db.transaction((tx) =>
        topicService.deleteByAssistantIdTx(tx, 'asst-batch', {
          deletedAt: 0,
          deletionBatchId: 'assistant-batch'
        })
      )

      expect(deletedIds.sort()).toEqual(['topic-active-1', 'topic-active-2'])
      const rows = await dbh.db
        .select({ id: topicTable.id, deletedAt: topicTable.deletedAt, deletionBatchId: topicTable.deletionBatchId })
        .from(topicTable)
        .orderBy(asc(topicTable.id))
      expect(rows).toEqual([
        { id: 'topic-active-1', deletedAt: 0, deletionBatchId: 'assistant-batch' },
        { id: 'topic-active-2', deletedAt: 0, deletionBatchId: 'assistant-batch' },
        { id: 'topic-previously-trashed', deletedAt: 99, deletionBatchId: null }
      ])
    })

    it('returns deletedCount 0 without throwing when the assistant has no topics', async () => {
      // Diverges from deleteByIds — there is no requireAll semantics here, so
      // an assistant with zero (live) topics is a successful no-op delete.
      await seedAssistant('asst-empty', 'a0')

      expect(topicService.deleteByAssistantId('asst-empty')).toEqual({
        deletedIds: [],
        deletedCount: 0
      })
    })

    it('throws NOT_FOUND when the assistant does not exist', async () => {
      let err: unknown
      try {
        topicService.deleteByAssistantId('missing-assistant')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('throws NOT_FOUND when the assistant is soft-deleted', async () => {
      // The isNull(assistantTable.deletedAt) guard treats a soft-deleted
      // assistant as absent — its topics must not be silently purged.
      await seedAssistant('asst-gone', 'a0', 999)
      await dbh.db.insert(topicTable).values({
        id: 'topic-1',
        name: 'Topic 1',
        assistantId: 'asst-gone',
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })

      let err: unknown
      try {
        topicService.deleteByAssistantId('asst-gone')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
      // The topic must survive the rejected call.
      expect(await dbh.db.select().from(topicTable)).toHaveLength(1)
    })
  })

  describe('reorder', () => {
    /**
     * Seed three topics with monotonically increasing global orderKeys
     * ('a0' < 'a1' < 'a2'). Tests anchor against this baseline.
     */
    async function seedThree() {
      await dbh.db.insert(topicTable).values([
        { id: 't1', name: 'A', orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        { id: 't2', name: 'B', orderKey: 'a1', createdAt: 2, updatedAt: 200 },
        { id: 't3', name: 'C', orderKey: 'a2', createdAt: 3, updatedAt: 300 }
      ])
    }

    async function getOrderedIds(): Promise<string[]> {
      const rows = await dbh.db.select({ id: topicTable.id }).from(topicTable).orderBy(asc(topicTable.orderKey))
      return rows.map((r) => r.id)
    }

    it('moves a topic to before its predecessor with anchor.before', async () => {
      await seedThree()
      topicService.reorder('t3', { before: 't1' })
      expect(await getOrderedIds()).toEqual(['t3', 't1', 't2'])
    })

    it('moves a topic to after a successor with anchor.after', async () => {
      await seedThree()
      topicService.reorder('t1', { after: 't2' })
      expect(await getOrderedIds()).toEqual(['t2', 't1', 't3'])
    })

    async function seedMoveTopics() {
      await dbh.db.insert(assistantTable).values([
        {
          id: 'asst-a',
          name: 'A',
          emoji: 'A',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a0'
        },
        {
          id: 'asst-b',
          name: 'B',
          emoji: 'B',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a1'
        }
      ])
      await dbh.db.insert(topicTable).values([
        { id: 'move-a', name: 'A', assistantId: 'asst-a', orderKey: 'a0' },
        { id: 'move-b', name: 'B', assistantId: 'asst-b', orderKey: 'a1' }
      ])
    }

    it('moves a topic owner and order together', async () => {
      await seedMoveTopics()

      const movedTopic = topicService.move('move-a', { assistantId: 'asst-b', order: { after: 'move-b' } })

      expect(movedTopic).toMatchObject({ id: 'move-a', assistantId: 'asst-b' })
      expect(topicService.getById('move-a').assistantId).toBe('asst-b')
      expect(await getOrderedIds()).toEqual(['move-b', 'move-a'])
    })

    it('rolls back the owner and order when applying the order fails', async () => {
      await seedMoveTopics()
      notifyDataApiDataChangeMock.mockClear()
      dbh.db.run(
        sql.raw(`
        CREATE TRIGGER fail_topic_order_update
        BEFORE UPDATE OF order_key ON topic
        WHEN NEW.id = 'move-a'
        BEGIN
          SELECT RAISE(ABORT, 'forced topic order update failure');
        END;
      `)
      )

      try {
        expect(() => topicService.move('move-a', { assistantId: 'asst-b', order: { after: 'move-b' } })).toThrow(
          'forced topic order update failure'
        )
      } finally {
        dbh.db.run(sql.raw('DROP TRIGGER IF EXISTS fail_topic_order_update'))
      }

      expect(topicService.getById('move-a')).toMatchObject({ assistantId: 'asst-a', orderKey: 'a0' })
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    })

    it('rejects a move to a missing assistant without changing the topic', async () => {
      await seedMoveTopics()

      expect(() =>
        topicService.move('move-a', { assistantId: 'missing-assistant', order: { after: 'move-b' } })
      ).toThrow()

      expect(topicService.getById('move-a')).toMatchObject({ assistantId: 'asst-a', orderKey: 'a0' })
    })

    it('rejects an anchor owned by another assistant without changing the topic', async () => {
      await seedMoveTopics()
      await dbh.db.insert(topicTable).values({
        id: 'move-c',
        name: 'C',
        assistantId: 'asst-a',
        orderKey: 'a2'
      })

      expect(() => topicService.move('move-a', { assistantId: 'asst-b', order: { after: 'move-c' } })).toThrow()

      expect(topicService.getById('move-a')).toMatchObject({ assistantId: 'asst-a', orderKey: 'a0' })
    })

    it('rejects a self-referencing anchor without changing the topic', async () => {
      await seedMoveTopics()

      expect(() => topicService.move('move-a', { assistantId: 'asst-b', order: { after: 'move-a' } })).toThrow()

      expect(topicService.getById('move-a')).toMatchObject({ assistantId: 'asst-a', orderKey: 'a0' })
    })

    it("moves a topic to the head with position: 'first'", async () => {
      await seedThree()
      topicService.reorder('t3', { position: 'first' })
      expect(await getOrderedIds()).toEqual(['t3', 't1', 't2'])
    })

    it("moves a topic to the tail with position: 'last'", async () => {
      await seedThree()
      topicService.reorder('t1', { position: 'last' })
      expect(await getOrderedIds()).toEqual(['t2', 't3', 't1'])
    })

    it('throws NOT_FOUND when target id does not exist', async () => {
      await seedThree()
      let err: unknown
      try {
        topicService.reorder('missing', { position: 'first' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        name: 'DataApiError',
        code: ErrorCode.NOT_FOUND
      })
    })

    it('throws NOT_FOUND when anchor id does not exist in scope', async () => {
      await seedThree()
      let err: unknown
      try {
        topicService.reorder('t1', { after: 'missing' })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(DataApiError)
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('throws VALIDATION_ERROR when anchor equals target', async () => {
      await seedThree()
      let err: unknown
      try {
        topicService.reorder('t2', { after: 't2' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.VALIDATION_ERROR
      })
    })

    it('reorders topics globally across assistants', async () => {
      await dbh.db.insert(assistantTable).values([
        {
          id: 'assistant-a',
          name: 'Assistant A',
          emoji: '🌟',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a0',
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'assistant-b',
          name: 'Assistant B',
          emoji: '🌙',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a1',
          createdAt: 2,
          updatedAt: 2
        }
      ])
      await dbh.db.insert(topicTable).values([
        {
          id: 'assistant-a-topic',
          name: 'A topic',
          assistantId: 'assistant-a',
          orderKey: 'a0',
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'assistant-b-topic',
          name: 'B topic',
          assistantId: 'assistant-b',
          orderKey: 'a1',
          createdAt: 2,
          updatedAt: 2
        }
      ])

      topicService.reorder('assistant-a-topic', { after: 'assistant-b-topic' })

      expect(await getOrderedIds()).toEqual(['assistant-b-topic', 'assistant-a-topic'])
    })

    it('excludes soft-deleted topics from reorder lookups', async () => {
      await dbh.db.insert(topicTable).values({
        id: 'gone',
        name: 'gone',
        orderKey: 'a0',
        deletedAt: 999,
        createdAt: 1,
        updatedAt: 1
      })
      let err: unknown
      try {
        topicService.reorder('gone', { position: 'first' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('create', () => {
    it('inserts topic with activeNodeId=null and a fresh orderKey', async () => {
      notifyDataApiDataChangeMock.mockClear()
      const result = topicService.create({ name: 'fresh' })

      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/topics', kind: 'membership', entityIds: [result.id] },
        { endpoint: '/topics', kind: 'order', dimension: 'lastActivityAt', entityIds: [result.id] },
        { endpoint: '/topics/:id', entityIds: [result.id] },
        { endpoint: '/topics/latest' }
      ])
      expect(result.activeNodeId).toBeUndefined()
      expect(result.name).toBe('fresh')
      const [row] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, result.id))
      expect(row?.orderKey).toBeDefined()
      expect(row?.orderKey).not.toBe('')
    })

    it('inserts new topics before existing topics in orderKey order', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'existing-1', name: 'Existing 1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'existing-2', name: 'Existing 2', orderKey: 'a1', createdAt: 2, updatedAt: 2 }
      ])

      const result = topicService.create({ name: 'fresh' })

      const rows = await dbh.db.select({ id: topicTable.id }).from(topicTable).orderBy(asc(topicTable.orderKey))
      expect(rows.map((row) => row.id)).toEqual([result.id, 'existing-1', 'existing-2'])
    })

    it('inserts exactly one content-less virtual root and leaves activeNodeId null', async () => {
      const result = topicService.create({ name: 'fresh' })

      const [topicRow] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, result.id))
      expect(topicRow.activeNodeId).toBeNull()

      // Exactly one parentId-null row: the virtual root (role 'root', empty data).
      const rootRows = await dbh.db
        .select()
        .from(messageTable)
        .where(and(eq(messageTable.topicId, result.id), isNull(messageTable.parentId)))
      expect(rootRows).toHaveLength(1)
      expect(rootRows[0].role).toBe('root')
      expect(rootRows[0].data).toEqual({ parts: [] })
      expect(rootRows[0].status).toBe('success')

      // No content messages yet.
      const allRows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, result.id))
      expect(allRows).toHaveLength(1)
    })
  })

  describe('duplicate', () => {
    it('copies the root-to-node path into a new topic and prunes siblings and descendants', async () => {
      const fileEntryId = '019606a0-0000-7000-8000-00000000fb01' as FileEntryId
      await dbh.db.insert(topicTable).values({
        id: 'src-t',
        name: 'Source',
        isNameManuallyEdited: true,
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })
      await dbh.db.insert(fileEntryTable).values({
        id: fileEntryId,
        origin: 'internal',
        name: 'duplicate-attachment',
        ext: 'txt',
        size: 1,
        externalPath: null,
        deletedAt: null,
        createdAt: 1,
        updatedAt: 1
      })
      await dbh.db.insert(messageTable).values(
        withRoot('src-t', [
          {
            id: 'root',
            topicId: 'src-t',
            parentId: null,
            role: 'user',
            data: { parts: [{ type: 'text', text: 'root prompt' }] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          },
          {
            id: 'selected',
            topicId: 'src-t',
            parentId: 'root',
            role: 'assistant',
            data: {
              parts: [
                { type: 'text', text: 'selected answer' },
                {
                  type: 'file',
                  mediaType: 'text/plain',
                  url: 'file:///tmp/duplicate-attachment.txt',
                  filename: 'duplicate-attachment.txt',
                  providerMetadata: { cherry: { fileEntryId } }
                }
              ]
            },
            status: 'success',
            siblingsGroupId: 77,
            createdAt: 2,
            updatedAt: 2
          },
          {
            id: 'sibling',
            topicId: 'src-t',
            parentId: 'root',
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'sibling answer' }] },
            status: 'success',
            siblingsGroupId: 77,
            createdAt: 3,
            updatedAt: 3
          },
          {
            id: 'descendant',
            topicId: 'src-t',
            parentId: 'selected',
            role: 'user',
            data: { parts: [{ type: 'text', text: 'descendant prompt' }] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 4,
            updatedAt: 4
          }
        ])
      )
      await dbh.db.insert(chatMessageFileRefTable).values([
        {
          id: '11111111-1111-4111-8111-123456789abc',
          fileEntryId,
          sourceId: 'selected',
          role: 'attachment',
          createdAt: 2,
          updatedAt: 2
        }
      ])

      notifyDataApiDataChangeMock.mockClear()
      const result = topicService.duplicate('src-t', { nodeId: 'selected' })

      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/topics', kind: 'membership', entityIds: [result.id] },
        { endpoint: '/topics', kind: 'order', dimension: 'lastActivityAt', entityIds: [result.id] },
        { endpoint: '/topics/:id', entityIds: [result.id] },
        { endpoint: '/topics/latest' }
      ])
      expect(result.id).not.toBe('src-t')
      expect(result.name).toBe('Source')
      expect(result.isNameManuallyEdited).toBe(true)
      expect(result.activeNodeId).toBeDefined()
      expect(result.activeNodeId).not.toBe('selected')

      const copiedRows = await dbh.db.select().from(messageTable).where(eq(messageTable.topicId, result.id))
      // New topic owns its own virtual root plus the two copied content rows.
      expect(copiedRows).toHaveLength(3)
      expect(copiedRows.map((row) => row.id)).not.toContain('root')
      expect(copiedRows.map((row) => row.id)).not.toContain('selected')

      // The new topic's own virtual root (content-less); never a copied content row.
      const copiedVirtualRoot = copiedRows.find((row) => row.parentId === null)
      expect(copiedVirtualRoot?.role).toBe('root')
      expect(copiedVirtualRoot?.data.parts).toEqual([])

      // The copied first-turn head hangs off the new virtual root.
      const copiedRoot = copiedRows.find((row) => row.parentId === copiedVirtualRoot?.id)
      expect(copiedRoot?.data.parts?.[0]).toEqual({ type: 'text', text: 'root prompt' })
      expect(copiedRoot?.siblingsGroupId).toBe(0)

      const copiedLeaf = copiedRows.find((row) => row.parentId === copiedRoot?.id)
      expect(copiedLeaf?.data.parts?.[0]).toEqual({ type: 'text', text: 'selected answer' })
      expect(copiedLeaf?.siblingsGroupId).toBe(0)
      expect(result.activeNodeId).toBe(copiedLeaf?.id)
      expect(copiedLeaf?.data.parts?.[1]).toMatchObject({
        type: 'file',
        providerMetadata: { cherry: { fileEntryId } }
      })

      const refs = await dbh.db.select().from(chatMessageFileRefTable)
      expect(refs).toHaveLength(2)
      expect(refs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fileEntryId,
            sourceId: 'selected',
            role: 'attachment'
          }),
          expect.objectContaining({
            fileEntryId,
            sourceId: copiedLeaf?.id,
            role: 'attachment'
          })
        ])
      )

      const sourceRows = await dbh.db
        .select({ id: messageTable.id })
        .from(messageTable)
        .where(eq(messageTable.topicId, 'src-t'))
      expect(sourceRows.map((row) => row.id).sort()).toEqual([
        'descendant',
        'root',
        'selected',
        'sibling',
        'vroot-src-t'
      ])
    })

    it('uses an explicit duplicate name when provided', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'src-t', name: 'Source', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values(
        withRoot('src-t', [
          {
            id: 'selected',
            topicId: 'src-t',
            parentId: null,
            role: 'user',
            data: { parts: [{ type: 'text', text: 'root prompt' }] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )

      const result = topicService.duplicate('src-t', { nodeId: 'selected', name: 'Source (Copy)' })

      expect(result.name).toBe('Source (Copy)')
      const [row] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, result.id))
      expect(row?.isNameManuallyEdited).toBe(true)
    })

    it('normalizes copied pending messages to error', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'src-t', name: 'Source', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values(
        withRoot('src-t', [
          {
            id: 'selected',
            topicId: 'src-t',
            parentId: null,
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'streaming' }] },
            status: 'pending',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )

      const result = topicService.duplicate('src-t', { nodeId: 'selected' })

      // The copied content row (the only non-virtual-root row) is normalized to error.
      const copiedRows = await dbh.db
        .select()
        .from(messageTable)
        .where(and(eq(messageTable.topicId, result.id), isNotNull(messageTable.parentId)))
      expect(copiedRows).toHaveLength(1)
      expect(copiedRows[0].status).toBe('error')
    })

    it('copies the assistant and inserts first in the global topic order', async () => {
      await dbh.db.insert(assistantTable).values({
        id: 'asst',
        name: 'A',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })
      await dbh.db.insert(topicTable).values([
        { id: 'sibling-t', name: 'Sibling', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        {
          id: 'src-t',
          name: 'Source',
          assistantId: 'asst',
          orderKey: 'a1',
          createdAt: 2,
          updatedAt: 2
        }
      ])
      await dbh.db.insert(messageTable).values(
        withRoot('src-t', [
          {
            id: 'selected',
            topicId: 'src-t',
            parentId: null,
            role: 'user',
            data: { parts: [{ type: 'text', text: 'root prompt' }] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )

      const result = topicService.duplicate('src-t', { nodeId: 'selected' })

      expect(result.assistantId).toBe('asst')

      const rows = await dbh.db
        .select({ id: topicTable.id, orderKey: topicTable.orderKey })
        .from(topicTable)
        .orderBy(asc(topicTable.orderKey))
      expect(rows.map((row) => row.id)).toEqual([result.id, 'sibling-t', 'src-t'])
      expect(rows[0]?.orderKey < rows[1].orderKey).toBe(true)
    })

    it('rejects a missing source topic', async () => {
      let err: unknown
      try {
        topicService.duplicate('missing-topic', { nodeId: 'node-1' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('rejects a soft-deleted source topic', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'src-t', name: 'Source', orderKey: 'a0', deletedAt: 999, createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values(
        withRoot('src-t', [
          {
            id: 'selected',
            topicId: 'src-t',
            parentId: null,
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )

      let err: unknown
      try {
        topicService.duplicate('src-t', { nodeId: 'selected' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('rejects a node outside the source topic', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'src-t', name: 'Source', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'other-t', name: 'Other', orderKey: 'a1', createdAt: 1, updatedAt: 1 }
      ])
      await dbh.db.insert(messageTable).values(
        withRoot('other-t', [
          {
            id: 'other-node',
            parentId: null,
            topicId: 'other-t',
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )

      let err: unknown
      try {
        topicService.duplicate('src-t', { nodeId: 'other-node' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('duplicates from a node whose live path is shorter than root, reparenting the head onto the new virtual root', async () => {
      // The old "Source path does not start at the live root" reject is gone: getPathRowsToNodeTx
      // now starts at the first live first-turn message and copyPathRowsTx reparents the head onto
      // the destination virtual root. Here `deleted-parent` is soft-deleted, so the live path is
      // just `[orphan]` — duplicate succeeds and copies that single row.
      await dbh.db
        .insert(topicTable)
        .values({ id: 'src-t', name: 'Source', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values(
        withRoot('src-t', [
          {
            id: 'deleted-parent',
            topicId: 'src-t',
            parentId: null,
            role: 'user',
            data: { parts: [{ type: 'text', text: 'gone prompt' }] },
            status: 'success',
            siblingsGroupId: 0,
            deletedAt: 999,
            createdAt: 1,
            updatedAt: 1
          },
          {
            id: 'orphan',
            topicId: 'src-t',
            parentId: 'deleted-parent',
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'orphan answer' }] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 2,
            updatedAt: 2
          }
        ])
      )

      const result = topicService.duplicate('src-t', { nodeId: 'orphan' })

      const copiedVirtualRoot = await dbh.db
        .select()
        .from(messageTable)
        .where(and(eq(messageTable.topicId, result.id), isNull(messageTable.parentId)))
      expect(copiedVirtualRoot).toHaveLength(1)
      expect(copiedVirtualRoot[0].role).toBe('root')

      const copiedContent = await dbh.db
        .select()
        .from(messageTable)
        .where(and(eq(messageTable.topicId, result.id), isNotNull(messageTable.parentId)))
      expect(copiedContent).toHaveLength(1)
      expect(copiedContent[0].parentId).toBe(copiedVirtualRoot[0].id)
      expect(copiedContent[0].data.parts?.[0]).toEqual({ type: 'text', text: 'orphan answer' })
      expect(result.activeNodeId).toBe(copiedContent[0].id)
    })

    it('rejects a soft-deleted node in the source topic', async () => {
      await dbh.db
        .insert(topicTable)
        .values({ id: 'src-t', name: 'Source', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values(
        withRoot('src-t', [
          {
            id: 'selected',
            topicId: 'src-t',
            parentId: null,
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            deletedAt: 999,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )

      let err: unknown
      try {
        topicService.duplicate('src-t', { nodeId: 'selected' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('reorderBatch', () => {
    async function seedFour() {
      await dbh.db.insert(topicTable).values([
        { id: 't1', name: 'A', orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        { id: 't2', name: 'B', orderKey: 'a1', createdAt: 2, updatedAt: 200 },
        { id: 't3', name: 'C', orderKey: 'a2', createdAt: 3, updatedAt: 300 },
        { id: 't4', name: 'D', orderKey: 'a3', createdAt: 4, updatedAt: 400 }
      ])
    }

    it('empty moves array is a no-op (no DB writes)', async () => {
      await seedFour()
      const before = await dbh.db
        .select({ id: topicTable.id, orderKey: topicTable.orderKey, updatedAt: topicTable.updatedAt })
        .from(topicTable)
      topicService.reorderBatch([])
      const after = await dbh.db
        .select({ id: topicTable.id, orderKey: topicTable.orderKey, updatedAt: topicTable.updatedAt })
        .from(topicTable)
      expect(after).toEqual(before)
    })

    it('applies multiple moves sequentially in one transaction', async () => {
      await seedFour()
      topicService.reorderBatch([
        { id: 't4', anchor: { position: 'first' } },
        { id: 't1', anchor: { position: 'last' } }
      ])
      const ids = await dbh.db.select({ id: topicTable.id }).from(topicTable).orderBy(asc(topicTable.orderKey))
      expect(ids.map((r) => r.id)).toEqual(['t4', 't2', 't3', 't1'])
    })

    it('applies one global batch across assistants', async () => {
      await dbh.db.insert(assistantTable).values([
        {
          id: 'assistant-a',
          name: 'Assistant A',
          emoji: '🌟',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a0',
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'assistant-b',
          name: 'Assistant B',
          emoji: '🌙',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a1',
          createdAt: 2,
          updatedAt: 2
        }
      ])
      await dbh.db.insert(topicTable).values([
        {
          id: 'a1',
          name: 'A1',
          assistantId: 'assistant-a',
          orderKey: 'a0',
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'a2',
          name: 'A2',
          assistantId: 'assistant-a',
          orderKey: 'a1',
          createdAt: 2,
          updatedAt: 2
        },
        {
          id: 'b1',
          name: 'B1',
          assistantId: 'assistant-b',
          orderKey: 'a2',
          createdAt: 3,
          updatedAt: 3
        },
        {
          id: 'b2',
          name: 'B2',
          assistantId: 'assistant-b',
          orderKey: 'a3',
          createdAt: 4,
          updatedAt: 4
        }
      ])

      topicService.reorderBatch([
        { id: 'b2', anchor: { position: 'first' } },
        { id: 'a1', anchor: { position: 'last' } }
      ])

      const rows = await dbh.db.select({ id: topicTable.id }).from(topicTable).orderBy(asc(topicTable.orderKey))
      expect(rows.map((row) => row.id)).toEqual(['b2', 'a2', 'b1', 'a1'])
    })

    it('throws NOT_FOUND when any target id is missing', async () => {
      await seedFour()
      let err: unknown
      try {
        topicService.reorderBatch([
          { id: 't1', anchor: { position: 'first' } },
          { id: 'missing', anchor: { position: 'first' } }
        ])
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('setActiveNode', () => {
    async function seedTopicWithMessages() {
      await dbh.db.insert(topicTable).values({ id: 't1', name: 'T', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values(
        withRoot('t1', [
          {
            id: 'm1',
            topicId: 't1',
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          },
          {
            id: 'm2',
            topicId: 't1',
            role: 'assistant',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 2,
            updatedAt: 2
          }
        ])
      )
    }

    it('happy path: writes activeNodeId', async () => {
      await seedTopicWithMessages()
      const result = topicService.setActiveNode('t1', 'm2')
      expect(result.activeNodeId).toBe('m2')
      const [row] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 't1'))
      expect(row?.activeNodeId).toBe('m2')
    })

    it('rejects the virtual root as the active node', async () => {
      await seedTopicWithMessages()
      let err: unknown
      try {
        topicService.setActiveNode('t1', 'vroot-t1')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.INVALID_OPERATION
      })
    })

    it('rejects message belonging to a different topic (cross-topic planting guard)', async () => {
      await seedTopicWithMessages()
      await dbh.db.insert(topicTable).values({ id: 't2', name: 'T2', orderKey: 'a1', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values(
        withRoot('t2', [
          {
            id: 'other',
            parentId: null,
            topicId: 't2',
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )
      let err: unknown
      try {
        topicService.setActiveNode('t1', 'other')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('throws NOT_FOUND when nodeId does not exist', async () => {
      await seedTopicWithMessages()
      let err: unknown
      try {
        topicService.setActiveNode('t1', 'no-such')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('throws NOT_FOUND when topicId does not exist', async () => {
      let err: unknown
      try {
        topicService.setActiveNode('no-such', 'm1')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('rejects soft-deleted message', async () => {
      await dbh.db.insert(topicTable).values({ id: 't1', name: 'T', orderKey: 'a0', createdAt: 1, updatedAt: 1 })
      await dbh.db.insert(messageTable).values(
        withRoot('t1', [
          {
            id: 'm-gone',
            parentId: null,
            topicId: 't1',
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            deletedAt: 999,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )
      let err: unknown
      try {
        topicService.setActiveNode('t1', 'm-gone')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })

    it('rejects soft-deleted topic', async () => {
      await dbh.db.insert(topicTable).values({
        id: 't-gone',
        name: 'T',
        orderKey: 'a0',
        deletedAt: 999,
        createdAt: 1,
        updatedAt: 1
      })
      await dbh.db.insert(messageTable).values(
        withRoot('t-gone', [
          {
            id: 'm1',
            parentId: null,
            topicId: 't-gone',
            role: 'user',
            data: { parts: [] },
            status: 'success',
            siblingsGroupId: 0,
            createdAt: 1,
            updatedAt: 1
          }
        ])
      )
      let err: unknown
      try {
        topicService.setActiveNode('t-gone', 'm1')
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({
        code: ErrorCode.NOT_FOUND
      })
    })
  })

  describe('getLatestActive', () => {
    it('returns the globally most-recently-active non-deleted topic, independent of pin/order/updatedAt', async () => {
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'old', name: 'old', orderKey: 'a0', lastActivityAt: 100, createdAt: 1, updatedAt: 900 },
        // Highest activity but soft-deleted → must be excluded.
        {
          id: 'deleted-newest',
          name: 'deleted',
          orderKey: 'a1',
          deletedAt: 999,
          lastActivityAt: 900,
          createdAt: 2,
          updatedAt: 200
        },
        { id: 'latest', name: 'latest', orderKey: 'a2', lastActivityAt: 300, createdAt: 3, updatedAt: 100 },
        { id: 'mid', name: 'mid', orderKey: 'a3', lastActivityAt: 200, createdAt: 4, updatedAt: 300 }
      ])

      expect(service.getLatestActive()?.id).toBe('latest')
    })

    it('returns latest activity within a live or unlinked assistant scope', async () => {
      const service = new TopicService()
      await dbh.db.insert(assistantTable).values([
        {
          id: 'assistant-scoped',
          name: 'Scoped',
          emoji: '🌟',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a0'
        },
        {
          id: 'assistant-other',
          name: 'Other',
          emoji: '🌟',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a1'
        },
        {
          id: 'assistant-deleted-scope',
          name: 'Deleted',
          emoji: '🌟',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a2',
          deletedAt: 100
        }
      ])
      await dbh.db.insert(topicTable).values([
        {
          id: 'topic-scoped',
          name: 'Scoped',
          assistantId: 'assistant-scoped',
          orderKey: 'a0',
          lastActivityAt: 100
        },
        {
          id: 'topic-other',
          name: 'Other',
          assistantId: 'assistant-other',
          orderKey: 'a1',
          lastActivityAt: 500
        },
        {
          id: 'topic-unassigned',
          name: 'Unassigned',
          orderKey: 'a2',
          lastActivityAt: 200
        },
        {
          id: 'topic-deleted-owner',
          name: 'Deleted owner',
          assistantId: 'assistant-deleted-scope',
          orderKey: 'a3',
          lastActivityAt: 300
        }
      ])

      expect(service.getLatestActive({ assistantId: 'assistant-scoped' })?.id).toBe('topic-scoped')
      expect(service.getLatestActive({ assistantId: 'unlinked' })?.id).toBe('topic-deleted-owner')
    })

    it('returns null when there are no topics', () => {
      expect(new TopicService().getLatestActive()).toBeNull()
    })
  })

  describe('reuseOrCreatePlaceholder', () => {
    it('reuses the latest-updated structurally empty topic for the exact owner', async () => {
      const service = new TopicService()
      await dbh.db.insert(assistantTable).values({
        id: 'assistant-reusable',
        name: 'Reusable',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      })
      await dbh.db.insert(topicTable).values([
        {
          id: 'created-later',
          name: '',
          assistantId: 'assistant-reusable',
          orderKey: 'a0',
          createdAt: 300,
          updatedAt: 200
        },
        {
          id: 'updated-later',
          name: '  ',
          assistantId: 'assistant-reusable',
          orderKey: 'a1',
          createdAt: 100,
          updatedAt: 400
        },
        {
          id: 'started',
          name: '',
          assistantId: 'assistant-reusable',
          activeNodeId: 'message-id',
          orderKey: 'a2',
          updatedAt: 900
        },
        {
          id: 'manually-named',
          name: '',
          assistantId: 'assistant-reusable',
          isNameManuallyEdited: true,
          orderKey: 'a3',
          updatedAt: 800
        },
        { id: 'unassigned', name: '', orderKey: 'a4', updatedAt: 700 }
      ])

      expect(service.reuseOrCreatePlaceholder({ assistantId: 'assistant-reusable' })).toMatchObject({
        topic: { id: 'updated-later' },
        created: false
      })
      expect(service.reuseOrCreatePlaceholder({ assistantId: null })).toMatchObject({
        topic: { id: 'unassigned' },
        created: false
      })
    })

    it('creates at most one reusable placeholder for repeated requests', async () => {
      const service = new TopicService()
      await dbh.db.insert(assistantTable).values({
        id: 'assistant-create-placeholder',
        name: 'Create placeholder',
        emoji: '✨',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      })

      const first = service.reuseOrCreatePlaceholder({ assistantId: 'assistant-create-placeholder' })
      const second = service.reuseOrCreatePlaceholder({ assistantId: 'assistant-create-placeholder' })

      expect(first.created).toBe(true)
      expect(second).toMatchObject({ topic: { id: first.topic.id }, created: false })
    })
  })
})
