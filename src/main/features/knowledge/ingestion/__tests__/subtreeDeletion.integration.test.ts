import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { chunk } from 'es-toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { jobTable } from '@data/db/schemas/job'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { JobManager } from '@main/core/job/JobManager'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { KnowledgeRelativePathSchema } from '@shared/data/types/knowledge'

import { enqueueKnowledgeSubtreeDeletionTx } from '../subtreeDeletion'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    JobManager: { enqueueTx: vi.fn() },
    SchedulerService: { pause: vi.fn() }
  } as Parameters<typeof mockApplicationFactory>[0])
})

const BASE_ID = '11111111-1111-4111-8111-111111111111'

describe('large subtree cleanup transactions', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    BaseService.resetInstances()
    dbh.db
      .insert(knowledgeBaseTable)
      .values({ id: BASE_ID, name: 'Cleanup', orderKey: 'a0', status: 'completed', chunkSize: 1024, chunkOverlap: 200 })
      .run()
  })

  it.each([false, true])('bounds real job payloads and preserves atomic rollback=%s', async (rollback) => {
    const manager = new JobManager()
    manager.registerHandler('knowledge.delete-subtree', { recovery: 'retry', execute: async () => {} })
    manager.pause('verify durable admission without dispatch')
    vi.mocked(application.get('JobManager').enqueueTx).mockImplementation(manager.enqueueTx.bind(manager))
    const ids = Array.from({ length: 33_001 }, () => randomUUID())
    for (const batch of chunk(ids, 500)) {
      dbh.db
        .insert(knowledgeItemTable)
        .values(
          batch.map((id) => ({
            id,
            baseId: BASE_ID,
            type: 'external' as const,
            status: 'completed' as const,
            data: { source: 'Feishu', title: id, relativePath: KnowledgeRelativePathSchema.parse(`external/${id}.md`) }
          }))
        )
        .run()
    }
    const admit = () =>
      application.get('DbService').withWriteTx((tx) => {
        const withdrawn = knowledgeItemService.setSubtreeStatusTx(tx, BASE_ID, ids, 'deleting')
        expect(withdrawn.toSorted()).toEqual(ids.toSorted())
        enqueueKnowledgeSubtreeDeletionTx(tx, BASE_ID, ids)
        if (rollback) throw new Error('rollback after admission')
      })
    if (rollback) expect(admit).toThrow('rollback after admission')
    else admit()
    await Promise.resolve()
    const jobs = dbh.db.select().from(jobTable).all()
    if (rollback) {
      expect(jobs).toEqual([])
    } else {
      const admitted = jobs.flatMap((job) => (job.input as { rootItemIds: string[] }).rootItemIds)
      expect(admitted.toSorted()).toEqual(ids.toSorted())
      expect(admitted).toHaveLength(ids.length)
    }
    expect(
      new Set(
        dbh.db
          .select({ status: knowledgeItemTable.status })
          .from(knowledgeItemTable)
          .all()
          .map((item) => item.status)
      )
    ).toEqual(new Set([rollback ? 'completed' : 'deleting']))
  })
})
