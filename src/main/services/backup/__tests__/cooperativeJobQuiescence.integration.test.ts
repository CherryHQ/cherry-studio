import { application } from '@application'
import { JobManager } from '@main/core/job/JobManager'
import type { CooperativeJobHandler } from '@main/core/job/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceExport } from '@test-mocks/main/CacheService'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { describe, expect, it, vi } from 'vitest'

import { captureSealedProfileView } from '../exportQuiesce'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'backup.cooperative-test': Record<string, never>
  }
}

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

function makeGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

function createDrainableParticipant() {
  return {
    pause: vi.fn(() => ({ dispose: vi.fn() })),
    drainInFlight: vi.fn(async () => ({ stragglerIds: [] as string[] }))
  }
}

describe('backup export with cooperative jobs', () => {
  setupTestDatabase()

  it('seals while an execution is parked and resumes it only after the hold releases', async () => {
    BaseService.resetInstances()
    const scheduler = new SchedulerService()
    const jobManager = new JobManager()
    const channel = {
      ...createDrainableParticipant(),
      pauseAdapterRuntime: vi.fn(() => ({ dispose: vi.fn() })),
      drainAdapterRuntimeInFlight: vi.fn(async () => ({ stragglerIds: [] as string[] }))
    }
    const ai = createDrainableParticipant()
    const agent = createDrainableParticipant()
    const warmQuery = createDrainableParticipant()
    const profileWrites = createDrainableParticipant()
    const mcp = createDrainableParticipant()

    ;(application.get as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
      switch (name) {
        case 'DbService':
          return MockMainDbServiceExport.dbService
        case 'CacheService':
          return MockMainCacheServiceExport.cacheService
        case 'SchedulerService':
          return scheduler
        case 'JobManager':
          return jobManager
        case 'PowerService':
          return { preventSleep: () => ({ dispose: () => {} }) }
        case 'ChannelManager':
          return channel
        case 'AiStreamManager':
          return ai
        case 'AgentSessionRuntimeService':
          return agent
        case 'ClaudeCodeWarmQueryManager':
          return warmQuery
        case 'ProfileWriteBarrierService':
          return profileWrites
        case 'McpRuntimeService':
          return mcp
      }
      throw new Error(`Unexpected application.get('${name}')`)
    })

    const beforeSafePoint = makeGate()
    const afterSafePoint = makeGate()
    const state = { entered: 0, leftSafePoint: 0, completed: 0 }
    const handler: CooperativeJobHandler<Record<string, never>> = {
      recovery: 'retry',
      quiescence: 'cooperative',
      async execute(ctx) {
        state.entered++
        await beforeSafePoint.promise
        await ctx.quiesceAtSafePoint()
        state.leftSafePoint++
        await afterSafePoint.promise
        state.completed++
      }
    }

    jobManager.registerHandler('backup.cooperative-test', handler)
    await scheduler._doInit()
    await jobManager._doInit()

    const handle = jobManager.enqueue('backup.cooperative-test', {})
    let settled = false
    void handle.finished.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(state.entered).toBe(1))

    const pauseSpy = vi.spyOn(jobManager, 'pause')
    let capture:
      | Promise<{
          snapshot: string
          baseline: string
        }>
      | undefined
    try {
      capture = captureSealedProfileView({
        timeoutMs: 1000,
        createSnapshot: () => {
          expect(state.leftSafePoint).toBe(0)
          expect(settled).toBe(false)
        },
        inspectSnapshot: () => 'detached-db',
        captureBaseline: () => {
          expect(state.leftSafePoint).toBe(0)
          expect(settled).toBe(false)
          return 'resource-baseline'
        }
      })

      await vi.waitFor(() => expect(pauseSpy).toHaveBeenCalledTimes(1))
      beforeSafePoint.release()

      await expect(capture).resolves.toEqual({
        snapshot: 'detached-db',
        baseline: 'resource-baseline'
      })
      await vi.waitFor(() => expect(state.leftSafePoint).toBe(1))
      expect(settled).toBe(false)

      afterSafePoint.release()
      await expect(handle.finished).resolves.toMatchObject({ status: 'completed' })
      expect(state.completed).toBe(1)
    } finally {
      beforeSafePoint.release()
      afterSafePoint.release()
      await capture?.catch(() => undefined)
      await handle.finished
      await jobManager._doStop()
      await scheduler._doStop()
    }
  })
})
