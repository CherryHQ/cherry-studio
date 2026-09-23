import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { jobTable } from '@data/db/schemas/job'
import { jobService } from '@data/services/JobService'
import { paintingService } from '@data/services/PaintingService'

import { cancelImageGenerationJobs, reconcileImageGenerationJobs } from '../imageGenerationJobHandler'

const dbh = setupTestDatabase()

function painting(id: string, projectId?: string) {
  return paintingService.create({
    id,
    projectId,
    providerId: 'test',
    prompt: id,
    stepStatus: 'running',
    files: { input: [], output: [] }
  })
}

function job(id: string, paintingId: string | undefined, metadata: Record<string, unknown> = {}, started = true) {
  dbh.db
    .insert(jobTable)
    .values({
      id,
      type: 'image-generation.generate',
      status: started ? 'running' : 'pending',
      queue: 'image-generation.test',
      scheduledAt: Date.now(),
      startedAt: started ? Date.now() : null,
      input: {
        uniqueModelId: 'test::image',
        paintingId,
        n: 1,
        providerParams: {},
        cleanupPolicy: 'delete_when_unreferenced'
      },
      metadata
    })
    .run()
}

afterEach(() => vi.restoreAllMocks())

describe('image generation startup recovery', () => {
  it('preserves known handles and unsubmitted work, abandoning ambiguous submissions and orphan tool results', () => {
    for (const id of ['task', 'urls', 'queued', 'unknown', 'reset', 'legacy', 'orphan']) painting(id)
    job('task-job', 'task', { submissionStarted: true, taskId: 'remote-1' })
    job('urls-job', 'urls', { submissionStarted: true, imageUrls: ['https://example.com/image.png'] })
    job('queued-job', 'queued', {}, false)
    job('unknown-job', 'unknown', { submissionStarted: true })
    job('reset-job', 'reset', { submissionStarted: true }, false)
    job('legacy-job', 'legacy')
    job('tool-job', undefined, { taskId: 'remote-tool' })
    job('queued-tool-job', undefined, {}, false)

    reconcileImageGenerationJobs()

    expect(
      jobService
        .list({ status: ['running', 'pending'] })
        .map((item) => item.id)
        .sort()
    ).toEqual(['queued-job', 'task-job', 'urls-job'])
    for (const id of ['task', 'urls', 'queued']) expect(paintingService.getById(id).stepStatus).toBe('running')
    for (const id of ['unknown', 'reset', 'legacy', 'orphan'])
      expect(paintingService.getById(id).stepStatus).toBe('interrupted')
    expect(jobService.getById('tool-job')?.status).toBe('cancelled')
    reconcileImageGenerationJobs()
    expect(paintingService.getById('task').stepStatus).toBe('running')
  })

  it('does not revive a persisted cancellation even when a remote handle exists', () => {
    painting('canceled')
    job('canceled-job', 'canceled', { taskId: 'remote-1' })
    dbh.db.update(jobTable).set({ cancelRequested: true }).where(eq(jobTable.id, 'canceled-job')).run()
    reconcileImageGenerationJobs()
    expect(jobService.getById('canceled-job')?.status).toBe('cancelled')
    expect(paintingService.getById('canceled').stepStatus).toBe('interrupted')
  })

  it('cancels every active version in a project while leaving another project running', async () => {
    painting('project')
    painting('child', 'project')
    painting('other')
    job('root-job', 'project')
    job('child-job', 'child')
    job('other-job', 'other')
    const cancellationManager = { cancel: async (id: string) => jobService.cancelByIds([id], null) }
    const originalGet = vi.mocked(application.get).getMockImplementation()!
    vi.spyOn(application, 'get').mockImplementation(
      (name) => (name === 'JobManager' ? cancellationManager : originalGet(name)) as never
    )

    await cancelImageGenerationJobs(new Set(paintingService.getProjectStepIds('project')))

    expect(jobService.getById('root-job')?.status).toBe('cancelled')
    expect(jobService.getById('child-job')?.status).toBe('cancelled')
    expect(jobService.getById('other-job')?.status).toBe('running')
  })
})
