import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { jobFileRefTable } from '@data/db/schemas/fileRelations'
import { type InsertJobRow, jobTable } from '@data/db/schemas/job'
import { fileEntryService } from '@data/services/FileEntryService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import type { FileEntryId } from '@shared/data/types/file'

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

describe('JobService.getRunStatesByScheduleIds', () => {
  setupTestDatabase()

  const createSchedule = (name: string) =>
    jobScheduleService.create({
      type: 'agent.task',
      name,
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: {},
      catchUpPolicy: { kind: 'skip-missed' }
    })

  it('returns one prioritized run state per requested schedule', () => {
    const runningSchedule = createSchedule('running-summary')
    const unfinishedSchedule = createSchedule('unfinished-summary')
    const terminalSchedule = createSchedule('terminal-summary')
    const emptySchedule = createSchedule('empty-summary')
    const now = Date.now()

    jobService.create(
      baseRow({
        type: 'agent.task',
        status: 'completed',
        scheduleId: runningSchedule.id,
        startedAt: now - 3_000,
        finishedAt: now - 2_000
      })
    )
    jobService.create(baseRow({ type: 'agent.task', status: 'pending', scheduleId: runningSchedule.id }))
    jobService.create(
      baseRow({ type: 'agent.task', status: 'running', scheduleId: runningSchedule.id, startedAt: now - 1_000 })
    )

    jobService.create(
      baseRow({
        type: 'agent.task',
        status: 'failed',
        scheduleId: unfinishedSchedule.id,
        startedAt: now - 3_000,
        finishedAt: now - 2_000
      })
    )
    jobService.create(baseRow({ type: 'agent.task', status: 'delayed', scheduleId: unfinishedSchedule.id }))

    jobService.create(
      baseRow({
        type: 'agent.task',
        status: 'failed',
        scheduleId: terminalSchedule.id,
        startedAt: now - 4_000,
        finishedAt: now - 3_000
      })
    )
    jobService.create(
      baseRow({
        type: 'agent.task',
        status: 'cancelled',
        scheduleId: terminalSchedule.id,
        startedAt: now - 2_000,
        finishedAt: now - 1_000
      })
    )
    jobService.create(baseRow({ type: 'other.type', status: 'running', scheduleId: terminalSchedule.id }))

    expect(
      jobService.getRunStatesByScheduleIds('agent.task', [
        runningSchedule.id,
        unfinishedSchedule.id,
        terminalSchedule.id,
        emptySchedule.id,
        runningSchedule.id
      ])
    ).toEqual(
      new Map([
        [runningSchedule.id, { kind: 'running' }],
        [unfinishedSchedule.id, { kind: 'unfinished' }],
        [terminalSchedule.id, { kind: 'terminal', status: 'cancelled', finishedAt: now - 1_000 }]
      ])
    )
  })

  it('projects cancel-requested non-terminal rows as cancelled at their cancelRequestedAt', () => {
    const now = Date.now()
    const schedules = (['running', 'pending', 'delayed'] as const).map((status) => {
      const schedule = createSchedule(`cancel-requested-${status}`)
      jobService.create(
        baseRow({
          type: 'agent.task',
          status,
          scheduleId: schedule.id,
          startedAt: status === 'running' ? now - 5_000 : null,
          cancelRequested: true,
          cancelRequestedAt: now - 1_000,
          // Later than cancelRequestedAt — proves the projection reads the
          // immutable request time, not whatever bumped the row last.
          updatedAt: now - 200
        })
      )
      return schedule
    })

    const states = jobService.getRunStatesByScheduleIds(
      'agent.task',
      schedules.map((s) => s.id)
    )
    for (const schedule of schedules) {
      expect(states.get(schedule.id)).toEqual({ kind: 'terminal', status: 'cancelled', finishedAt: now - 1_000 })
    }
  })

  it('orders the cancelled projection against the latest real terminal row, ties going to the terminal row', () => {
    const now = Date.now()

    const newerCancel = createSchedule('newer-cancel')
    jobService.create(
      baseRow({ type: 'agent.task', status: 'completed', scheduleId: newerCancel.id, finishedAt: now - 5_000 })
    )
    jobService.create(
      baseRow({
        type: 'agent.task',
        status: 'running',
        scheduleId: newerCancel.id,
        startedAt: now - 3_000,
        cancelRequested: true,
        cancelRequestedAt: now - 1_000
      })
    )

    const newerTerminal = createSchedule('newer-terminal')
    jobService.create(
      baseRow({
        type: 'agent.task',
        status: 'pending',
        scheduleId: newerTerminal.id,
        cancelRequested: true,
        cancelRequestedAt: now - 5_000
      })
    )
    jobService.create(
      baseRow({ type: 'agent.task', status: 'failed', scheduleId: newerTerminal.id, finishedAt: now - 1_000 })
    )

    const tied = createSchedule('tied')
    jobService.create(
      baseRow({ type: 'agent.task', status: 'completed', scheduleId: tied.id, finishedAt: now - 2_000 })
    )
    const tiedLeftover = jobService.create(
      baseRow({
        type: 'agent.task',
        status: 'running',
        scheduleId: tied.id,
        startedAt: now - 3_000,
        cancelRequested: true,
        cancelRequestedAt: now - 2_000
      })
    )

    expect(jobService.getRunStatesByScheduleIds('agent.task', [newerCancel.id, newerTerminal.id, tied.id])).toEqual(
      new Map([
        [newerCancel.id, { kind: 'terminal', status: 'cancelled', finishedAt: now - 1_000 }],
        [newerTerminal.id, { kind: 'terminal', status: 'failed', finishedAt: now - 1_000 }],
        [tied.id, { kind: 'terminal', status: 'completed', finishedAt: now - 2_000 }]
      ])
    )

    // The tie must resolve the same way after recovery settles the leftover:
    // both rows are then terminal and the real outcome still wins.
    jobService.cancelByIds([tiedLeftover.id], null)
    expect(jobService.getRunStatesByScheduleIds('agent.task', [tied.id])).toEqual(
      new Map([[tied.id, { kind: 'terminal', status: 'completed', finishedAt: now - 2_000 }]])
    )
  })

  it('keeps active state when a non-cancel-requested active row coexists with a cancel-requested one', () => {
    const now = Date.now()

    const runningSchedule = createSchedule('active-wins-running')
    jobService.create(
      baseRow({
        type: 'agent.task',
        status: 'running',
        scheduleId: runningSchedule.id,
        startedAt: now - 1_000,
        cancelRequested: true,
        cancelRequestedAt: now
      })
    )
    jobService.create(
      baseRow({ type: 'agent.task', status: 'running', scheduleId: runningSchedule.id, startedAt: now - 500 })
    )

    const queuedSchedule = createSchedule('active-wins-queued')
    jobService.create(
      baseRow({
        type: 'agent.task',
        status: 'running',
        scheduleId: queuedSchedule.id,
        startedAt: now - 1_000,
        cancelRequested: true,
        cancelRequestedAt: now
      })
    )
    jobService.create(baseRow({ type: 'agent.task', status: 'pending', scheduleId: queuedSchedule.id }))

    expect(jobService.getRunStatesByScheduleIds('agent.task', [runningSchedule.id, queuedSchedule.id])).toEqual(
      new Map([
        [runningSchedule.id, { kind: 'running' }],
        [queuedSchedule.id, { kind: 'unfinished' }]
      ])
    )
  })

  it('stays stable across a recovery settle when a newer run finished after the cancel request', () => {
    const now = Date.now()
    const schedule = createSchedule('mixed-run-recovery')
    const leftover = jobService.create(
      baseRow({
        type: 'agent.task',
        status: 'running',
        scheduleId: schedule.id,
        startedAt: now - 8_000,
        cancelRequested: true,
        cancelRequestedAt: now - 5_000
      })
    )
    jobService.create(
      baseRow({ type: 'agent.task', status: 'completed', scheduleId: schedule.id, finishedAt: now - 2_000 })
    )

    const before = jobService.getRunStatesByScheduleIds('agent.task', [schedule.id])
    expect(before.get(schedule.id)).toEqual({ kind: 'terminal', status: 'completed', finishedAt: now - 2_000 })

    jobService.cancelByIds([leftover.id], null)

    const settled = jobService.getById(leftover.id)
    expect(settled?.status).toBe('cancelled')
    // finishedAt keeps real terminal-transition semantics (settle time, not the
    // request time) — GC / retention / recent-terminal ordering depend on it.
    expect(settled && Date.parse(settled.finishedAt!)).toBeGreaterThanOrEqual(now)
    expect(settled?.cancelRequestedAt).toBe(leftover.cancelRequestedAt)
    expect(jobService.getRunStatesByScheduleIds('agent.task', [schedule.id])).toEqual(before)
  })

  it('projects a settled cancelled row at its cancelRequestedAt, not its late finishedAt', () => {
    const now = Date.now()
    const schedule = createSchedule('settled-cancel-projection')
    jobService.create(
      baseRow({
        type: 'agent.task',
        status: 'cancelled',
        scheduleId: schedule.id,
        startedAt: now - 90_000,
        cancelRequested: true,
        cancelRequestedAt: now - 80_000,
        // Recovery settled the row a process lifetime after the request.
        finishedAt: now - 1_000
      })
    )
    jobService.create(
      baseRow({ type: 'agent.task', status: 'completed', scheduleId: schedule.id, finishedAt: now - 60_000 })
    )

    expect(jobService.getRunStatesByScheduleIds('agent.task', [schedule.id])).toEqual(
      new Map([[schedule.id, { kind: 'terminal', status: 'completed', finishedAt: now - 60_000 }]])
    )
  })

  it('reports the real status for a terminal row that still carries cancelRequested', () => {
    const now = Date.now()
    const schedule = createSchedule('completed-despite-cancel')
    jobService.create(
      baseRow({
        type: 'agent.task',
        status: 'completed',
        scheduleId: schedule.id,
        startedAt: now - 2_000,
        finishedAt: now - 1_000,
        cancelRequested: true,
        cancelRequestedAt: now - 1_500
      })
    )

    expect(jobService.getRunStatesByScheduleIds('agent.task', [schedule.id])).toEqual(
      new Map([[schedule.id, { kind: 'terminal', status: 'completed', finishedAt: now - 1_000 }]])
    )
  })
})

describe('JobService.setCancelRequestedTx', () => {
  setupTestDatabase()

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records cancelRequestedAt once — a repeated cancel does not move it', () => {
    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'], now })
    const job = jobService.create(baseRow({ status: 'running', startedAt: now }))
    const db = application.get('DbService').getDb()

    jobService.setCancelRequestedTx(db, job.id)
    const first = jobService.getById(job.id)
    expect(first?.cancelRequested).toBe(true)
    expect(first?.cancelRequestedAt).not.toBeNull()

    vi.setSystemTime(now + 5_000)
    jobService.setCancelRequestedTx(db, job.id)
    expect(jobService.getById(job.id)?.cancelRequestedAt).toBe(first?.cancelRequestedAt)
  })

  it('cancelManyTx stamps running rows once and leaves direct-cancelled rows unstamped', () => {
    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'], now })
    const running = jobService.create(baseRow({ status: 'running', queue: 'batch-q', startedAt: now }))
    const pending = jobService.create(baseRow({ status: 'pending', queue: 'batch-q' }))
    const db = application.get('DbService').getDb()

    const first = jobService.cancelManyTx(db, { queue: 'batch-q' }, null)
    expect(first.runningIds).toEqual([running.id])
    expect(first.transitioned).toBe(1)

    const stamped = jobService.getById(running.id)
    expect(stamped?.cancelRequested).toBe(true)
    expect(stamped?.cancelRequestedAt).not.toBeNull()
    // The pending row went straight to cancelled — no request, no timestamp.
    expect(jobService.getById(pending.id)).toMatchObject({ status: 'cancelled', cancelRequestedAt: null })

    vi.setSystemTime(now + 5_000)
    jobService.cancelManyTx(db, { queue: 'batch-q' }, null)
    expect(jobService.getById(running.id)?.cancelRequestedAt).toBe(stamped?.cancelRequestedAt)
  })

  it('does not stamp cancelRequestedAt when cancelling an already-terminal row', () => {
    const now = Date.now()
    const job = jobService.create(baseRow({ status: 'cancelled', startedAt: now - 5_000, finishedAt: now - 4_000 }))
    const db = application.get('DbService').getDb()

    jobService.setCancelRequestedTx(db, job.id)

    const after = jobService.getById(job.id)
    // Terminal no-op keeps the documented flag behavior but must not invent a
    // cancel time — read models would resurface this run as the newest.
    expect(after?.cancelRequested).toBe(true)
    expect(after?.cancelRequestedAt).toBeNull()
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
