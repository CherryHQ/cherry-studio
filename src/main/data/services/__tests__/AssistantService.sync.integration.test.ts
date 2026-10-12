import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { assistantDataService } from '@data/services/AssistantService'
import { groupService } from '@data/services/GroupService'
import { ASSISTANT_DATA_CHANGE_DIMENSIONS, ListAssistantsQuerySchema } from '@shared/data/api/schemas/assistants'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { IpcChannel } from '@shared/IpcChannel'

describe('assistant post-commit read-model notifications', () => {
  const dbh = setupTestDatabase()
  let effects: DataApiDataChangeEffect[]
  let observedNames: string[]

  beforeEach(() => {
    effects = []
    observedNames = []
    vi.mocked(application.get('WindowManager').broadcast).mockImplementation((channel, payload) => {
      if (channel !== IpcChannel.DataApi_DataChanged) return
      expect(dbh.sqlite.inTransaction).toBe(false)
      effects.push(...(payload as DataApiDataChangeEffect[]))
      observedNames = assistantDataService.list(ListAssistantsQuerySchema.parse({})).items.map((item) => item.name)
    })
  })

  function assertPublished(id: string, kind: 'membership' | 'projection') {
    expect(effects).toContainEqual({ endpoint: '/assistants', kind, entityIds: [id] })
    expect(effects).toContainEqual({ endpoint: '/assistants/:id', entityIds: [id] })
  }

  function assertFacet(id: string, kind: 'membership' | 'order', dimension: string) {
    expect(effects).toContainEqual({ endpoint: '/assistants', kind, dimension, entityIds: [id] })
    const canonical = ASSISTANT_DATA_CHANGE_DIMENSIONS[kind]
    expect(Object.values(canonical)).toContain(dimension)
    if (kind === 'membership') expect(Object.keys(ListAssistantsQuerySchema.shape)).toContain(dimension)
    else expect(ListAssistantsQuerySchema.shape.sortBy.unwrap().options).toContain(dimension)
  }

  it.each(['create', 'duplicate', 'import'] as const)('publishes committed membership after %s', (operation) => {
    const source = assistantDataService.create({ name: 'Source', modelId: null })
    effects = []
    const created =
      operation === 'create'
        ? assistantDataService.create({ name: 'Added', modelId: null })
        : operation === 'duplicate'
          ? assistantDataService.duplicate(source.id, { name: 'Added' })
          : assistantDataService.createFromImport({
              name: 'Added',
              regularPhrases: [{ title: 'Phrase', content: 'Text' }]
            })
    assertPublished(created.id, 'membership')
    expect(observedNames).toContain('Added')
  })

  it('publishes committed projection after editing', () => {
    const source = assistantDataService.create({ name: 'Source', modelId: null })
    effects = []
    assistantDataService.update(source.id, { name: 'Renamed', settings: { temperature: 0.3 } })
    assertPublished(source.id, 'projection')
    assertFacet(source.id, 'membership', 'search')
    assertFacet(source.id, 'order', 'name')
    assertFacet(source.id, 'order', 'updatedAt')
    assertFacet(source.id, 'membership', 'updatedAtFrom')
    expect(observedNames).toContain('Renamed')
    expect(assistantDataService.getById(source.id).settings.temperature).toBe(0.3)
  })

  it.each(['mcpServerIds', 'knowledgeBaseIds'] as const)(
    'updates aggregate freshness and query facets after %s writes',
    (field) => {
      const clock = vi.spyOn(Date, 'now').mockReturnValue(5000)
      try {
        const source = assistantDataService.create({ name: 'Source', modelId: null })
        const other = assistantDataService.create({ name: 'Other', modelId: null })
        const id = '10000000-0000-4000-8000-000000000001'
        if (field === 'mcpServerIds') dbh.db.insert(mcpServerTable).values({ id, name: 'MCP' }).run()
        else
          dbh.db
            .insert(knowledgeBaseTable)
            .values({ id, name: 'Knowledge', status: 'completed', chunkSize: 1024, chunkOverlap: 200 })
            .run()
        clock.mockReturnValue(5010)
        assistantDataService.update(source.id, { description: 'Remote' })
        clock.mockReturnValue(5017)
        assistantDataService.update(other.id, { description: 'Other' })
        effects = []
        const query = ListAssistantsQuerySchema.parse({ updatedAtFrom: new Date(5015).toISOString() })
        expect(assistantDataService.list(query).items.map((item) => item.id)).toEqual([other.id])
        clock.mockReturnValue(5020)
        const result = assistantDataService.update(source.id, { [field]: [id] })
        expect(result.updatedAt).toBe(new Date(5020).toISOString())
        expect(assistantDataService.getById(source.id)[field]).toEqual([id])
        expect(
          assistantDataService
            .list(query)
            .items.map((item) => item.id)
            .sort()
        ).toEqual([source.id, other.id].sort())
        const sorted = assistantDataService.list(
          ListAssistantsQuerySchema.parse({ sortBy: 'updatedAt', sortOrder: 'desc' })
        )
        expect(sorted.items[0]?.id).toBe(source.id)
        assertFacet(source.id, 'membership', 'updatedAtFrom')
        assertFacet(source.id, 'order', 'updatedAt')
        effects = []
        clock.mockReturnValue(5030)
        expect(() => assistantDataService.update(source.id, { [field]: ['missing'] })).toThrow()
        expect(assistantDataService.getById(source.id).updatedAt).toBe(result.updatedAt)
        expect(assistantDataService.getById(source.id)[field]).toEqual([id])
        expect(effects).toEqual([])
      } finally {
        clock.mockRestore()
      }
    }
  )

  it.each(['mcpServerIds', 'knowledgeBaseIds'] as const)(
    'keeps %s no-ops read-only without changing freshness or publishing',
    (field) => {
      const source = assistantDataService.create({ name: 'Source', modelId: null })
      effects = []
      const emptyChanges = dbh.sqlite.prepare('SELECT total_changes()').pluck().get()
      expect(assistantDataService.update(source.id, { [field]: [] })).toEqual(source)
      expect(dbh.sqlite.prepare('SELECT total_changes()').pluck().get()).toBe(emptyChanges)
      expect(effects).toEqual([])
      const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002']
      for (const id of ids) {
        if (field === 'mcpServerIds') dbh.db.insert(mcpServerTable).values({ id, name: id }).run()
        else
          dbh.db
            .insert(knowledgeBaseTable)
            .values({ id, name: id, status: 'completed', chunkSize: 1024, chunkOverlap: 200 })
            .run()
      }
      const bound = assistantDataService.update(source.id, { [field]: ids })
      effects = []
      const changes = dbh.sqlite.prepare('SELECT total_changes()').pluck().get()
      const result = assistantDataService.update(source.id, { [field]: [ids[1], ids[0], ids[1]] })
      expect(result).toEqual(bound)
      expect(assistantDataService.getById(source.id)).toEqual(bound)
      expect(dbh.sqlite.prepare('SELECT total_changes()').pluck().get()).toBe(changes)
      expect(effects).toEqual([])
    }
  )

  it('publishes group membership without claiming a name-order change', () => {
    const group = groupService.create({ entityType: 'assistant', name: 'Destination' })
    const source = assistantDataService.create({ name: 'Source', modelId: null })
    const query = ListAssistantsQuerySchema.parse({ groupId: group.id })
    expect(assistantDataService.list(query).items).toEqual([])
    effects = []

    assistantDataService.update(source.id, { groupId: group.id })

    assertFacet(source.id, 'membership', 'groupId')
    assertFacet(source.id, 'order', 'updatedAt')
    expect(effects.some((effect) => effect.kind === 'order' && effect.dimension === 'name')).toBe(false)
    expect(assistantDataService.list(query).items.map((item) => item.id)).toEqual([source.id])
  })

  it('publishes search membership for a description edit and no unrelated group or name facets', () => {
    const source = assistantDataService.create({ name: 'Source', modelId: null })
    const query = ListAssistantsQuerySchema.parse({ search: 'keyword' })
    expect(assistantDataService.list(query).items).toEqual([])
    effects = []

    assistantDataService.update(source.id, { description: 'keyword' })

    assertFacet(source.id, 'membership', 'search')
    expect(effects.some((effect) => effect.dimension === 'name' || effect.dimension === 'groupId')).toBe(false)
    expect(assistantDataService.list(query).items.map((item) => item.id)).toEqual([source.id])
  })

  it.each(['single', 'batch'] as const)('publishes committed order after %s reorder', (operation) => {
    const first = assistantDataService.create({ name: 'First', modelId: null })
    const second = assistantDataService.create({ name: 'Second', modelId: null })
    effects = []
    if (operation === 'single') assistantDataService.reorder(second.id, { position: 'first' })
    else assistantDataService.reorderBatch([{ id: second.id, anchor: { before: first.id } }])
    assertPublished(second.id, 'projection')
    assertFacet(second.id, 'order', 'orderKey')
    assertFacet(second.id, 'order', 'updatedAt')
    assertFacet(second.id, 'membership', 'updatedAtFrom')
    expect(observedNames).toEqual(['Second', 'First'])
  })

  it('does not publish unsuccessful or empty writes', () => {
    const source = assistantDataService.create({ name: 'Source', modelId: null })
    effects = []
    assistantDataService.update(source.id, {})
    assistantDataService.reorderBatch([])
    expect(() => assistantDataService.update(source.id, { name: 'Wrong', mcpServerIds: ['missing'] })).toThrow()
    expect(() => assistantDataService.create({ name: 'Wrong', mcpServerIds: ['missing'] })).toThrow()
    expect(() => assistantDataService.reorderBatch([{ id: source.id, anchor: { before: 'missing' } }])).toThrow()
    expect(effects).toEqual([])
    expect(assistantDataService.list(ListAssistantsQuerySchema.parse({})).items.map((item) => item.name)).toEqual([
      'Source'
    ])
  })
})
