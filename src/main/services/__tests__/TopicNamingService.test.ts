import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { messageService } from '@main/data/services/MessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { topicNamingService } from '../TopicNamingService'

describe('TopicNamingService.maybeRenameForkedTopic', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    // Disabled path: deterministic first-message rename, no AiService call.
    // It shares the same idempotency guard as the LLM path.
    await application.get('PreferenceService').set('topic.naming.enabled', false)
  })

  // `POST /topics` is retried by DataApiService on timeout/5xx/network (retry
  // is method-agnostic), so this fire-and-forget trigger can fire twice for the
  // same forked topic. The second fire must be a no-op, not a duplicate rename.
  it('renames once and is idempotent when the forking POST is retried', async () => {
    await dbh.db.insert(topicTable).values({ id: 't1', activeNodeId: 'm1', orderKey: 'a0' })
    await dbh.db.insert(messageTable).values({
      id: 'm1',
      topicId: 't1',
      parentId: null,
      role: 'user',
      data: { parts: [{ type: 'text', text: 'Forked chat about cats' }] },
      status: 'success',
      siblingsGroupId: 0
    })

    const spy = vi.spyOn(messageService, 'getBranchMessages')

    await topicNamingService.maybeRenameForkedTopic('t1', 'asst-1')
    const [afterFirst] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 't1'))
    expect(afterFirst.name).toBe('Forked chat about cats')

    // Simulates the retried POST /topics firing the trigger a second time.
    await topicNamingService.maybeRenameForkedTopic('t1', 'asst-1')
    const [afterSecond] = await dbh.db.select().from(topicTable).where(eq(topicTable.id, 't1'))
    expect(afterSecond.name).toBe('Forked chat about cats')

    // 2nd invocation short-circuits at the "named once" gate before doing any
    // work (isNameManuallyEdited stays false on internal renames, so the gate
    // is the only thing preventing a duplicate rename).
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
