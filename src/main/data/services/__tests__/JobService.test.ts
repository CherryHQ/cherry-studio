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
    expect(await jobService.count({})).toBe(0)
  })

  it('counts by status filter using IN semantics', async () => {
    await jobService.create(baseRow({ status: 'completed' }))
    await jobService.create(baseRow({ status: 'completed' }))
    await jobService.create(baseRow({ status: 'failed' }))
    await jobService.create(baseRow({ status: 'pending' }))

    expect(await jobService.count({ status: ['completed'] })).toBe(2)
    expect(await jobService.count({ status: ['failed', 'pending'] })).toBe(2)
    expect(await jobService.count({})).toBe(4)
  })

  it('stays consistent with list() for a scheduleId filter', async () => {
    const scheduleX = await jobScheduleService.create({
      type: 'agent.task',
      name: 'sched-X',
      trigger: baseTrigger,
      jobInputTemplate: {},
      catchUpPolicy: { kind: 'skip-missed' }
    })
    const scheduleY = await jobScheduleService.create({
      type: 'agent.task',
      name: 'sched-Y',
      trigger: baseTrigger,
      jobInputTemplate: {},
      catchUpPolicy: { kind: 'skip-missed' }
    })

    await jobService.create(baseRow({ scheduleId: scheduleX.id }))
    await jobService.create(baseRow({ scheduleId: scheduleX.id }))
    await jobService.create(baseRow({ scheduleId: scheduleX.id }))
    await jobService.create(baseRow({ scheduleId: scheduleY.id }))

    const countX = await jobService.count({ scheduleId: scheduleX.id })
    const listX = await jobService.list({ scheduleId: scheduleX.id })
    expect(countX).toBe(3)
    expect(countX).toBe(listX.length)
  })

  it('AND-composes multi-field filters', async () => {
    await jobService.create(baseRow({ status: 'failed', queue: 'Q1' }))
    await jobService.create(baseRow({ status: 'failed', queue: 'Q2' }))
    await jobService.create(baseRow({ status: 'completed', queue: 'Q1' }))

    expect(await jobService.count({ status: ['failed'], queue: 'Q1' })).toBe(1)
    expect(await jobService.count({ status: ['failed'] })).toBe(2)
    expect(await jobService.count({ queue: 'Q1' })).toBe(2)
  })

  it('returns 0 when no row matches', async () => {
    await jobService.create(baseRow({ type: 'test.echo' }))
    expect(await jobService.count({ type: 'nonexistent.type' })).toBe(0)
  })
})
