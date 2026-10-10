import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it } from 'vitest'

import { assistantHandlers } from '@data/api/handlers/assistants'
import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { assistantDataService } from '@data/services/AssistantService'

type RelationField = 'mcpServerIds' | 'knowledgeBaseIds'

describe('Assistant relation writes with duplicate IDs', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    for (const id of ['old', 'keep', 'new']) {
      dbh.db.insert(mcpServerTable).values({ id, name: id }).run()
      dbh.db
        .insert(knowledgeBaseTable)
        .values({ id, name: id, status: 'completed', chunkSize: 1024, chunkOverlap: 200 })
        .run()
    }
  })

  function relationRows(field: RelationField) {
    return field === 'mcpServerIds'
      ? dbh.db
          .select()
          .from(assistantMcpServerTable)
          .all()
          .map((row) => ({ id: row.mcpServerId, createdAt: row.createdAt, updatedAt: row.updatedAt }))
      : dbh.db
          .select()
          .from(assistantKnowledgeBaseTable)
          .all()
          .map((row) => ({ id: row.knowledgeBaseId, createdAt: row.createdAt, updatedAt: row.updatedAt }))
  }

  function snapshot() {
    return {
      assistants: dbh.db.select().from(assistantTable).all(),
      mcp: dbh.db.select().from(assistantMcpServerTable).all(),
      knowledge: dbh.db.select().from(assistantKnowledgeBaseTable).all()
    }
  }

  describe.each<RelationField>(['mcpServerIds', 'knowledgeBaseIds'])('%s', (field) => {
    it('creates one binding per ID and returns unique IDs in first-occurrence order', async () => {
      const body = { name: 'Assistant', [field]: ['new', 'keep', 'new', 'keep'] }

      const result = await assistantHandlers['/assistants'].POST({ body })

      expect(result).toMatchObject({ name: 'Assistant', [field]: ['new', 'keep'] })
      const rows = dbh.db.select().from(assistantTable).all()
      expect(rows).toHaveLength(1)
      expect(assistantDataService.getById(rows[0].id)[field].sort()).toEqual(['keep', 'new'])
      expect(
        relationRows(field)
          .map((row) => row.id)
          .sort()
      ).toEqual(['keep', 'new'])
      expect(body[field]).toEqual(['new', 'keep', 'new', 'keep'])
    })

    it('replaces bindings with unique IDs while preserving retained timestamps and omitted relations', async () => {
      const assistant = assistantDataService.create({
        name: 'Before',
        mcpServerIds: ['old', 'keep'],
        knowledgeBaseIds: ['old', 'keep']
      })
      dbh.db.update(assistantMcpServerTable).set({ createdAt: 1000, updatedAt: 2000 }).run()
      dbh.db.update(assistantKnowledgeBaseTable).set({ createdAt: 1000, updatedAt: 2000 }).run()
      const otherField = field === 'mcpServerIds' ? 'knowledgeBaseIds' : 'mcpServerIds'
      const otherBefore = relationRows(otherField)
      const body = { name: 'After', [field]: ['keep', 'new', 'new', 'keep'] }

      const result = await assistantHandlers['/assistants/:id'].PATCH({ params: { id: assistant.id }, body })

      expect(result).toMatchObject({ name: 'After', [field]: ['keep', 'new'] })
      expect(assistantDataService.getById(assistant.id)).toMatchObject({ name: 'After', [field]: ['keep', 'new'] })
      expect(
        relationRows(field)
          .map((row) => row.id)
          .sort()
      ).toEqual(['keep', 'new'])
      expect(relationRows(field).find((row) => row.id === 'keep')).toEqual({
        id: 'keep',
        createdAt: 1000,
        updatedAt: 2000
      })
      expect(relationRows(otherField)).toEqual(otherBefore)
      expect(body[field]).toEqual(['keep', 'new', 'new', 'keep'])
    })

    it('returns unique IDs for repeated existing bindings without rewriting them', async () => {
      const assistant = assistantDataService.create({ name: 'Assistant', [field]: ['keep'] })
      const before = snapshot()
      const changes = dbh.sqlite.prepare('SELECT total_changes()').pluck().get()

      const result = await assistantHandlers['/assistants/:id'].PATCH({
        params: { id: assistant.id },
        body: { [field]: ['keep', 'keep'] }
      })

      expect(result).toMatchObject({ [field]: ['keep'] })
      expect(snapshot()).toEqual(before)
      expect(dbh.sqlite.prepare('SELECT total_changes()').pluck().get()).toBe(changes)
    })

    it('rolls creation back when a repeated list also contains a missing foreign key', async () => {
      await expect(
        assistantHandlers['/assistants'].POST({ body: { name: 'Invalid', [field]: ['keep', 'keep', 'missing'] } })
      ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })

      expect(snapshot()).toEqual({ assistants: [], mcp: [], knowledge: [] })
    })

    it('rolls all column and relation changes back when the other relation contains a missing foreign key', async () => {
      const assistant = assistantDataService.create({
        name: 'Before',
        mcpServerIds: ['old'],
        knowledgeBaseIds: ['old']
      })
      const before = snapshot()
      const otherField = field === 'mcpServerIds' ? 'knowledgeBaseIds' : 'mcpServerIds'

      await expect(
        assistantHandlers['/assistants/:id'].PATCH({
          params: { id: assistant.id },
          body: { name: 'After', [field]: ['new', 'new'], [otherField]: ['keep', 'missing'] }
        })
      ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })

      expect(snapshot()).toEqual(before)
    })
  })
})
