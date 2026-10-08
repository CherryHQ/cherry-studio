import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { groupTable } from '@data/db/schemas/group'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { KnowledgeBaseOrderSeeder } from '@data/db/seeding/seeders/knowledgeBaseOrderSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { KnowledgeBaseService } from '@data/services/KnowledgeBaseService'

// An upgrade must preserve populated knowledge rows while initializing their original order.
describe('knowledge ordering migrate-forward', () => {
  const dbh = setupTestDatabase()

  it('upgrades a populated previous schema without losing rows or changing timestamps', () => {
    const migrationsFolder = resolve('migrations/sqlite-drizzle')
    const journal = JSON.parse(readFileSync(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const migration = journal.entries.find((entry) => entry.tag.endsWith('orange_scarlet_witch'))!
    const values = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Older', createdAt: 1000, updatedAt: 1100 },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Newer', createdAt: 2000, updatedAt: 2100 }
    ]
    const groupId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    dbh.db
      .insert(groupTable)
      .values({ id: groupId, entityType: 'knowledge', name: 'Existing group', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(knowledgeBaseTable)
      .values(
        values.map((row) => ({
          ...row,
          orderKey: 'a0',
          groupId,
          status: 'completed' as const,
          error: null,
          chunkSize: 1024,
          chunkOverlap: 200
        }))
      )
      .run()
    const content = { source: 'Original note', content: 'Existing user content' }
    dbh.db
      .insert(knowledgeItemTable)
      .values({ baseId: values[0].id, type: 'note', data: content, status: 'completed' })
      .run()
    dbh.sqlite.exec(
      'DROP INDEX knowledge_base_group_id_order_key_idx; ALTER TABLE knowledge_base DROP COLUMN order_key'
    )
    dbh.sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at >= ?').run(migration.when)
    applyMigrations(dbh.db, migrationsFolder)
    new SeedRunner(dbh.db).runAll([new KnowledgeBaseOrderSeeder()])
    const service = new KnowledgeBaseService()
    const rows = service.listCursor({ limit: 100, sortBy: 'orderKey', sortOrder: 'asc' }).items
    expect(rows.map((row) => row.name)).toEqual(['Newer', 'Older'])
    for (const original of values) {
      const row = service.getById(original.id)
      expect(row.createdAt).toBe(new Date(original.createdAt).toISOString())
      expect(row.updatedAt).toBe(new Date(original.updatedAt).toISOString())
      expect(row.name).toBe(original.name)
      expect(row.groupId).toBe(groupId)
    }
    expect(dbh.db.select().from(knowledgeItemTable).all()[0].data).toEqual(content)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('preserves custom keys and child rows through the constraint rebuild', () => {
    const service = new KnowledgeBaseService()
    const first = service.create({ name: 'First' })
    const second = service.create({ name: 'Second' })
    service.reorder(first.id, { anchor: { before: second.id } })
    const bases = dbh.db.select().from(knowledgeBaseTable).all()
    dbh.db
      .insert(knowledgeItemTable)
      .values({ baseId: first.id, type: 'note', data: { source: 'Note', content: 'Keep me' }, status: 'completed' })
      .run()
    const items = dbh.db.select().from(knowledgeItemTable).all()
    dbh.sqlite.exec(
      'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)'
    )

    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))

    expect(dbh.db.select().from(knowledgeBaseTable).all()).toEqual(bases)
    expect(dbh.db.select().from(knowledgeItemTable).all()).toEqual(items)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
