import type { InsertJobRow } from '@data/db/schemas/job'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { jobService } from '@data/services/JobService'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

describe('JobService.count', () => {
  setupTestDatabase()

  const baseRow = (overrides: Partial<InsertJobRow> = {}): InsertJobRow => ({
    type: 'test.echo',
    status: 'pending',
    queue: 'default',
    scheduledAt: Date.now(),
    input: {},
    maxAttempts: 3,
    ...overrides
  })

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
