import { application } from '@application'
import { jobFileRefTable } from '@data/db/schemas/fileRelations'
import { type InsertJobRow, jobTable } from '@data/db/schemas/job'
import { fileEntryService } from '@data/services/FileEntryService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import type { FileEntryId } from '@shared/data/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

const baseRow = (overrides: Partial<InsertJobRow> = {}): InsertJobRow => ({
  type: 'test.echo',
  status: 'pending',
  queue: 'default',
  scheduledAt: Date.now(),
  input: {},
  maxAttempts: 3,
  ...overrides
})

describe('JobService.count', () => {
  setupTestDatabase()

  const baseTrigger: Trigger = { kind: 'interval', ms: 60_000 }

  it('returns 0 on an empty database', async () => {
    expect(jobService.count({})).toBe(0)
  })

  it('counts by status filter using IN semantics', async () => {
    jobService.create(baseRow({ status: 'completed' }))
    jobService.create(baseRow({ status: 'completed' }))
    jobService.create(baseRow({ status: 'failed' }))
    jobService.create(baseRow({ status: 'pending' }))

    expect(jobService.count({ status: ['completed'] })).toBe(2)
    expect(jobService.count({ status: ['failed', 'pending'] })).toBe(2)
    expect(jobService.count({})).toBe(4)
  })

  it('stays consistent with list() for a scheduleId filter', async () => {
    const scheduleX = jobScheduleService.create({
      type: 'agent.task',
      name: 'sched-X',
      trigger: baseTrigger,
      jobInputTemplate: {},
      catchUpPolicy: { kind: 'skip-missed' }
    })
    const scheduleY = jobScheduleService.create({
      type: 'agent.task',
      name: 'sched-Y',
      trigger: baseTrigger,
      jobInputTemplate: {},
      catchUpPolicy: { kind: 'skip-missed' }
    })

    jobService.create(baseRow({ scheduleId: scheduleX.id }))
    jobService.create(baseRow({ scheduleId: scheduleX.id }))
    jobService.create(baseRow({ scheduleId: scheduleX.id }))
    jobService.create(baseRow({ scheduleId: scheduleY.id }))

    const countX = jobService.count({ scheduleId: scheduleX.id })
    const listX = jobService.list({ scheduleId: scheduleX.id })
    expect(countX).toBe(3)
    expect(countX).toBe(listX.length)
  })

  it('AND-composes multi-field filters', async () => {
    jobService.create(baseRow({ status: 'failed', queue: 'Q1' }))
    jobService.create(baseRow({ status: 'failed', queue: 'Q2' }))
    jobService.create(baseRow({ status: 'completed', queue: 'Q1' }))

    expect(jobService.count({ status: ['failed'], queue: 'Q1' })).toBe(1)
    expect(jobService.count({ status: ['failed'] })).toBe(2)
    expect(jobService.count({ queue: 'Q1' })).toBe(2)
  })

  it('returns 0 when no row matches', async () => {
    jobService.create(baseRow({ type: 'test.echo' }))
    expect(jobService.count({ type: 'nonexistent.type' })).toBe(0)
  })
})

describe('JobService.list/count filters', () => {
  setupTestDatabase()

  it('filters by parentId and stays consistent with count()', () => {
    // parentId has a self-referencing FK — the parent must be a real row.
    const parent = jobService.create(baseRow({ status: 'completed' }))
    jobService.create(baseRow({ parentId: parent.id }))
    jobService.create(baseRow({ parentId: parent.id }))
    jobService.create(baseRow())

    const children = jobService.list({ parentId: parent.id })
    expect(children).toHaveLength(2)
    expect(children.every((j) => j.parentId === parent.id)).toBe(true)
    expect(jobService.count({ parentId: parent.id })).toBe(children.length)
    expect(jobService.list({ parentId: parent.id + '-missing' })).toHaveLength(0)
  })

  it('accepts a type array with IN semantics, equivalent to the union of single-type filters', () => {
    jobService.create(baseRow({ type: 'type.a' }))
    jobService.create(baseRow({ type: 'type.a' }))
    jobService.create(baseRow({ type: 'type.b' }))
    jobService.create(baseRow({ type: 'type.c' }))

    const combined = jobService.list({ type: ['type.a', 'type.b'] })
    expect(combined).toHaveLength(3)
    expect(jobService.count({ type: ['type.a', 'type.b'] })).toBe(combined.length)
    const unionOfSingles = jobService.list({ type: 'type.a' }).length + jobService.list({ type: 'type.b' }).length
    expect(combined.length).toBe(unionOfSingles)
  })

  it('treats an empty type array as "no filter" — matches all rows', () => {
    jobService.create(baseRow({ type: 'type.a' }))
    jobService.create(baseRow({ type: 'type.b' }))

    expect(jobService.list({ type: [] })).toHaveLength(2)
    expect(jobService.count({ type: [] })).toBe(2)
  })
})

describe('JobService.addFileRefsTx', () => {
  setupTestDatabase()

  const seedEntry = (id: FileEntryId) =>
    fileEntryService.create({
      id,
      origin: 'internal',
      cleanupPolicy: 'delete_when_unreferenced',
      name: 'in',
      ext: 'png',
      size: 4
    })

  const refsFor = (jobId: string) =>
    application.get('DbService').getDb().select().from(jobFileRefTable).where(eq(jobFileRefTable.sourceId, jobId)).all()

  it('writes input and mask refs for an enqueued job', () => {
    const job = jobService.create(baseRow())
    const input = seedEntry('019606a0-0000-7000-8000-0000000000f1' as FileEntryId)
    const mask = seedEntry('019606a0-0000-7000-8000-0000000000f2' as FileEntryId)

    application.get('DbService').withWriteTx((tx) => {
      jobService.addFileRefsTx(tx, [
        { fileEntryId: input.id, sourceId: job.id, role: 'input' },
        { fileEntryId: mask.id, sourceId: job.id, role: 'mask' }
      ])
    })

    expect(refsFor(job.id).map((r) => ({ fileEntryId: r.fileEntryId, role: r.role }))).toEqual(
      expect.arrayContaining([
        { fileEntryId: input.id, role: 'input' },
        { fileEntryId: mask.id, role: 'mask' }
      ])
    )
  })

  it('is a no-op for an empty row list', () => {
    const job = jobService.create(baseRow())
    expect(() => application.get('DbService').withWriteTx((tx) => jobService.addFileRefsTx(tx, []))).not.toThrow()
    expect(refsFor(job.id)).toHaveLength(0)
  })

  it('releases the refs when the job row is pruned (FK cascade frees the inputs for reclaim)', () => {
    const job = jobService.create(baseRow({ status: 'completed' }))
    const input = seedEntry('019606a0-0000-7000-8000-0000000000f3' as FileEntryId)
    application.get('DbService').withWriteTx((tx) => {
      jobService.addFileRefsTx(tx, [{ fileEntryId: input.id, sourceId: job.id, role: 'input' }])
    })
    expect(refsFor(job.id)).toHaveLength(1)

    // Terminal-row pruning is what releases a job's inputs to the cleanup pass
    // (file-entry-cleanup.md §5.1) — the entry itself must survive the cascade.
    application.get('DbService').getDb().delete(jobTable).where(eq(jobTable.id, job.id)).run()

    expect(refsFor(job.id)).toHaveLength(0)
    expect(fileEntryService.findById(input.id)).not.toBeNull()
  })
})
