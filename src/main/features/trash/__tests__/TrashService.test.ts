import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock } = vi.hoisted(() => ({ appGetMock: vi.fn() }))

vi.mock('@application', () => ({ application: { get: appGetMock } }))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()
  class MockBaseService {}
  return { ...actual, BaseService: MockBaseService }
})

// Keep the wiring test lean: the handler's own behavior is covered by
// trashPurgeJobHandler.test.ts — here only its identity matters.
vi.mock('../trashPurgeJobHandler', () => ({
  trashPurgeJobHandler: { recovery: 'singleton', defaultConcurrency: 1, execute: vi.fn() }
}))

const { trashPurgeJobHandler } = await import('../trashPurgeJobHandler')
const { TrashService } = await import('../TrashService')

const jobManager = {
  registerHandler: vi.fn(),
  getJobSchedule: vi.fn(() => null as unknown),
  registerJobSchedule: vi.fn(() => ({ id: 'schedule-1' })),
  enqueue: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  jobManager.getJobSchedule.mockReturnValue(null)
  appGetMock.mockImplementation((name: string) => {
    if (name === 'JobManager') return jobManager
    throw new Error(`Unexpected application.get(${name})`)
  })
})

// Lifecycle hooks are protected — the container is not running in tests, so
// drive them via the `any` escape hatch.
const drive = (svc: InstanceType<typeof TrashService>) => svc as unknown as { onInit(): void; onReady(): void }

describe('TrashService', () => {
  it('declares WhenReady phase with same-phase deps only (no BeforeReady services)', () => {
    expect(getPhase(TrashService)).toBe(Phase.WhenReady)
    expect(getDependencies(TrashService)).toEqual(['JobManager', 'FileManager'])
  })

  it('registers the trash.purge handler in onInit so startup recovery sees it', () => {
    drive(new TrashService()).onInit()

    expect(jobManager.registerHandler).toHaveBeenCalledExactlyOnceWith('trash.purge', trashPurgeJobHandler)
  })

  it('registers the daily schedule on first boot and never again once one exists', () => {
    // First boot: no persisted schedule → register.
    const first = drive(new TrashService())
    first.onInit()
    first.onReady()

    expect(jobManager.registerJobSchedule).toHaveBeenCalledExactlyOnceWith({
      type: 'trash.purge',
      trigger: { kind: 'cron', expr: '0 3 * * *' },
      jobInputTemplate: {},
      catchUpPolicy: { kind: 'after-startup', minutes: 3 }
    })

    // Simulated second boot: the schedule row persisted → getJobSchedule
    // returns a snapshot and registerJobSchedule must NOT insert another row.
    jobManager.registerJobSchedule.mockClear()
    jobManager.getJobSchedule.mockReturnValue({ id: 'schedule-1', type: 'trash.purge' })
    const second = drive(new TrashService())
    second.onInit()
    second.onReady()

    expect(jobManager.registerJobSchedule).not.toHaveBeenCalled()
  })

  it('purgeNow enqueues an emptyAll run and resolves with the terminal status', async () => {
    jobManager.enqueue.mockReturnValue({
      id: 'job-1',
      snapshot: { id: 'job-1', status: 'pending' },
      finished: Promise.resolve({ id: 'job-1', status: 'completed' })
    })

    const result = await new TrashService().purgeNow()

    expect(jobManager.enqueue).toHaveBeenCalledExactlyOnceWith('trash.purge', { emptyAll: true })
    expect(result).toEqual({ jobId: 'job-1', status: 'completed' })
  })

  it('purgeNow passes a failed terminal status through instead of masking it', async () => {
    jobManager.enqueue.mockReturnValue({
      id: 'job-2',
      snapshot: { id: 'job-2', status: 'pending' },
      finished: Promise.resolve({ id: 'job-2', status: 'failed' })
    })

    await expect(new TrashService().purgeNow()).resolves.toEqual({ jobId: 'job-2', status: 'failed' })
  })
})
