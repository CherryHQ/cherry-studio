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
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import { describe, expect, it, type Mock } from 'vitest'

describe('TopicService', () => {
  const dbh = setupTestDatabase()

  describe('search', () => {
    it('returns lean topic items with assistant names resolved inline', async () => {
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
          updatedAt: 100
        },
        {
          id: 'topic-search-new',
          name: 'Needle New Topic',
          assistantId: 'asst-search',
          orderKey: 'a1',
          updatedAt: 200
        },
        {
          id: 'topic-search-miss',
          name: 'Other Topic',
          assistantId: 'asst-search',
          orderKey: 'a2',
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
          updatedAt: '1970-01-01T00:00:00.200Z',
          target: { topicId: 'topic-search-new', assistantId: 'asst-search' }
        },
        {
          type: 'topic',
          id: 'topic-search-old',
          title: 'Needle Old Topic',
          subtitle: 'Needle Assistant',
          updatedAt: '1970-01-01T00:00:00.100Z',
          target: { topicId: 'topic-search-old', assistantId: 'asst-search' }
        }
      ])
      expect(result[0]).not.toHaveProperty('orderKey')
    })
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

    const updated = topicService.update('topic-name-only', {
      name: 'Manual topic name'
    })

    expect(updated).toMatchObject({
      id: 'topic-name-only',
      name: 'Manual topic name',
      isNameManuallyEdited: true
    })
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
      expect(result.items.map(({ id, pinned, pinId }) => ({ id, pinned, pinId }))).toEqual([
        { id: 't-pinned-1', pinned: true, pinId: 'pin-1' },
        { id: 't-pinned-2', pinned: true, pinId: 'pin-2' },
        { id: 't-unpinned-1', pinned: false, pinId: null },
        { id: 't-unpinned-2', pinned: false, pinId: null }
      ])
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

  describe('listByCursor (flat sortBy profiles)', () => {
    // Fixture: four topics with deliberately disagreeing orderKey and updatedAt
    // so each profile's assertion pins its own sort column, plus one pinned row
    // and one unlinked (assistantId NULL) row.
    async function seedFlat() {
      await dbh.db.insert(assistantTable).values({
        id: 'asst-1',
        name: 'A',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })
      await dbh.db.insert(topicTable).values([
        { id: 't1', name: 'Alpha', assistantId: 'asst-1', orderKey: 'a3', createdAt: 1, updatedAt: 100 },
        { id: 't2', name: 'Beta', assistantId: 'asst-1', orderKey: 'a2', createdAt: 2, updatedAt: 200 },
        { id: 't3', name: 'Gamma', orderKey: 'a1', createdAt: 3, updatedAt: 300 },
        { id: 't4', name: 'Delta', orderKey: 'a0', createdAt: 4, updatedAt: 400 }
      ])
      await dbh.db.insert(pinTable).values({
        id: '33333333-3333-4333-8333-333333333333',
        entityType: 'topic',
        entityId: 't2',
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })
    }

    it('sortBy=updatedAt returns activity order (updatedAt DESC, id ASC) with no pin section', async () => {
      await seedFlat()
      const result = topicService.listByCursor({ sortBy: 'updatedAt' })
      expect(result.items.map((t) => t.id)).toEqual(['t4', 't3', 't2', 't1'])
      expect(result.items.find((topic) => topic.id === 't2')).toMatchObject({
        pinned: true,
        pinId: '33333333-3333-4333-8333-333333333333'
      })
      expect(result.items.find((topic) => topic.id === 't1')).toMatchObject({
        pinned: false,
        pinId: null
      })
      expect(result.nextCursor).toBeUndefined()
    })

    it('sortBy=orderKey returns manual order (orderKey ASC, id ASC) including pinned rows', async () => {
      await seedFlat()
      const result = topicService.listByCursor({ sortBy: 'orderKey' })
      expect(result.items.map((t) => t.id)).toEqual(['t4', 't3', 't2', 't1'])
    })

    it('pages a pinned-only stream by the requested business sort, not pin order', async () => {
      await seedFlat()
      await dbh.db.insert(pinTable).values({
        id: '55555555-5555-4555-8555-555555555555',
        entityType: 'topic',
        entityId: 't4',
        orderKey: 'a1',
        createdAt: 1,
        updatedAt: 1
      })

      const page1 = topicService.listByCursor({ sortBy: 'createdAt', pinned: true, limit: 1 })
      const page2 = topicService.listByCursor({
        sortBy: 'createdAt',
        pinned: true,
        limit: 1,
        cursor: page1.nextCursor
      })

      expect(page1.items.map((topic) => topic.id)).toEqual(['t4'])
      expect(page2.items.map((topic) => topic.id)).toEqual(['t2'])
      expect(page2.nextCursor).toBeUndefined()
    })

    it('breaks createdAt ties by id ASC across page boundaries (no skip/dup)', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'tie-a', name: 'a', orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        { id: 'tie-b', name: 'b', orderKey: 'a1', createdAt: 1, updatedAt: 100 },
        { id: 'tie-c', name: 'c', orderKey: 'a2', createdAt: 1, updatedAt: 100 }
      ])
      const page1 = topicService.listByCursor({ sortBy: 'createdAt', limit: 2 })
      expect(page1.items.map((t) => t.id)).toEqual(['tie-a', 'tie-b'])
      expect(page1.nextCursor).toBeDefined()
      const page2 = topicService.listByCursor({ sortBy: 'createdAt', limit: 2, cursor: page1.nextCursor })
      expect(page2.items.map((t) => t.id)).toEqual(['tie-c'])
      expect(page2.nextCursor).toBeUndefined()
    })

    it('keeps a value cursor usable after the anchor row is deleted', async () => {
      await seedFlat()
      const page1 = topicService.listByCursor({ sortBy: 'updatedAt', limit: 2 })
      expect(page1.items.map((t) => t.id)).toEqual(['t4', 't3'])
      // Hard-delete the anchor (t3) between page requests.
      topicService.delete('t3')
      const page2 = topicService.listByCursor({ sortBy: 'updatedAt', limit: 2, cursor: page1.nextCursor })
      expect(page2.items.map((t) => t.id)).toEqual(['t2', 't1'])
    })

    it('filters by concrete assistantId and by unlinked', async () => {
      await seedFlat()
      const owned = topicService.listByCursor({ sortBy: 'updatedAt', assistantId: 'asst-1' })
      expect(owned.items.map((t) => t.id)).toEqual(['t2', 't1'])
      const unlinked = topicService.listByCursor({ sortBy: 'updatedAt', assistantId: 'unlinked' })
      expect(unlinked.items.map((t) => t.id)).toEqual(['t4', 't3'])
    })

    it('treats topics owned by a soft-deleted assistant as unlinked', async () => {
      await seedFlat()
      await dbh.db.insert(assistantTable).values({
        id: 'asst-deleted',
        name: 'Deleted',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a1',
        deletedAt: 999
      })
      await dbh.db.insert(topicTable).values({
        id: 't5',
        name: 'Soft-deleted owner',
        assistantId: 'asst-deleted',
        orderKey: 'a4',
        createdAt: 5,
        updatedAt: 500
      })

      const unlinked = topicService.listByCursor({ sortBy: 'updatedAt', assistantId: 'unlinked' })
      expect(unlinked.items.map((topic) => topic.id)).toEqual(['t5', 't4', 't3'])
    })

    it('filters by pinned=true and pinned=false', async () => {
      await seedFlat()
      const pinned = topicService.listByCursor({ sortBy: 'updatedAt', pinned: true })
      expect(pinned.items.map((t) => t.id)).toEqual(['t2'])
      const unpinned = topicService.listByCursor({ sortBy: 'updatedAt', pinned: false })
      expect(unpinned.items.map((t) => t.id)).toEqual(['t4', 't3', 't1'])
    })

    it('pages the unpinned creation stream by createdAt DESC with a stable cursor', async () => {
      await seedFlat()
      const first = topicService.listByCursor({ sortBy: 'createdAt', pinned: false, limit: 2 })
      const second = topicService.listByCursor({
        sortBy: 'createdAt',
        pinned: false,
        limit: 2,
        cursor: first.nextCursor
      })

      expect(first.items.map((topic) => topic.id)).toEqual(['t4', 't3'])
      expect(second.items.map((topic) => topic.id)).toEqual(['t1'])
      expect(second.nextCursor).toBeUndefined()
    })

    it('filters by explicit ids and by search q together', async () => {
      await seedFlat()
      const byIds = topicService.listByCursor({ sortBy: 'updatedAt', ids: ['t1', 't4'] })
      expect(byIds.items.map((t) => t.id)).toEqual(['t4', 't1'])
      const searched = topicService.listByCursor({ sortBy: 'updatedAt', q: 'amma', ids: ['t3', 't4'] })
      expect(searched.items.map((t) => t.id)).toEqual(['t3'])
    })

    it('excludes soft-deleted topics from flat pages', async () => {
      await seedFlat()
      await dbh.db.insert(topicTable).values({
        id: 'gone',
        name: 'gone',
        orderKey: 'a9',
        deletedAt: 999,
        createdAt: 1,
        updatedAt: 999
      })
      const result = topicService.listByCursor({ sortBy: 'updatedAt' })
      expect(result.items.map((t) => t.id)).toEqual(['t4', 't3', 't2', 't1'])
    })
  })

  describe('stats', () => {
    async function seedStats() {
      await dbh.db.insert(assistantTable).values({
        id: 'asst-1',
        name: 'A',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })
      await dbh.db.insert(topicTable).values([
        { id: 't1', name: 'Alpha', assistantId: 'asst-1', orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        { id: 't2', name: 'Beta', assistantId: 'asst-1', orderKey: 'a1', createdAt: 2, updatedAt: 200 },
        { id: 't3', name: 'Gamma', orderKey: 'a2', createdAt: 3, updatedAt: 300 }
      ])
      await dbh.db.insert(pinTable).values({
        id: '44444444-4444-4444-8444-444444444444',
        entityType: 'topic',
        entityId: 't1',
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })
    }

    it('returns total, pinnedCount, and byAssistant with an explicit unlinked (null) entry', async () => {
      await seedStats()
      const stats = topicService.stats()
      expect(stats.total).toBe(3)
      expect(stats.pinnedCount).toBe(1)
      const byAssistant = [...stats.byAssistant].sort((a, b) =>
        String(a.assistantId).localeCompare(String(b.assistantId))
      )
      expect(byAssistant).toEqual([
        { assistantId: 'asst-1', count: 2, pinnedCount: 1 },
        { assistantId: null, count: 1, pinnedCount: 0 }
      ])
    })

    it('applies record filters (assistantId scope, search q)', async () => {
      await seedStats()
      expect(topicService.stats({ assistantId: 'asst-1' })).toMatchObject({ total: 2, pinnedCount: 1 })
      expect(topicService.stats({ assistantId: 'unlinked' })).toMatchObject({ total: 1, pinnedCount: 0 })
      expect(topicService.stats({ q: 'eta' })).toMatchObject({ total: 1, pinnedCount: 0 })
    })

    it('folds soft-deleted assistant owners into the unlinked stats entry', async () => {
      await seedStats()
      await dbh.db.insert(assistantTable).values({
        id: 'asst-deleted',
        name: 'Deleted',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a1',
        deletedAt: 999
      })
      await dbh.db.insert(topicTable).values({
        id: 't4',
        name: 'Soft-deleted owner',
        assistantId: 'asst-deleted',
        orderKey: 'a3',
        createdAt: 4,
        updatedAt: 400
      })

      expect(topicService.stats({ assistantId: 'unlinked' })).toMatchObject({ total: 2, pinnedCount: 0 })
      expect(topicService.stats().byAssistant).toEqual(
        expect.arrayContaining([
          { assistantId: 'asst-1', count: 2, pinnedCount: 1 },
          { assistantId: null, count: 2, pinnedCount: 0 }
        ])
      )
    })

    it('ignores soft-deleted rows and pin rows of other entity types', async () => {
      await seedStats()
      await dbh.db.insert(topicTable).values({
        id: 'gone',
        name: 'gone',
        orderKey: 'a9',
        deletedAt: 999,
        createdAt: 1,
        updatedAt: 999
      })
      await dbh.db.insert(pinTable).values({
        id: '55555555-5555-4555-8555-555555555555',
        entityType: 'session',
        entityId: 't2',
        orderKey: 'a1',
        createdAt: 1,
        updatedAt: 1
      })
      const stats = topicService.stats()
      expect(stats.total).toBe(3)
      expect(stats.pinnedCount).toBe(1)
    })
  })

  describe('delete', () => {
    it('should remove topic messages and entity tags in one delete flow', async () => {
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

      topicService.delete('topic-1')

      expect(await dbh.db.select().from(topicTable)).toHaveLength(0)
      expect(await dbh.db.select().from(messageTable)).toHaveLength(0)
      expect(await dbh.db.select().from(entityTagTable)).toHaveLength(0)
    })

    it('deletes a topic containing a multi-model sibling group without a unique-index crash', async () => {
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

      expect(await dbh.db.select().from(topicTable)).toHaveLength(0)
      expect(await dbh.db.select().from(messageTable)).toHaveLength(0)
    })

    it('purges the pin row when an underlying topic is deleted', async () => {
      // Without purgeForEntityTx in the delete tx, the pin row would survive
      // and a future POST /pins for the same id would hit the UNIQUE index.
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

      const topics = await dbh.db.select({ id: topicTable.id }).from(topicTable).orderBy(asc(topicTable.id))
      expect(topics.map((topic) => topic.id)).toEqual(['topic-1', 'topic-2'])
      // virtual root + message-1 both survive the rejected delete
      expect(await dbh.db.select().from(messageTable)).toHaveLength(2)
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

    it('deletes only the assistant non-deleted topics and cascades messages/tags/pins', async () => {
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
      expect(await dbh.db.select().from(topicTable)).toHaveLength(0)
      expect(await dbh.db.select().from(messageTable)).toHaveLength(0)
      expect(await dbh.db.select().from(entityTagTable)).toHaveLength(0)
      expect(await dbh.db.select().from(pinTable)).toHaveLength(0)
    })

    it('only deletes topics scoped to the target assistant', async () => {
      await seedAssistant('asst-1', 'a0')
      await seedAssistant('asst-2', 'a1')
      await dbh.db.insert(topicTable).values([
        { id: 'topic-1', name: 'Topic 1', assistantId: 'asst-1', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'topic-2', name: 'Topic 2', assistantId: 'asst-2', orderKey: 'a1', createdAt: 1, updatedAt: 1 }
      ])

      const result = topicService.deleteByAssistantId('asst-1')

      expect(result).toEqual({ deletedIds: ['topic-1'], deletedCount: 1 })
      const remaining = await dbh.db.select({ id: topicTable.id }).from(topicTable).orderBy(asc(topicTable.id))
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
      // The soft-deleted row must remain untouched.
      const remaining = await dbh.db.select({ id: topicTable.id }).from(topicTable).orderBy(asc(topicTable.id))
      expect(remaining.map((topic) => topic.id)).toEqual(['topic-gone'])
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

    it('moves owner and order atomically', async () => {
      await dbh.db.insert(assistantTable).values([
        {
          id: 'asst-a',
          name: 'A',
          emoji: 'A',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a0',
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'asst-b',
          name: 'B',
          emoji: 'B',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a1',
          createdAt: 1,
          updatedAt: 1
        }
      ])
      await dbh.db.insert(topicTable).values([
        { id: 'move-a', name: 'A', assistantId: 'asst-a', orderKey: 'a0', createdAt: 1, updatedAt: 1 },
        { id: 'move-b', name: 'B', assistantId: 'asst-b', orderKey: 'a1', createdAt: 1, updatedAt: 1 }
      ])

      topicService.move('move-a', { assistantId: 'asst-b', order: { after: 'move-b' } })

      expect(topicService.getById('move-a').assistantId).toBe('asst-b')
      expect(await getOrderedIds()).toEqual(['move-b', 'move-a'])
    })

    it('rolls back owner changes when the move anchor is invalid', async () => {
      await dbh.db.insert(assistantTable).values([
        {
          id: 'asst-a',
          name: 'A',
          emoji: 'A',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a0',
          createdAt: 1,
          updatedAt: 1
        },
        {
          id: 'asst-b',
          name: 'B',
          emoji: 'B',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a1',
          createdAt: 1,
          updatedAt: 1
        }
      ])
      await dbh.db.insert(topicTable).values({
        id: 'move-a',
        name: 'A',
        assistantId: 'asst-a',
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })

      expect(() => topicService.move('move-a', { assistantId: 'asst-b', order: { after: 'missing' } })).toThrow()
      expect(topicService.getById('move-a').assistantId).toBe('asst-a')
    })

    it('rejects a missing assistant and leaves owner and order unchanged', async () => {
      await dbh.db.insert(assistantTable).values({
        id: 'asst-a',
        name: 'A',
        emoji: 'A',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      })
      await dbh.db.insert(topicTable).values([
        { id: 'move-a', name: 'A', assistantId: 'asst-a', orderKey: 'a0' },
        { id: 'move-b', name: 'B', orderKey: 'a1' }
      ])

      const error = (() => {
        try {
          topicService.move('move-a', { assistantId: 'asst-missing', order: { after: 'move-b' } })
        } catch (caught) {
          return caught
        }
        throw new Error('Expected move to reject a missing assistant')
      })()

      expect(error).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { resource: 'Assistant', id: 'asst-missing' }
      })
      expect(topicService.getById('move-a')).toMatchObject({ assistantId: 'asst-a', orderKey: 'a0' })
      expect(await getOrderedIds()).toEqual(['move-a', 'move-b'])
    })

    it('rejects a soft-deleted assistant as a move owner', async () => {
      await dbh.db.insert(assistantTable).values([
        {
          id: 'asst-a',
          name: 'A',
          emoji: 'A',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a0'
        },
        {
          id: 'asst-deleted',
          name: 'Deleted',
          emoji: 'D',
          settings: DEFAULT_ASSISTANT_SETTINGS,
          orderKey: 'a1',
          deletedAt: 999
        }
      ])
      await dbh.db.insert(topicTable).values({
        id: 'move-a',
        name: 'A',
        assistantId: 'asst-a',
        orderKey: 'a0'
      })

      let error: unknown
      try {
        topicService.move('move-a', { assistantId: 'asst-deleted', order: { position: 'last' } })
      } catch (caught) {
        error = caught
      }
      expect(error).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        details: { resource: 'Assistant', id: 'asst-deleted' }
      })
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
      const result = topicService.create({ name: 'fresh' })
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

    it('anchors new topic order against active rows instead of soft-deleted rows', async () => {
      await dbh.db.insert(topicTable).values([
        { id: 'deleted-first', name: 'Deleted', orderKey: 'a0', deletedAt: 10, createdAt: 1, updatedAt: 10 },
        { id: 'active-first', name: 'Active', orderKey: 'a1', createdAt: 2, updatedAt: 2 }
      ])

      const result = topicService.create({ name: 'fresh' })

      expect(result.orderKey).toBe(generateOrderKeyBetween(null, 'a1'))
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

      const result = topicService.duplicate('src-t', { nodeId: 'selected' })

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

  describe('getLatestUpdated', () => {
    it('returns the globally most-recently-updated non-deleted topic, independent of pin/order', async () => {
      const service = new TopicService()
      await dbh.db.insert(topicTable).values([
        { id: 'old', name: 'old', orderKey: 'a0', createdAt: 1, updatedAt: 100 },
        // Highest updatedAt but soft-deleted → must be excluded.
        { id: 'deleted-newest', name: 'deleted', orderKey: 'a1', deletedAt: 999, createdAt: 2, updatedAt: 900 },
        { id: 'latest', name: 'latest', orderKey: 'a2', createdAt: 3, updatedAt: 300 },
        { id: 'mid', name: 'mid', orderKey: 'a3', createdAt: 4, updatedAt: 200 }
      ])

      expect(service.getLatestUpdated()?.id).toBe('latest')
    })

    it('returns null when there are no topics', () => {
      expect(new TopicService().getLatestUpdated()).toBeNull()
    })
  })
})
