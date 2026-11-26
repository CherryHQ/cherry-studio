import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { jobScheduleTable } from '@data/db/schemas/job'
import { pinTable } from '@data/db/schemas/pin'
import { preferenceTable } from '@data/db/schemas/preference'
import { topicTable } from '@data/db/schemas/topic'
import { ConversationListSortSeeder } from '@data/db/seeding/seeders/conversationListSortSeeder'
import { agentSessionService } from '@data/services/AgentSessionService'
import { topicService } from '@data/services/TopicService'
import type { ConversationListSortBy } from '@shared/data/types/conversationList'

const rows = [
  { id: 'a', orderKey: 'a0', name: 'Z', createdAt: 500, lastActivityAt: 100 },
  { id: 'b', orderKey: 'a1', name: '', createdAt: 100, lastActivityAt: 500 },
  { id: 'c', orderKey: 'a2', name: 'A:B%', createdAt: 300, lastActivityAt: 300 },
  { id: 'd', orderKey: 'a3', name: 'A', createdAt: 300, lastActivityAt: 300 },
  { id: 'e', orderKey: 'a4', name: '😀', createdAt: 400, lastActivityAt: 200 }
]

describe('conversation list sorting', () => {
  const dbh = setupTestDatabase()
  const seed = (entityType: 'topic' | 'session', values = rows) => {
    if (entityType === 'topic') {
      dbh.db.insert(topicTable).values(values).run()
    } else {
      dbh.db.insert(agentWorkspaceTable).values({ id: 'work', name: 'Work', path: '/work', orderKey: 'a0' }).run()
      dbh.db
        .insert(agentSessionTable)
        .values(values.map((row) => ({ ...row, workspaceId: 'work' })))
        .run()
    }
  }

  // A renderer-only sort used to hide the actual first result on a later manual-order page.
  for (const entityType of ['topic', 'session'] as const) {
    it.each<[ConversationListSortBy, 'asc' | 'desc', string[]]>([
      ['lastActivityAt', 'desc', ['b', 'c', 'd', 'e', 'a']],
      ['lastActivityAt', 'asc', ['a', 'e', 'c', 'd', 'b']],
      ['createdAt', 'desc', ['a', 'e', 'c', 'd', 'b']],
      ['createdAt', 'asc', ['b', 'c', 'd', 'e', 'a']],
      ['name', 'asc', ['b', 'e', 'd', 'c', 'a']],
      ['name', 'desc', ['a', 'c', 'd', 'e', 'b']],
      ['orderKey', 'asc', ['a', 'b', 'c', 'd', 'e']]
    ])(`${entityType}: pages %s %s without losing tied or escaped values`, (sortBy, sortOrder, expected) => {
      seed(entityType)
      const table = entityType === 'topic' ? topicTable : agentSessionTable
      const pinnedRows = [
        { id: 'pin-second', orderKey: 'a5', name: '', createdAt: 1, lastActivityAt: 999 },
        { id: 'pin-first', orderKey: 'a6', name: 'Z', createdAt: 999, lastActivityAt: 1 }
      ]
      if (entityType === 'topic') dbh.db.insert(topicTable).values(pinnedRows).run()
      else
        dbh.db
          .insert(agentSessionTable)
          .values(pinnedRows.map((row) => ({ ...row, workspaceId: 'work' })))
          .run()
      dbh.db
        .insert(pinTable)
        .values([
          { entityType, entityId: 'pin-first', orderKey: 'a0' },
          { entityType, entityId: 'pin-second', orderKey: 'a1' }
        ])
        .run()
      const before = dbh.db.select({ id: table.id, orderKey: table.orderKey }).from(table).all()
      const ids: string[] = []
      let cursor: string | undefined
      for (let page = 0; page < 10; page++) {
        const query = { sortBy, sortOrder, limit: 2, cursor }
        const result =
          entityType === 'topic'
            ? topicService.listByCursor(query)
            : agentSessionService.listByCursor({ ...query, scope: 'ordinary' })
        ids.push(...result.items.map((item) => item.id))
        cursor = result.nextCursor
        if (!cursor) break
      }
      expect(ids).toEqual(['pin-first', 'pin-second', ...expected])
      expect(cursor).toBeUndefined()
      expect(dbh.db.select({ id: table.id, orderKey: table.orderKey }).from(table).all()).toEqual(before)
    })

    it.each([
      ['en-US', ['item2', 'item10', 'z']],
      ['zh-CN', ['阿', '八', '中']],
      ['zh-TW', ['一', '二', '三']],
      ['cs-CZ', ['h', 'ch', 'i']],
      ['th-TH', ['กบ', 'เกาะ', 'ขา']],
      ['tr-TR', ['h', 'ı', 'i', 'j']],
      ['el-GR', ['α', 'ά', 'β']],
      ['ru-RU', ['е', 'ё', 'ж']]
    ] as const)(`${entityType}: paginates %s names before hydrating each page`, (sortLocale, expected) => {
      seed(
        entityType,
        expected.toReversed().map((name, index) => ({ ...rows[0], id: String(index), name }))
      )
      for (const sortOrder of ['asc', 'desc'] as const) {
        const names: string[] = []
        let cursor: string | undefined
        for (let page = 0; page < 10; page++) {
          const query = { sortBy: 'name' as const, sortLocale, sortOrder, cursor, limit: 1 }
          const result =
            entityType === 'topic'
              ? topicService.listByCursor(query)
              : agentSessionService.listByCursor({ ...query, scope: 'ordinary' })
          names.push(...result.items.map((item) => item.name))
          cursor = result.nextCursor
          if (!cursor) break
        }
        expect(names).toEqual(sortOrder === 'asc' ? expected : expected.toReversed())
        expect(cursor).toBeUndefined()
      }
    })

    it(`${entityType}: continues past a deleted anchor and canonical/case ties`, () => {
      seed(
        entityType,
        ['é', 'É', 'e\u0301', 'z'].map((name, index) => ({ ...rows[0], id: `id-${index}`, name }))
      )
      const query = { sortBy: 'name' as const, sortOrder: 'asc' as const, sortLocale: 'fr-FR', limit: 1 }
      const first =
        entityType === 'topic'
          ? topicService.listByCursor(query)
          : agentSessionService.listByCursor({ ...query, scope: 'ordinary' })
      expect(first.items.map((item) => item.id)).toEqual(['id-0'])
      expect(first.nextCursor).toBeDefined()
      const table = entityType === 'topic' ? topicTable : agentSessionTable
      dbh.db.update(table).set({ deletedAt: 1 }).where(eq(table.id, 'id-0')).run()
      const remainingQuery = { ...query, cursor: first.nextCursor, limit: 10 }
      const rest =
        entityType === 'topic'
          ? topicService.listByCursor(remainingQuery)
          : agentSessionService.listByCursor({ ...remainingQuery, scope: 'ordinary' })
      expect(rest.items.map((item) => item.id)).toEqual(['id-1', 'id-2', 'id-3'])
      expect(rest.nextCursor).toBeUndefined()
    })
  }

  it('localizes topic search without admitting excluded or trashed candidates', () => {
    seed(
      'topic',
      ['item10', 'item2', 'item1', 'other'].map((name, index) => ({ ...rows[0], id: String(index), name }))
    )
    dbh.db.update(topicTable).set({ deletedAt: 1 }).where(eq(topicTable.id, '2')).run()
    const result = topicService.listByCursor({
      sortBy: 'name',
      sortLocale: 'en-US',
      sortOrder: 'asc',
      q: 'item',
      ids: ['0', '1', '2', '3']
    })
    expect(result.items.map((item) => item.name)).toEqual(['item2', 'item10'])
  })

  it('keeps localized session name candidates scoped to ordinary sessions and the workspace', () => {
    seed(
      'session',
      ['item10', 'item2'].map((name, index) => ({ ...rows[0], id: String(index), name }))
    )
    dbh.db.insert(agentWorkspaceTable).values({ id: 'other-work', name: 'Other', path: '/other', orderKey: 'a1' }).run()
    dbh.db
      .insert(agentSessionTable)
      .values([
        { id: 'other', name: 'item1', workspaceId: 'other-work', orderKey: 'a1' },
        { id: 'background', name: 'item1', workspaceId: 'work', orderKey: 'a2', type: 'background' },
        { id: 'deleted', name: 'item1', workspaceId: 'work', orderKey: 'a3', deletedAt: 1 }
      ])
      .run()
    const result = agentSessionService.listByCursor({
      scope: 'ordinary',
      workspaceId: 'work',
      sortBy: 'name',
      sortOrder: 'asc',
      sortLocale: 'en-US'
    })
    expect(result.items.map((item) => item.name)).toEqual(['item2', 'item10'])
  })

  // Key existence is not drag evidence; creation assigns keys to every row.
  it.each([
    { times: [300, 200, 100], expected: { by: 'lastActivityAt', direction: 'desc' } },
    { times: [300, 300, 100], expected: { by: 'lastActivityAt', direction: 'desc' } },
    { times: [100, 300, 200], expected: { by: 'orderKey' } },
    { times: [], expected: { by: 'lastActivityAt', direction: 'desc' } }
  ])('initializes only missing preferences from current order: $times', ({ times, expected }) => {
    const values = rows.slice(0, times.length).map((row, i) => ({ ...row, createdAt: times[i] }))
    if (values.length) seed('topic', values)
    const seeder = new ConversationListSortSeeder()
    seeder.run(dbh.db)
    const read = () => dbh.db.select().from(preferenceTable).all()
    expect(read().find((row) => row.key === 'chat.topics.sort')?.value).toEqual(expected)
    expect(read().find((row) => row.key === 'agent.session.sort')?.value).toEqual({
      by: 'lastActivityAt',
      direction: 'desc'
    })
    dbh.db.delete(topicTable).run()
    seeder.run(dbh.db)
    expect(read().find((row) => row.key === 'chat.topics.sort')?.value).toEqual(expected)
  })

  it('infers Agent custom order separately and ignores background, deleted and pinned rows', () => {
    seed('session', [
      { ...rows[0], createdAt: 100 },
      { ...rows[1], createdAt: 500 }
    ])
    dbh.db
      .insert(topicTable)
      .values([
        { ...rows[0], createdAt: 300 },
        { ...rows[1], createdAt: 200 },
        { ...rows[2], createdAt: 900, deletedAt: 10 },
        { ...rows[3], createdAt: 800 }
      ])
      .run()
    dbh.db.insert(pinTable).values({ entityType: 'topic', entityId: 'd', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentSessionTable)
      .values({ ...rows[4], type: 'background', createdAt: 900, workspaceId: 'work' })
      .run()
    new ConversationListSortSeeder().run(dbh.db)
    const preferences = dbh.db.select().from(preferenceTable).all()
    expect(preferences.find((row) => row.key === 'chat.topics.sort')?.value).toEqual({
      by: 'lastActivityAt',
      direction: 'desc'
    })
    expect(preferences.find((row) => row.key === 'agent.session.sort')?.value).toEqual({ by: 'orderKey' })
  })
  it('preserves an explicit automatic choice instead of repeating legacy inference', () => {
    seed('topic')
    dbh.db
      .insert(preferenceTable)
      .values({ scope: 'default', key: 'chat.topics.sort', value: { by: 'name', direction: 'asc' } })
      .run()
    new ConversationListSortSeeder().run(dbh.db)
    expect(
      dbh.db
        .select()
        .from(preferenceTable)
        .all()
        .find((row) => row.key === 'chat.topics.sort')?.value
    ).toEqual({ by: 'name', direction: 'asc' })
  })

  it('does not infer Agent custom order from task, background, pinned or trashed sessions', () => {
    seed('session', rows.slice(0, 2))
    dbh.db
      .insert(jobScheduleTable)
      .values({
        id: 'task',
        type: 'agent.task',
        trigger: { kind: 'once', at: 1 },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values([
        { id: 'task-session', name: 'Task', workspaceId: 'work', orderKey: 'a2', createdAt: 900, taskId: 'task' },
        {
          id: 'background',
          name: 'Background',
          workspaceId: 'work',
          orderKey: 'a3',
          createdAt: 900,
          type: 'background'
        },
        { id: 'pinned', name: 'Pinned', workspaceId: 'work', orderKey: 'a4', createdAt: 900 },
        { id: 'trashed', name: 'Trashed', workspaceId: 'work', orderKey: 'a5', createdAt: 900, deletedAt: 1 }
      ])
      .run()
    dbh.db.insert(pinTable).values({ entityType: 'session', entityId: 'pinned', orderKey: 'a0' }).run()
    new ConversationListSortSeeder().run(dbh.db)
    expect(
      dbh.db
        .select()
        .from(preferenceTable)
        .all()
        .find((row) => row.key === 'agent.session.sort')?.value
    ).toEqual({ by: 'lastActivityAt', direction: 'desc' })
  })
})
