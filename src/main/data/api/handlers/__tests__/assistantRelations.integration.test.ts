import { setupTestDatabase } from '@test-helpers/db'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataApiCallContext } from '@data/api/core/callContext'
import { assistantHandlers } from '@data/api/handlers/assistants'
import { assistantTable } from '@data/db/schemas/assistant'
import { assistantKnowledgeBaseTable, assistantMcpServerTable } from '@data/db/schemas/assistantRelations'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { assistantDataService } from '@data/services/AssistantService'
import { mcpServerService } from '@data/services/McpServerService'
import { promptService } from '@data/services/PromptService'

type RelationField = 'mcpServerIds' | 'knowledgeBaseIds'

describe('Assistant relation writes with duplicate IDs', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    for (const id of ['old', 'keep', 'new']) {
      dbh.db.insert(mcpServerTable).values({ id, name: id }).run()
      dbh.db
        .insert(knowledgeBaseTable)
        .values({ id, name: id, orderKey: 'a0', status: 'completed', chunkSize: 1024, chunkOverlap: 200 })
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

describe('Committed MCP arming audit', () => {
  const dbh = setupTestDatabase()
  const context: DataApiCallContext = {
    requestId: 'request-24065',
    operationId: '24065000-0000-4000-8000-000000000001',
    source: 'assistant-edit.save',
    actor: { kind: 'renderer', webContentsId: 7, windowId: 'main-1' }
  }

  function seedAssistant() {
    const s = mcpServerService.create({ name: 'Server S' })
    const t = mcpServerService.create({ name: 'Server T' })
    const assistant = assistantDataService.create({ name: 'Assistant A', mcpServerIds: [t.id, s.id] })
    dbh.db.update(assistantMcpServerTable).set({ createdAt: 1000, updatedAt: 2000 }).run()
    mockMainLoggerService.info.mockClear()
    return { assistant, s, t }
  }

  function records() {
    return mockMainLoggerService.info.mock.calls
      .filter(([message]) => message === 'MCP arming changed')
      .map(([, payload]) => payload)
  }

  beforeEach(() => mockMainLoggerService.info.mockClear())

  it('attributes one committed creation record with sorted MCP additions', async () => {
    const a = mcpServerService.create({ name: 'Server A' })
    const b = mcpServerService.create({ name: 'Server B' })

    const result = await assistantHandlers['/assistants'].POST({
      body: { name: 'Created assistant', mcpServerIds: [b.id, a.id] },
      context
    })
    const assistant = 'data' in result ? result.data : result

    expect(assistantDataService.getById(assistant.id).mcpServerIds.sort()).toEqual([a.id, b.id].sort())
    expect(records()).toEqual([
      {
        event: 'assistant.mcp-arming.changed',
        assistantId: assistant.id,
        reason: 'create',
        beforeIds: [],
        afterIds: [a.id, b.id].sort(),
        addedIds: [a.id, b.id].sort(),
        removedIds: [],
        source: context.source,
        actor: context.actor,
        operationId: context.operationId,
        requestId: context.requestId
      }
    ])
  })

  it.each([undefined, []])('emits no creation record for MCP bindings %j', async (mcpServerIds) => {
    const result = await assistantHandlers['/assistants'].POST({
      body: { name: 'Unarmed assistant', mcpServerIds },
      context
    })

    expect(result).toMatchObject({ mcpServerIds: [] })
    expect(dbh.db.select().from(assistantMcpServerTable).all()).toEqual([])
    expect(records()).toEqual([])
  })

  it('emits one duplicate record for cloned MCP bindings without replaying the source record', async () => {
    const a = mcpServerService.create({ name: 'Server A' })
    const b = mcpServerService.create({ name: 'Server B' })
    const source = assistantDataService.create({ name: 'Source', mcpServerIds: [b.id, a.id] })
    expect(records()).toHaveLength(1)
    mockMainLoggerService.info.mockClear()

    const result = await assistantHandlers['/assistants/:id/duplicate'].POST({
      params: { id: source.id },
      body: { name: 'Duplicate' },
      context
    })
    const duplicate = 'data' in result ? result.data : result

    expect(assistantDataService.getById(duplicate.id).mcpServerIds.sort()).toEqual([a.id, b.id].sort())
    expect(records()).toEqual([
      {
        event: 'assistant.mcp-arming.changed',
        assistantId: duplicate.id,
        reason: 'duplicate',
        beforeIds: [],
        afterIds: [a.id, b.id].sort(),
        addedIds: [a.id, b.id].sort(),
        removedIds: [],
        source: context.source,
        actor: context.actor,
        operationId: context.operationId,
        requestId: context.requestId
      }
    ])
  })

  it('rolls duplicate and MCP bindings back without emitting a record when prompt cloning fails', async () => {
    const { assistant } = seedAssistant()
    const assistantsBefore = dbh.db.select().from(assistantTable).all()
    const bindingsBefore = dbh.db.select().from(assistantMcpServerTable).all()
    const cloneSpy = vi.spyOn(promptService, 'cloneBindingsForTargetTx').mockImplementationOnce(() => {
      throw new Error('Prompt cloning failed')
    })

    try {
      await expect(
        assistantHandlers['/assistants/:id/duplicate'].POST({
          params: { id: assistant.id },
          body: { name: 'Rolled back duplicate' },
          context
        })
      ).rejects.toThrow('Prompt cloning failed')

      expect(dbh.db.select().from(assistantTable).all()).toEqual(assistantsBefore)
      expect(dbh.db.select().from(assistantMcpServerTable).all()).toEqual(bindingsBefore)
      expect(records()).toEqual([])
    } finally {
      cloneSpy.mockRestore()
    }
  })

  it('rolls creation and MCP additions back on an invalid knowledge base without emitting a record', async () => {
    const server = mcpServerService.create({ name: 'Server' })

    await expect(
      assistantHandlers['/assistants'].POST({
        body: { name: 'Rolled back', mcpServerIds: [server.id], knowledgeBaseIds: ['missing'] },
        context
      })
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })

    expect(dbh.db.select().from(assistantTable).all()).toEqual([])
    expect(dbh.db.select().from(assistantMcpServerTable).all()).toEqual([])
    expect(records()).toEqual([])
  })

  it('attributes the committed removal, preserves retained timestamps and emits nothing for an identical replay', async () => {
    const { assistant, s, t } = seedAssistant()
    const retained = dbh.db
      .select()
      .from(assistantMcpServerTable)
      .all()
      .find((row) => row.mcpServerId === t.id)
    const input = { params: { id: assistant.id }, body: { mcpServerIds: [t.id] }, context }

    const result = await assistantHandlers['/assistants/:id'].PATCH(input)

    expect(result).toMatchObject({ id: assistant.id, mcpServerIds: [t.id] })
    expect(dbh.db.select().from(assistantMcpServerTable).all()).toEqual([retained])
    expect(records()).toEqual([
      {
        event: 'assistant.mcp-arming.changed',
        assistantId: assistant.id,
        reason: 'update',
        beforeIds: [s.id, t.id].sort(),
        afterIds: [t.id],
        addedIds: [],
        removedIds: [s.id],
        source: context.source,
        actor: context.actor,
        operationId: context.operationId,
        requestId: context.requestId
      }
    ])

    await expect(assistantHandlers['/assistants/:id'].PATCH(input)).resolves.toMatchObject({ mcpServerIds: [t.id] })
    expect(dbh.db.select().from(assistantMcpServerTable).all()).toEqual([retained])
    expect(records()).toHaveLength(1)
  })

  it('rolls back MCP removal with an invalid knowledge base and emits no committed record', async () => {
    const { assistant, t } = seedAssistant()
    const baseline = dbh.db.select().from(assistantMcpServerTable).all()

    await expect(
      assistantHandlers['/assistants/:id'].PATCH({
        params: { id: assistant.id },
        body: { name: 'Rolled back', mcpServerIds: [t.id], knowledgeBaseIds: ['missing'] },
        context
      })
    ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })

    expect(dbh.db.select().from(assistantMcpServerTable).all()).toEqual(baseline)
    expect(assistantDataService.getById(assistant.id).name).toBe('Assistant A')
    expect(records()).toEqual([])
  })

  it('accepts missing provenance and records an unknown caller', async () => {
    const { assistant, s, t } = seedAssistant()

    const result = await assistantHandlers['/assistants/:id'].PATCH({
      params: { id: assistant.id },
      body: { mcpServerIds: [] }
    })

    expect(result).toMatchObject({ mcpServerIds: [] })
    expect(dbh.db.select().from(assistantMcpServerTable).all()).toEqual([])
    expect(records()).toEqual([
      {
        event: 'assistant.mcp-arming.changed',
        assistantId: assistant.id,
        reason: 'update',
        beforeIds: [s.id, t.id].sort(),
        afterIds: [],
        addedIds: [],
        removedIds: [s.id, t.id].sort(),
        source: 'unknown',
        actor: { kind: 'unknown' },
        operationId: null,
        requestId: null
      }
    ])
  })
})
