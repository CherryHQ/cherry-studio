import '@data/services/AgentSessionMessageService'
import '@data/services/MessageService'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import { ErrorCode } from '@shared/data/api/errors'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

const ACTIVE_MESSAGE = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d201'
const OTHER_MESSAGE = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d202'
const ARCHIVED_MESSAGE = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d203'

describe('pinned active permanent deletion', () => {
  const dbh = setupTestDatabase()

  function seedConversations(): void {
    dbh.db
      .insert(assistantTable)
      .values({
        id: 'assistant',
        name: 'Assistant',
        emoji: '',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(topicTable)
      .values([
        { id: 'active-topic', assistantId: 'assistant', name: 'Active topic', orderKey: 'a0' },
        { id: 'other-topic', assistantId: 'assistant', name: 'Other topic', orderKey: 'a1' },
        { id: 'archived-topic', assistantId: 'assistant', name: 'Archived topic', orderKey: 'a2', deletedAt: 123 },
        { id: 'unrelated-topic', name: 'Unrelated topic', orderKey: 'a3' }
      ])
      .run()
    dbh.db
      .insert(messageTable)
      .values([
        ...withRoot('active-topic', [
          {
            id: 'user-active-topic',
            topicId: 'active-topic',
            role: 'user',
            data: { parts: [{ type: 'text', text: 'active topic body' }] },
            status: 'success'
          }
        ]),
        ...withRoot('other-topic', [
          {
            id: 'user-other-topic',
            topicId: 'other-topic',
            role: 'user',
            data: { parts: [{ type: 'text', text: 'other topic body' }] },
            status: 'success'
          }
        ]),
        ...withRoot('archived-topic', [
          {
            id: 'user-archived-topic',
            topicId: 'archived-topic',
            role: 'user',
            data: { parts: [{ type: 'text', text: 'archived topic body' }] },
            status: 'success'
          }
        ]),
        ...withRoot('unrelated-topic', [])
      ])
      .run()

    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent',
        type: 'claude-code',
        name: 'Agent',
        instructions: '',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({
        id: 'workspace',
        type: 'user',
        name: 'Workspace',
        path: '/tmp/pinned-active-deletion',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values([
        { id: 'active-session', agentId: 'agent', workspaceId: 'workspace', name: 'Active session', orderKey: 'a0' },
        { id: 'other-session', agentId: 'agent', workspaceId: 'workspace', name: 'Other session', orderKey: 'a1' },
        {
          id: 'archived-session',
          agentId: 'agent',
          workspaceId: 'workspace',
          name: 'Archived session',
          orderKey: 'a2',
          deletedAt: 123
        },
        { id: 'unrelated-session', workspaceId: 'workspace', name: 'Unrelated session', orderKey: 'a3' }
      ])
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values([
        {
          id: ACTIVE_MESSAGE,
          sessionId: 'active-session',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'active session body' }] },
          status: 'success'
        },
        {
          id: OTHER_MESSAGE,
          sessionId: 'other-session',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'other session body' }] },
          status: 'success'
        },
        {
          id: ARCHIVED_MESSAGE,
          sessionId: 'archived-session',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'archived session body' }] },
          status: 'success'
        }
      ])
      .run()
  }

  function pin(entityType: 'topic' | 'session', entityId: string): void {
    dbh.db
      .insert(pinTable)
      .values({ entityType, entityId, orderKey: `pin-${entityId}` })
      .run()
  }

  function topicIds(): string[] {
    return dbh.db
      .select({ id: topicTable.id })
      .from(topicTable)
      .all()
      .map((row) => row.id)
      .sort()
  }

  function sessionIds(): string[] {
    return dbh.db
      .select({ id: agentSessionTable.id })
      .from(agentSessionTable)
      .all()
      .map((row) => row.id)
      .sort()
  }

  function messageText(topicId: string): string | undefined {
    const row = dbh.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.id, `user-${topicId}`))
      .get()
    const text = row?.data.parts?.[0]
    return text && 'text' in text ? text.text : undefined
  }

  it('rejects a topic pinned after selection and leaves the topic, message, and pin', () => {
    seedConversations()
    expect(topicService.getById('active-topic').id).toBe('active-topic')
    pin('topic', 'active-topic')

    expect(() => topicService.deleteByIds(['active-topic'], { permanent: true, targetState: 'active' })).toThrow(
      expect.objectContaining({
        code: ErrorCode.INVALID_OPERATION,
        details: { operation: 'delete pinned topic', reason: 'active-topic' }
      })
    )

    expect(topicIds()).toEqual(['active-topic', 'archived-topic', 'other-topic', 'unrelated-topic'])
    expect(messageText('active-topic')).toBe('active topic body')
    expect(dbh.db.select({ entityId: pinTable.entityId }).from(pinTable).all()).toEqual([{ entityId: 'active-topic' }])
  })

  it('rejects a mixed active topic batch without deleting the unpinned topic', () => {
    seedConversations()
    pin('topic', 'active-topic')

    expect(() =>
      topicService.deleteByIds(['other-topic', 'active-topic'], { permanent: true, targetState: 'active' })
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.INVALID_OPERATION,
        details: { operation: 'delete pinned topic', reason: 'active-topic' }
      })
    )

    expect(messageText('active-topic')).toBe('active topic body')
    expect(messageText('other-topic')).toBe('other topic body')
    expect(dbh.db.select().from(pinTable).all()).toHaveLength(1)
  })

  it('permanently deletes an unpinned active topic and its messages', () => {
    seedConversations()
    pin('session', 'active-topic')

    expect(topicService.deleteByIds(['active-topic'], { permanent: true, targetState: 'active' })).toEqual({
      deletedIds: ['active-topic'],
      deletedCount: 1
    })

    expect(topicIds()).toEqual(['archived-topic', 'other-topic', 'unrelated-topic'])
    expect(dbh.db.select().from(messageTable).where(eq(messageTable.topicId, 'active-topic')).all()).toEqual([])
    expect(messageText('other-topic')).toBe('other topic body')
    expect(dbh.db.select({ entityId: pinTable.entityId }).from(pinTable).all()).toEqual([{ entityId: 'active-topic' }])
  })

  it('keeps NOT_FOUND when an active topic batch includes a missing or archived id', () => {
    seedConversations()
    pin('topic', 'active-topic')
    pin('topic', 'archived-topic')
    pin('topic', 'missing-topic')

    expect(() =>
      topicService.deleteByIds(['active-topic', 'missing-topic'], { permanent: true, targetState: 'active' })
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.NOT_FOUND, details: { resource: 'Topic', id: 'missing-topic' } })
    )
    expect(() =>
      topicService.deleteByIds(['other-topic', 'archived-topic'], { permanent: true, targetState: 'active' })
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.NOT_FOUND, details: { resource: 'Topic', id: 'archived-topic' } })
    )

    expect(topicIds()).toEqual(['active-topic', 'archived-topic', 'other-topic', 'unrelated-topic'])
    expect(messageText('other-topic')).toBe('other topic body')
    expect(
      dbh.db
        .select({ entityId: pinTable.entityId })
        .from(pinTable)
        .all()
        .map((row) => row.entityId)
        .sort()
    ).toEqual(['active-topic', 'archived-topic', 'missing-topic'])
  })

  it('purges a pinned topic that is already in the recycle bin', () => {
    seedConversations()
    pin('topic', 'archived-topic')
    pin('topic', 'active-topic')

    expect(topicService.deleteByIds(['archived-topic'], { permanent: true, targetState: 'trashed' })).toEqual({
      deletedIds: ['archived-topic'],
      deletedCount: 1
    })

    expect(topicService.getById('active-topic').deletedAt).toBeUndefined()
    expect(messageText('active-topic')).toBe('active topic body')
    expect(dbh.db.select().from(messageTable).where(eq(messageTable.topicId, 'archived-topic')).all()).toEqual([])
    expect(dbh.db.select({ entityId: pinTable.entityId }).from(pinTable).all()).toEqual([{ entityId: 'active-topic' }])
  })

  it('deletes pinned active and archived topics when assistant deletion explicitly deletes children', () => {
    seedConversations()
    pin('topic', 'active-topic')
    pin('topic', 'archived-topic')

    const result = assistantDataService.delete('assistant', {
      permanent: true,
      targetState: 'active',
      deleteTopics: true
    })

    expect(result.deleted).toBe(true)
    expect(result.deletedTopicIds?.sort()).toEqual(['active-topic', 'archived-topic', 'other-topic'])
    expect(topicIds()).toEqual(['unrelated-topic'])
    expect(dbh.db.select().from(assistantTable).all()).toEqual([])
    expect(dbh.db.select().from(pinTable).all()).toEqual([])
  })

  it('rejects a session pinned after selection and leaves the session, message, and pin', () => {
    seedConversations()
    expect(agentSessionService.getById('active-session').id).toBe('active-session')
    pin('session', 'active-session')

    expect(() =>
      agentSessionService.deleteByIdsWithImpact(['active-session'], { permanent: true, targetState: 'active' })
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.INVALID_OPERATION,
        details: { operation: 'delete pinned session', reason: 'active-session' }
      })
    )

    expect(sessionIds()).toEqual(['active-session', 'archived-session', 'other-session', 'unrelated-session'])
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, ACTIVE_MESSAGE)).get()?.data
    ).toMatchObject({ parts: [{ type: 'text', text: 'active session body' }] })
    expect(dbh.db.select({ entityId: pinTable.entityId }).from(pinTable).all()).toEqual([
      { entityId: 'active-session' }
    ])
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
  })

  it('rejects a mixed active session batch without deleting the unpinned session', () => {
    seedConversations()
    pin('session', 'active-session')

    expect(() =>
      agentSessionService.deleteByIdsWithImpact(['other-session', 'active-session'], {
        permanent: true,
        targetState: 'active'
      })
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.INVALID_OPERATION,
        details: { operation: 'delete pinned session', reason: 'active-session' }
      })
    )

    expect(sessionIds()).toHaveLength(4)
    expect(
      dbh.db
        .select()
        .from(agentSessionMessageTable)
        .where(eq(agentSessionMessageTable.sessionId, 'other-session'))
        .get()?.id
    ).toBe(OTHER_MESSAGE)
  })

  it('permanently deletes an unpinned active session and ignores a pin on a non-active id', () => {
    seedConversations()
    pin('session', 'archived-session')
    pin('session', 'missing-session')
    pin('topic', 'active-session')

    expect(
      agentSessionService.deleteByIdsWithImpact(['active-session', 'missing-session', 'archived-session'], {
        permanent: true,
        targetState: 'active'
      }).deletedIds
    ).toEqual(['active-session'])

    expect(sessionIds()).toEqual(['archived-session', 'other-session', 'unrelated-session'])
    expect(
      dbh.db
        .select()
        .from(agentSessionMessageTable)
        .where(eq(agentSessionMessageTable.sessionId, 'active-session'))
        .all()
    ).toEqual([])
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, ARCHIVED_MESSAGE)).get()
        ?.data
    ).toMatchObject({ parts: [{ type: 'text', text: 'archived session body' }] })
    expect(
      dbh.db
        .select({ entityId: pinTable.entityId })
        .from(pinTable)
        .all()
        .map((row) => row.entityId)
        .sort()
    ).toEqual(['active-session', 'archived-session', 'missing-session'])
  })

  it('purges a pinned session that is already in the recycle bin', () => {
    seedConversations()
    pin('session', 'archived-session')
    pin('session', 'active-session')

    expect(
      agentSessionService.deleteByIdsWithImpact(['archived-session', 'active-session'], { permanent: true }).deletedIds
    ).toEqual(['archived-session'])

    expect(agentSessionService.getById('active-session').deletedAt).toBeUndefined()
    expect(
      dbh.db
        .select()
        .from(agentSessionMessageTable)
        .where(eq(agentSessionMessageTable.sessionId, 'archived-session'))
        .all()
    ).toEqual([])
    expect(dbh.db.select({ entityId: pinTable.entityId }).from(pinTable).all()).toEqual([
      { entityId: 'active-session' }
    ])
  })

  it('deletes pinned active and archived sessions when agent deletion explicitly deletes children', () => {
    seedConversations()
    pin('session', 'active-session')
    pin('session', 'archived-session')
    pin('session', 'other-session')

    const impact = application.get('DbService').withWriteTx((tx) =>
      agentService.deleteAgentStateTx(tx, 'agent', {
        deleteSessions: true,
        permanent: true,
        targetState: 'active'
      })
    )

    expect(impact.deleted).toBe(true)
    expect(impact.deletedSessionIds?.sort()).toEqual(['active-session', 'archived-session', 'other-session'])
    expect(sessionIds()).toEqual(['unrelated-session'])
    expect(dbh.db.select().from(agentTable).all()).toEqual([])
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])
    expect(dbh.db.select().from(pinTable).all()).toEqual([])
    expect(dbh.db.select().from(agentWorkspaceTable).all()).toHaveLength(1)
  })
})
