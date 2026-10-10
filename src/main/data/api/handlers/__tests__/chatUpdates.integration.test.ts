import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { messageHandlers } from '@data/api/handlers/messages'
import { topicHandlers } from '@data/api/handlers/topics'
import { topicTable } from '@data/db/schemas/topic'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import { ErrorCode } from '@shared/data/api/errors'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

describe('chat PATCH handlers — empty updates', () => {
  const dbh = setupTestDatabase()
  let topicId: string
  let messageId: string

  beforeEach(() => {
    const topic = topicService.create({ name: 'Keep this name' })
    topicId = topic.id
    topicService.update(topicId, { name: topic.name })
    const message = messageService.create(topicId, {
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Keep this content' }] },
      status: 'success'
    })
    messageId = message.id
    notifyDataApiDataChangeMock.mockClear()
  })

  function totalChanges(): unknown {
    return dbh.sqlite.prepare('SELECT total_changes()').pluck().get()
  }

  it.each(['empty object', 'undefined fields'])(
    'returns the current topic for %s without writing or notifying',
    async (kind) => {
      const before = topicService.getById(topicId)
      const changes = totalChanges()
      const body =
        kind === 'empty object' ? {} : { name: undefined, isNameManuallyEdited: undefined, assistantId: undefined }

      await expect(topicHandlers['/topics/:id'].PATCH({ params: { id: topicId }, body })).resolves.toEqual(before)

      expect(topicService.getById(topicId)).toEqual(before)
      expect(totalChanges()).toBe(changes)
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    }
  )

  it.each(['empty object', 'undefined fields'])(
    'returns the current message for %s without writing or notifying',
    async (kind) => {
      const before = messageService.getById(messageId)
      const changes = totalChanges()
      const body =
        kind === 'empty object'
          ? {}
          : { data: undefined, parentId: undefined, status: undefined, siblingsGroupId: undefined }

      await expect(messageHandlers['/messages/:id'].PATCH({ params: { id: messageId }, body })).resolves.toEqual(before)

      expect(messageService.getById(messageId)).toEqual(before)
      expect(totalChanges()).toBe(changes)
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    }
  )

  it.each(['missing', 'archived'])('still rejects an empty update to a %s topic', async (state) => {
    if (state === 'archived') {
      dbh.db.update(topicTable).set({ deletedAt: Date.now() }).where(eq(topicTable.id, topicId)).run()
    }
    const id = state === 'missing' ? 'missing-topic' : topicId

    await expect(topicHandlers['/topics/:id'].PATCH({ params: { id }, body: {} })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it.each(['missing', 'archived topic'])('still rejects an empty update to a message in a %s state', async (state) => {
    if (state === 'archived topic') {
      dbh.db.update(topicTable).set({ deletedAt: Date.now() }).where(eq(topicTable.id, topicId)).run()
    }
    const id = state === 'missing' ? 'missing-message' : messageId

    await expect(messageHandlers['/messages/:id'].PATCH({ params: { id }, body: {} })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('treats an explicit false flag as a real update', async () => {
    expect(topicService.getById(topicId).isNameManuallyEdited).toBe(true)

    await topicHandlers['/topics/:id'].PATCH({ params: { id: topicId }, body: { isNameManuallyEdited: false } })

    expect(topicService.getById(topicId)).toMatchObject({ name: 'Keep this name', isNameManuallyEdited: false })
    expect(notifyDataApiDataChangeMock).toHaveBeenCalled()
  })
})
