import { application } from '@application'
import type { InsertJobRow } from '@data/db/schemas/job'
import type { DbType } from '@data/db/types'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
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

describe('JobService batch primitives', () => {
  setupTestDatabase()

  it('inserts parameter-safe chunks and returns snapshots in input order', () => {
    const rows = Array.from({ length: 125 }, (_, index) =>
      baseRow({ input: { index }, idempotencyKey: `batch-order-${index}` })
    )

    const snapshots = application.get('DbService').withWriteTx((tx) => jobService.createManyTx(tx, rows))

    expect(snapshots).toHaveLength(rows.length)
    expect(snapshots.map((snapshot) => snapshot.input)).toEqual(rows.map((row) => row.input))
    expect(new Set(snapshots.map((snapshot) => snapshot.id)).size).toBe(rows.length)
  })

  it('finds active idempotency keys across query chunks and ignores terminal rows', () => {
    const rows = Array.from({ length: 905 }, (_, index) =>
      baseRow({
        status: index === 904 ? 'completed' : 'pending',
        idempotencyKey: `batch-find-${index}`
      })
    )
    application.get('DbService').withWriteTx((tx) => jobService.createManyTx(tx, rows))

    const keys = rows.map((row) => row.idempotencyKey as string)
    const found = application.get('DbService').withWriteTx((tx) => jobService.findActiveByIdempotencyKeysTx(tx, keys))

    expect(found).toHaveLength(904)
    expect(found.some((snapshot) => snapshot.idempotencyKey === 'batch-find-904')).toBe(false)
  })

  it('rolls back every insert chunk when the caller transaction fails', () => {
    const db = MockMainDbServiceExport.dbService.getDb() as DbType
    expect(() =>
      db.transaction(
        (tx) => {
          jobService.createManyTx(
            tx,
            Array.from({ length: 125 }, (_, index) =>
              baseRow({ type: 'batch.rollback', input: { index }, idempotencyKey: `batch-rollback-${index}` })
            )
          )
          throw new Error('rollback-batch')
        },
        { behavior: 'immediate' }
      )
    ).toThrow('rollback-batch')

    expect(jobService.count({ type: 'batch.rollback' })).toBe(0)
  })
})
