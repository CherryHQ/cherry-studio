import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { groupTable } from '@data/db/schemas/group'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { GroupService, groupService } from '@data/services/GroupService'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { DEFAULT_KNOWLEDGE_BASE_STATUS } from '@shared/data/types/knowledge'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

const GROUP_ID_MISSING = '11111111-1111-4111-8111-111111111111'

describe('GroupService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    notifyDataApiDataChangeMock.mockClear()
  })

  it('should export a module-level singleton of GroupService', () => {
    expect(groupService).toBeInstanceOf(GroupService)
  })

  describe('create', () => {
    it('should create a group with an auto-assigned orderKey', async () => {
      const result = groupService.create({ entityType: 'topic', name: 'Research' })

      expect(result).toMatchObject({ entityType: 'topic', name: 'Research' })
      expect(typeof result.orderKey).toBe('string')
      expect(result.orderKey.length).toBeGreaterThan(0)

      const [row] = await dbh.db.select().from(groupTable).where(eq(groupTable.id, result.id))
      expect(row).toMatchObject({ name: 'Research', entityType: 'topic', orderKey: result.orderKey })
    })

    it('should assign strictly increasing orderKeys within the same entityType', async () => {
      const first = groupService.create({ entityType: 'topic', name: 'alpha' })
      const second = groupService.create({ entityType: 'topic', name: 'beta' })
      const third = groupService.create({ entityType: 'topic', name: 'gamma' })

      expect(second.orderKey > first.orderKey).toBe(true)
      expect(third.orderKey > second.orderKey).toBe(true)
    })

    it('should keep orderKey sequences independent across entityTypes', async () => {
      const topicFirst = groupService.create({ entityType: 'topic', name: 'first-topic' })
      const assistantFirst = groupService.create({ entityType: 'assistant', name: 'first-assistant' })

      // Each entityType starts with the same fractional-indexing starter key
      // because neither bucket has a predecessor.
      expect(topicFirst.orderKey).toBe(assistantFirst.orderKey)
    })

    it('should create knowledge groups', async () => {
      const result = groupService.create({ entityType: 'knowledge', name: 'Knowledge Group' })

      expect(result).toMatchObject({ entityType: 'knowledge', name: 'Knowledge Group' })
    })

    it('broadcasts the new group to every window', () => {
      const group = groupService.create({ entityType: 'agent', name: 'Announced' })

      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/groups', kind: 'membership', entityIds: [group.id] },
        { endpoint: '/groups/:id', routeParams: { id: group.id }, entityIds: [group.id] }
      ])
    })
  })

  describe('listByEntityType', () => {
    it('should return groups ordered by orderKey, scoped to the requested entityType', async () => {
      const topicA = groupService.create({ entityType: 'topic', name: 'A' })
      const topicB = groupService.create({ entityType: 'topic', name: 'B' })
      groupService.create({ entityType: 'assistant', name: 'assistant-only' })

      const topics = groupService.listByEntityType('topic')
      expect(topics.map((g) => g.id)).toEqual([topicA.id, topicB.id])
    })

    it('should return an empty array when no groups exist for the entityType', () => {
      expect(groupService.listByEntityType('assistant')).toEqual([])
    })

    it('should list groups for the knowledge entityType', () => {
      const knowledgeGroup = groupService.create({ entityType: 'knowledge', name: 'Knowledge Group' })
      groupService.create({ entityType: 'topic', name: 'Topic Group' })

      expect(groupService.listByEntityType('knowledge')).toEqual([knowledgeGroup])
    })
  })

  describe('getById', () => {
    it('should throw NOT_FOUND when the group does not exist', () => {
      let err: unknown
      try {
        groupService.getById(GROUP_ID_MISSING)
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(DataApiError)
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('findByIdTx', () => {
    it('should return a group through a caller transaction', async () => {
      const created = groupService.create({ entityType: 'knowledge', name: 'Knowledge Group' })

      const result = dbh.db.transaction((tx) => groupService.findByIdTx(tx, created.id))

      expect(result).toEqual(created)
    })

    it('should return null when the group does not exist', () => {
      expect(groupService.findByIdTx(dbh.db, GROUP_ID_MISSING)).toBeNull()
    })
  })

  describe('findOrCreateByNameTx', () => {
    it('creates a missing group inside the caller transaction', () => {
      const result = dbh.db.transaction((tx) => groupService.findOrCreateByNameTx(tx, 'assistant', 'work'))

      expect(result).toMatchObject({ entityType: 'assistant', name: 'work' })
      expect(groupService.listByEntityType('assistant')).toEqual([result])
    })

    it('reuses the first exact-name group in display order when duplicates already exist', () => {
      const first = groupService.create({ entityType: 'assistant', name: 'work' })
      groupService.create({ entityType: 'assistant', name: 'work' })
      groupService.create({ entityType: 'topic', name: 'work' })

      const result = dbh.db.transaction((tx) => groupService.findOrCreateByNameTx(tx, 'assistant', 'work'))

      expect(result.id).toBe(first.id)
      expect(groupService.listByEntityType('assistant')).toHaveLength(2)
    })
  })

  describe('update', () => {
    it('should update the name of an existing group', async () => {
      const created = groupService.create({ entityType: 'topic', name: 'Old' })

      const updated = groupService.update(created.id, { name: 'New' })

      expect(updated).toMatchObject({ id: created.id, name: 'New', entityType: 'topic' })
    })

    it('should return the current row for an empty update payload', async () => {
      const created = groupService.create({ entityType: 'topic', name: 'Unchanged' })

      const result = groupService.update(created.id, {})

      expect(result).toMatchObject({ id: created.id, name: 'Unchanged' })
    })

    it('should throw NOT_FOUND when the group does not exist', () => {
      let err: unknown
      try {
        groupService.update(GROUP_ID_MISSING, { name: 'x' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('broadcasts the rename to every window and skips no-op payloads', () => {
      const created = groupService.create({ entityType: 'topic', name: 'Before' })
      notifyDataApiDataChangeMock.mockClear()

      groupService.update(created.id, { name: 'After' })

      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/groups', kind: 'projection', entityIds: [created.id] },
        { endpoint: '/groups/:id', routeParams: { id: created.id }, entityIds: [created.id] }
      ])

      notifyDataApiDataChangeMock.mockClear()
      groupService.update(created.id, {})

      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    })
  })

  describe('reorder', () => {
    it("should move a group to the first position via { position: 'first' }", async () => {
      const a = groupService.create({ entityType: 'topic', name: 'A' })
      const b = groupService.create({ entityType: 'topic', name: 'B' })
      const c = groupService.create({ entityType: 'topic', name: 'C' })

      groupService.reorder(c.id, { position: 'first' })

      const ids = groupService.listByEntityType('topic').map((g) => g.id)
      expect(ids).toEqual([c.id, a.id, b.id])
    })

    it('broadcasts order effects after moves', () => {
      const a = groupService.create({ entityType: 'topic', name: 'A' })
      const b = groupService.create({ entityType: 'topic', name: 'B' })
      notifyDataApiDataChangeMock.mockClear()

      groupService.reorder(a.id, { after: b.id })

      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/groups', kind: 'order', dimension: 'orderKey', entityIds: [a.id] }
      ])

      notifyDataApiDataChangeMock.mockClear()
      groupService.reorderBatch([
        { id: b.id, anchor: { position: 'first' } },
        { id: a.id, anchor: { position: 'first' } }
      ])

      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/groups', kind: 'order', dimension: 'orderKey', entityIds: [b.id, a.id] }
      ])
    })

    it('should move a group to before an anchor', async () => {
      const a = groupService.create({ entityType: 'topic', name: 'A' })
      const b = groupService.create({ entityType: 'topic', name: 'B' })
      const c = groupService.create({ entityType: 'topic', name: 'C' })

      groupService.reorder(c.id, { before: b.id })

      const ids = groupService.listByEntityType('topic').map((g) => g.id)
      expect(ids).toEqual([a.id, c.id, b.id])
    })

    it('should move a group to after an anchor', async () => {
      const a = groupService.create({ entityType: 'topic', name: 'A' })
      const b = groupService.create({ entityType: 'topic', name: 'B' })
      const c = groupService.create({ entityType: 'topic', name: 'C' })

      groupService.reorder(a.id, { after: b.id })

      const ids = groupService.listByEntityType('topic').map((g) => g.id)
      expect(ids).toEqual([b.id, a.id, c.id])
    })

    it("should move a group to the last position via { position: 'last' }", async () => {
      const a = groupService.create({ entityType: 'topic', name: 'A' })
      const b = groupService.create({ entityType: 'topic', name: 'B' })
      const c = groupService.create({ entityType: 'topic', name: 'C' })

      groupService.reorder(a.id, { position: 'last' })

      const ids = groupService.listByEntityType('topic').map((g) => g.id)
      expect(ids).toEqual([b.id, c.id, a.id])
    })

    it('should throw NOT_FOUND when the target id does not exist', () => {
      let err: unknown
      try {
        groupService.reorder(GROUP_ID_MISSING, { position: 'first' })
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('reorderBatch', () => {
    it('should apply multi-move atomically within one entityType', async () => {
      const a = groupService.create({ entityType: 'topic', name: 'A' })
      const b = groupService.create({ entityType: 'topic', name: 'B' })
      const c = groupService.create({ entityType: 'topic', name: 'C' })
      const d = groupService.create({ entityType: 'topic', name: 'D' })

      groupService.reorderBatch([
        { id: d.id, anchor: { position: 'first' } },
        { id: a.id, anchor: { position: 'last' } }
      ])

      const ids = groupService.listByEntityType('topic').map((g) => g.id)
      expect(ids).toEqual([d.id, b.id, c.id, a.id])
    })

    it('should reject a batch spanning multiple entityTypes with VALIDATION_ERROR', () => {
      const topic = groupService.create({ entityType: 'topic', name: 'topic-group' })
      const assistant = groupService.create({ entityType: 'assistant', name: 'assistant-group' })

      let err: unknown
      try {
        groupService.reorderBatch([
          { id: topic.id, anchor: { position: 'first' } },
          { id: assistant.id, anchor: { position: 'first' } }
        ])
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
    })

    it('should throw NOT_FOUND when any move id is unknown', () => {
      const a = groupService.create({ entityType: 'topic', name: 'A' })

      let err: unknown
      try {
        groupService.reorderBatch([
          { id: a.id, anchor: { position: 'last' } },
          { id: GROUP_ID_MISSING, anchor: { position: 'first' } }
        ])
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })
  })

  describe('delete', () => {
    it('should clear the groupId of referenced assistants', async () => {
      const group = groupService.create({ entityType: 'assistant', name: 'Assistant Group' })
      await dbh.db.insert(assistantTable).values({
        id: 'assistant-1',
        name: 'Assistant',
        emoji: '🌟',
        groupId: group.id,
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      })

      groupService.delete(group.id)

      const [assistant] = await dbh.db
        .select({ groupId: assistantTable.groupId })
        .from(assistantTable)
        .where(eq(assistantTable.id, 'assistant-1'))
      expect(assistant.groupId).toBeNull()
    })

    it('should not change orderKeys of sibling groups after a deletion', async () => {
      const a = groupService.create({ entityType: 'topic', name: 'A' })
      const b = groupService.create({ entityType: 'topic', name: 'B' })
      const c = groupService.create({ entityType: 'topic', name: 'C' })

      groupService.delete(b.id)

      const remaining = groupService.listByEntityType('topic')
      expect(remaining.map((g) => g.id)).toEqual([a.id, c.id])
      expect(remaining[0].orderKey).toBe(a.orderKey)
      expect(remaining[1].orderKey).toBe(c.orderKey)
    })

    it('should throw NOT_FOUND when the group does not exist', () => {
      let err: unknown
      try {
        groupService.delete(GROUP_ID_MISSING)
      } catch (e) {
        err = e
      }
      expect(err).toMatchObject({ code: ErrorCode.NOT_FOUND })
    })

    it('broadcasts the removal to every window without a member unbind entry', () => {
      const group = groupService.create({ entityType: 'topic', name: 'Broadcast' })
      notifyDataApiDataChangeMock.mockClear()

      groupService.delete(group.id)

      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/groups', kind: 'membership', entityIds: [group.id] },
        { endpoint: '/groups/:id', routeParams: { id: group.id }, entityIds: [group.id] }
      ])
    })

    it('broadcasts the agent unbind when an agent group is deleted', async () => {
      const group = groupService.create({ entityType: 'agent', name: 'Agent Broadcast' })
      await dbh.db.insert(agentTable).values({
        id: 'agent-broadcast-1',
        type: 'claude-code',
        name: 'Bound Agent',
        instructions: '',
        groupId: group.id,
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })
      notifyDataApiDataChangeMock.mockClear()

      groupService.delete(group.id)

      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/groups', kind: 'membership', entityIds: [group.id] },
        { endpoint: '/groups/:id', routeParams: { id: group.id }, entityIds: [group.id] },
        { endpoint: '/agents', kind: 'membership', entityIds: ['agent-broadcast-1'] }
      ])
    })

    it('broadcasts the assistant unbind when an assistant group is deleted', async () => {
      const group = groupService.create({ entityType: 'assistant', name: 'Assistant Broadcast' })
      await dbh.db.insert(assistantTable).values({
        id: 'assistant-broadcast-1',
        name: 'Assistant',
        emoji: '🌟',
        groupId: group.id,
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      })
      notifyDataApiDataChangeMock.mockClear()

      groupService.delete(group.id)

      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/groups', kind: 'membership', entityIds: [group.id] },
        { endpoint: '/groups/:id', routeParams: { id: group.id }, entityIds: [group.id] },
        { endpoint: '/assistants', kind: 'membership', entityIds: ['assistant-broadcast-1'] }
      ])
    })

    it('broadcasts the knowledge unbind when a knowledge group is deleted', async () => {
      const group = groupService.create({ entityType: 'knowledge', name: 'Knowledge Broadcast' })
      await dbh.db.insert(knowledgeBaseTable).values({
        id: 'kb-broadcast-1',
        name: 'Knowledge Base',
        groupId: group.id,
        status: DEFAULT_KNOWLEDGE_BASE_STATUS,
        chunkSize: 512,
        chunkOverlap: 64
      })
      notifyDataApiDataChangeMock.mockClear()

      groupService.delete(group.id)

      expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
        { endpoint: '/groups', kind: 'membership', entityIds: [group.id] },
        { endpoint: '/groups/:id', routeParams: { id: group.id }, entityIds: [group.id] },
        { endpoint: '/knowledge-bases', kind: 'membership', entityIds: ['kb-broadcast-1'] }
      ])
    })

    it('unbinds member agents at the FK level when the group row is deleted', async () => {
      // The group_id FK carries ON DELETE SET NULL, so the unbind is the
      // database's job — no group-side UPDATE may stand in for it.
      const group = groupService.create({ entityType: 'agent', name: 'FK Group' })
      await dbh.db.insert(agentTable).values({
        id: 'agent-fk-1',
        type: 'claude-code',
        name: 'Bound Agent',
        instructions: '',
        groupId: group.id,
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      })

      groupService.delete(group.id)

      const [agent] = await dbh.db
        .select({ groupId: agentTable.groupId })
        .from(agentTable)
        .where(eq(agentTable.id, 'agent-fk-1'))
      expect(agent.groupId).toBeNull()
    })
  })
})
