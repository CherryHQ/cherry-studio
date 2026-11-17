import { rootRow, setupTestDatabase } from '@test-helpers/db'
import { defaultServiceInstances } from '@test-mocks/main/application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { messageService } from '@data/services/MessageService'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { createUniqueModelId } from '@shared/data/types/model'

import { toModelMessages } from '../../../messages/messageRules'
import type { StreamListener } from '../../types'
import { PersistentChatContextProvider } from '../PersistentChatContextProvider'

const TOPIC_ID = 'reply-group-context-topic'
const REMOVED_FACT = 'DELETED_REPLY_FACT'
const SUMMARY = `Earlier reply said ${REMOVED_FACT}.`
const windowManager = defaultServiceInstances.WindowManager

describe('reply-group deletion and subsequent persistent context', () => {
  const dbh = setupTestDatabase()

  function seedMessage(
    id: string,
    parentId: string,
    role: string,
    extra: Partial<typeof messageTable.$inferInsert> = {}
  ) {
    dbh.db
      .insert(messageTable)
      .values({
        id,
        parentId,
        role,
        topicId: TOPIC_ID,
        status: 'success',
        data: { parts: [{ type: 'text', text: id === 'a1' ? REMOVED_FACT : `Surviving ${id}` }] },
        ...extra
      })
      .run()
  }

  beforeEach(() => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.context_settings.enabled', false)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.context_settings.compress.enabled', false)
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.context_settings.max_messages', null)
    dbh.db.insert(topicTable).values({ id: TOPIC_ID, orderKey: 'a0', activeNodeId: 'u3' }).run()
    dbh.db.insert(messageTable).values(rootRow(TOPIC_ID)).run()
    seedMessage('u1', `vroot-${TOPIC_ID}`, 'user')
    seedMessage('a1', 'u1', 'assistant', { siblingsGroupId: 1 })
    seedMessage('u2', 'a1', 'user')
    seedMessage('a2', 'u2', 'assistant', {
      compactionSummary: SUMMARY,
      stats: { contextTokens: 321, totalTokens: 400 },
      updatedAt: 100
    })
    seedMessage('u3', 'a2', 'user')
  })

  afterEach(() => {
    dbh.sqlite.exec('DROP TRIGGER IF EXISTS reject_reply_delete')
    vi.restoreAllMocks()
  })

  function row(id: string) {
    return dbh.db.select().from(messageTable).where(eq(messageTable.id, id)).get()
  }

  function addOtherBranch(groupId = 1) {
    seedMessage('other-reply', 'u1', 'assistant', { siblingsGroupId: groupId })
    seedMessage('other-user', 'other-reply', 'user')
    seedMessage('other-anchor', 'other-user', 'assistant', {
      compactionSummary: SUMMARY,
      stats: { contextTokens: 222, totalTokens: 300 },
      updatedAt: 200
    })
  }

  it('clears direct and deep descendant anchors while retaining their content and historical usage', () => {
    dbh.db.update(messageTable).set({ compactionSummary: SUMMARY }).where(eq(messageTable.id, 'u2')).run()
    const before = row('a2')!
    const response = messageService.deleteReplyGroup('a1')

    expect(row('a1')).toBeUndefined()
    expect(row('u2')).toMatchObject({ parentId: 'u1', compactionSummary: null })
    expect(row('a2')).toMatchObject({
      compactionSummary: null,
      stats: { totalTokens: 400 },
      data: before.data,
      updatedAt: before.updatedAt
    })
    expect(row('a2')?.stats).not.toHaveProperty('contextTokens')
    expect(response).toEqual({ deletedIds: ['a1'], reparentedIds: ['u2'], newActiveNodeId: undefined })
  })

  it('invalidates every sibling subtree when an alternate group member identifies the deletion', () => {
    addOtherBranch()
    const response = messageService.deleteReplyGroup('other-reply')

    expect(response.deletedIds.sort()).toEqual(['a1', 'other-reply'])
    expect(row('u2')?.parentId).toBe('u1')
    expect(row('other-user')?.parentId).toBe('u1')
    expect(row('a2')).toMatchObject({ compactionSummary: null, stats: { totalTokens: 400 }, updatedAt: 100 })
    expect(row('other-anchor')).toMatchObject({ compactionSummary: null, stats: { totalTokens: 300 }, updatedAt: 200 })
    expect(row('a2')?.stats).not.toHaveProperty('contextTokens')
    expect(row('other-anchor')?.stats).not.toHaveProperty('contextTokens')
  })

  it('invalidates an inactive deleted group without touching the active branch', () => {
    addOtherBranch(9)
    const activeBefore = row('a2')
    messageService.deleteReplyGroup('other-reply')

    expect(row('a2')).toEqual(activeBefore)
    expect(row('other-anchor')).toMatchObject({ compactionSummary: null, stats: { totalTokens: 300 } })
    expect(row('other-anchor')?.stats).not.toHaveProperty('contextTokens')
  })

  it('treats group zero as one reply and preserves other reply subtrees', () => {
    addOtherBranch()
    dbh.db.update(messageTable).set({ siblingsGroupId: 0 }).where(eq(messageTable.id, 'a1')).run()
    const otherBefore = row('other-anchor')
    expect(messageService.deleteReplyGroup('a1').deletedIds).toEqual(['a1'])

    expect(row('a2')?.compactionSummary).toBeNull()
    expect(row('other-reply')).toBeDefined()
    expect(row('other-anchor')).toEqual(otherBefore)
  })

  it('preserves earlier ancestor summaries and same-number groups in another topic', () => {
    dbh.db
      .update(messageTable)
      .set({ compactionSummary: 'Earlier safe summary' })
      .where(eq(messageTable.id, 'u1'))
      .run()
    dbh.db.insert(topicTable).values({ id: 'other-topic', orderKey: 'a1' }).run()
    dbh.db.insert(messageTable).values(rootRow('other-topic')).run()
    seedMessage('cross-topic', 'vroot-other-topic', 'assistant', {
      topicId: 'other-topic',
      siblingsGroupId: 1,
      compactionSummary: 'Other topic summary',
      stats: { contextTokens: 50 }
    })
    const otherBefore = row('cross-topic')
    messageService.deleteReplyGroup('a1')

    expect(row('u1')?.compactionSummary).toBe('Earlier safe summary')
    expect(row('cross-topic')).toEqual(otherBefore)
    expect(row('a2')?.compactionSummary).toBeNull()
  })

  it('rejects a pending hidden sibling without clearing valid anchors or moving children', () => {
    seedMessage('pending-hidden', 'u1', 'assistant', { siblingsGroupId: 1, status: 'pending' })
    const before = row('a2')
    expect(() => messageService.deleteReplyGroup('a1')).toThrow('still generating')

    expect(row('a1')).toBeDefined()
    expect(row('u2')?.parentId).toBe('a1')
    expect(row('a2')).toEqual(before)
  })

  it('rolls back invalidation and reparenting if the row deletion fails, without publishing', () => {
    const before = dbh.db.select().from(messageTable).orderBy(messageTable.id).all()
    const observed: unknown[] = []
    vi.spyOn(windowManager, 'broadcast').mockImplementation((...args) => {
      observed.push(args)
    })
    dbh.sqlite.exec(
      "CREATE TEMP TRIGGER reject_reply_delete BEFORE DELETE ON message WHEN OLD.id = 'a1' BEGIN SELECT RAISE(ABORT, 'delete fault'); END"
    )

    expect(() => messageService.deleteReplyGroup('a1')).toThrow('delete fault')
    expect(dbh.db.select().from(messageTable).orderBy(messageTable.id).all()).toEqual(before)
    expect(observed).toEqual([])
  })

  for (const activeNodeId of ['u3', 'a1']) {
    it(`publishes deep descendant read-model changes after commit when the active node is ${activeNodeId}`, () => {
      dbh.db.update(topicTable).set({ activeNodeId }).where(eq(topicTable.id, TOPIC_ID)).run()
      const observed: Array<{
        inTransaction: boolean
        effects: DataApiDataChangeEffect[]
        anchor: unknown
        deleted: unknown
      }> = []
      vi.spyOn(windowManager, 'broadcast').mockImplementation((_channel, effects: DataApiDataChangeEffect[]) => {
        observed.push({ inTransaction: dbh.sqlite.inTransaction, effects, anchor: row('a2'), deleted: row('a1') })
      })

      messageService.deleteReplyGroup('a1')

      expect(observed).toHaveLength(1)
      expect(observed[0]).toMatchObject({
        inTransaction: false,
        deleted: undefined,
        anchor: { compactionSummary: null, stats: { totalTokens: 400 } }
      })
      for (const endpoint of ['/topics/:topicId/messages', '/topics/:topicId/tree', '/messages/:id']) {
        expect(observed[0].effects.find((effect) => effect.endpoint === endpoint)?.entityIds).toEqual(
          expect.arrayContaining(['a1', 'u2', 'a2', 'u3'])
        )
      }
      if (activeNodeId === 'a1') {
        expect(dbh.db.select().from(topicTable).where(eq(topicTable.id, TOPIC_ID)).get()?.activeNodeId).toBe('u3')
        expect(observed[0].effects).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ endpoint: '/topics', entityIds: [TOPIC_ID] }),
            expect.objectContaining({ endpoint: '/topics/:id', routeParams: { id: TOPIC_ID } })
          ])
        )
      }
    })
  }

  it('keeps committed deletion and invalidation successful when notification delivery fails', () => {
    vi.spyOn(windowManager, 'broadcast').mockImplementation(() => {
      throw new Error('window closed')
    })
    expect(() => messageService.deleteReplyGroup('a1')).not.toThrow()
    expect(row('a1')).toBeUndefined()
    expect(row('a2')?.compactionSummary).toBeNull()
  })

  it('deleting a group with no descendants leaves the other context markers intact', () => {
    seedMessage('leaf-reply', 'u1', 'assistant', { siblingsGroupId: 9 })
    const before = row('a2')
    messageService.deleteReplyGroup('leaf-reply')
    expect(row('leaf-reply')).toBeUndefined()
    expect(row('a2')).toEqual(before)
  })

  for (const enabled of [false, true]) {
    it(`prepares the next model request without the deleted fact when context management is ${enabled}`, async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('chat.context_settings.enabled', enabled)
      const modelId = createUniqueModelId('repro-provider', 'repro-model')
      dbh.db.insert(userProviderTable).values({ providerId: 'repro-provider', name: 'Repro', orderKey: 'a0' }).run()
      dbh.db
        .insert(userModelTable)
        .values({
          id: modelId,
          providerId: 'repro-provider',
          modelId: 'repro-model',
          name: 'Repro Model',
          capabilities: [],
          supportsStreaming: true,
          isEnabled: true,
          isHidden: false,
          orderKey: 'a0',
          contextWindow: 128000
        })
        .run()
      messageService.deleteReplyGroup('a1')
      const subscriber: StreamListener = {
        id: 'test',
        isAlive: () => true,
        onChunk: () => {},
        onDone: () => {},
        onPaused: () => {},
        onError: () => {}
      }
      const prepared = await new PersistentChatContextProvider().prepareDispatch(
        subscriber,
        {
          trigger: 'submit-message',
          topicId: TOPIC_ID,
          parentAnchorId: 'u3',
          userMessageParts: [{ type: 'text', text: 'Actual next submit' }],
          mentionedModelIds: [modelId]
        },
        { hasLiveStream: false }
      )
      try {
        const messages = await toModelMessages(prepared.models[0].request.messages ?? [])
        expect(JSON.stringify(messages)).not.toContain(REMOVED_FACT)
        expect(JSON.stringify(messages)).toContain('Surviving a2')
        expect(JSON.stringify(messages)).toContain('Actual next submit')
      } finally {
        for (const execution of prepared.models) execution.rootSpan?.end()
      }
    })
  }
})
