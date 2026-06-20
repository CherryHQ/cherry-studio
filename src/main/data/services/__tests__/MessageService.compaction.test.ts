import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { messageService } from '@data/services/MessageService'
import type { MessageData } from '@shared/data/types/message'
import { setupTestDatabase, withRoot } from '@test-helpers/db'
import { beforeEach, describe, expect, it } from 'vitest'

function mainText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] }
}

describe('setCompactionSummary', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    await dbh.db.insert(topicTable).values({ id: 'topic-c', activeNodeId: 'm1', orderKey: 'a0' })
    await dbh.db.insert(messageTable).values(
      withRoot('topic-c', [
        {
          id: 'm1',
          parentId: null,
          topicId: 'topic-c',
          role: 'user',
          data: mainText('hello'),
          status: 'success',
          siblingsGroupId: 0,
          createdAt: 100,
          updatedAt: 100
        }
      ])
    )
  })

  it('sets and reads back the summary on a message row', async () => {
    await messageService.setCompactionSummary('m1', 'summary of first 10 turns')
    const row = await messageService.getById('m1')
    expect(row.compactionSummary).toBe('summary of first 10 turns')
  })

  it('overwrites the summary when called a second time', async () => {
    await messageService.setCompactionSummary('m1', 'first')
    await messageService.setCompactionSummary('m1', 'second')
    const row = await messageService.getById('m1')
    expect(row.compactionSummary).toBe('second')
  })

  it('round-trips compactionSummary through getPathToNode (real read path)', async () => {
    await messageService.setCompactionSummary('m1', 'path-readback')
    const path = await messageService.getPathToNode('m1')
    expect(path.at(-1)?.compactionSummary).toBe('path-readback')
  })
})
