import '@data/services/MessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { jobTable } from '@data/db/schemas/job'
import { topicTable } from '@data/db/schemas/topic'
import { jobService } from '@data/services/JobService'
import { loggerService } from '@logger'
import { runStartupRecovery } from '@main/core/job/runtime/recovery'
import type { JobContext, JobHandler } from '@main/core/job/types'

import { trashPurgeJobHandler } from '../trashPurgeJobHandler'

const purgeInputSchema = z.object({ emptyAll: z.boolean().optional() })

describe('trash purge startup recovery', () => {
  const dbh = setupTestDatabase()

  it('retains an interrupted empty-all request when a newer scheduled purge is queued', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('data.trash.retention_days', 30)
    const now = Date.now()
    const [manual, scheduled] = dbh.db
      .insert(jobTable)
      .values([
        {
          type: 'trash.purge',
          queue: 'trash.purge',
          status: 'running',
          scheduledAt: now - 2000,
          createdAt: now - 2000,
          input: { emptyAll: true }
        },
        {
          type: 'trash.purge',
          queue: 'trash.purge',
          status: 'pending',
          scheduledAt: now - 1000,
          createdAt: now - 1000,
          input: {}
        }
      ])
      .returning()
      .all()
    const topicId = 'recent-trashed-topic'
    dbh.db
      .insert(topicTable)
      .values({ id: topicId, name: 'recent', orderKey: 'a0', deletedAt: now - 1000 })
      .run()

    const recoveryHandler: JobHandler = {
      recovery: trashPurgeJobHandler.recovery,
      execute: (context) => trashPurgeJobHandler.execute({ ...context, input: purgeInputSchema.parse(context.input) })
    }
    runStartupRecovery(new Map([['trash.purge', recoveryHandler]]), () => false)
    const recovered = jobService.getActiveByType('trash.purge')
    for (const row of recovered) {
      const controller = new AbortController()
      const context: JobContext<{ emptyAll?: boolean }> = {
        jobId: row.id,
        input: purgeInputSchema.parse(row.input),
        attempt: 1,
        parentId: null,
        signal: controller.signal,
        metadata: {},
        patchMetadata: vi.fn(async () => undefined),
        // The topic phase proves the deletion scope; later domain/runtime sweeps are outside this reproduction.
        reportProgress: () => controller.abort(new Error('topic phase checked')),
        logger: loggerService
      }
      await expect(trashPurgeJobHandler.execute(context)).rejects.toThrow('topic phase checked')
    }

    const remainingTopicIds = dbh.db
      .select({ id: topicTable.id })
      .from(topicTable)
      .all()
      .map((row) => row.id)
    const recoveryState = {
      manualStatus: jobService.getById(manual.id)?.status,
      scheduledStatus: jobService.getById(scheduled.id)?.status
    }
    expect(remainingTopicIds, JSON.stringify(recoveryState)).toEqual([])
  })
})
