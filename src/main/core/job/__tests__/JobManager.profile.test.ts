import { BaseService } from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { JobManager } from '../JobManager'

beforeEach(() => {
  BaseService.resetInstances()
})

describe('JobManager profile activation', () => {
  it('pauses on deactivate (no in-flight) and un-pauses on activate', async () => {
    const svc = new JobManager()
    await svc.onProfileDeactivate()
    expect(svc['_profilePaused']).toBe(true)
    svc.onProfileActivate()
    expect(svc['_profilePaused']).toBe(false)
  })

  it('recoverActiveProfile runs the startup recovery flow', async () => {
    const svc = new JobManager()
    const flow = vi
      .spyOn(svc as unknown as { runStartupRecoveryFlow: () => Promise<void> }, 'runStartupRecoveryFlow')
      .mockResolvedValue(undefined)
    await svc.recoverActiveProfile()
    expect(flow).toHaveBeenCalledTimes(1)
  })

  it('waits for a recovery-dispatched in-flight job (inFlightExecuted, no finishedResolver) before returning', async () => {
    const svc = new JobManager()
    const jobId = 'recovery-job'
    let releaseExecuted!: () => void
    const executed = new Promise<void>((resolve) => {
      releaseExecuted = resolve
    })
    // A recovery-dispatched job populates abortControllers + inFlightExecuted but NEVER
    // finishedResolvers — draining on finishedResolvers would settle instantly and let its
    // finalizeJob write into the next profile's DB after the switch.
    svc['abortControllers'].set(jobId, new AbortController())
    svc['inFlightExecuted'].set(jobId, executed)

    let settled = false
    const deactivate = svc.onProfileDeactivate().then(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    // Must still be waiting on the executing handler, not returned.
    expect(settled).toBe(false)

    releaseExecuted()
    await deactivate
    expect(settled).toBe(true)
  })

  it('does not dispatch new jobs while paused for a profile switch (no job escapes the deactivate drain)', async () => {
    const svc = new JobManager()
    svc['_profilePaused'] = true
    // The guard is the first statement in dispatch(), so it returns before even looking
    // up the queue — an aborted job's re-dispatch during the drain claims nothing.
    const queuesGet = vi.spyOn(svc['queues'], 'get')
    await svc.dispatch('default')
    expect(queuesGet).not.toHaveBeenCalled()
  })

  it('disposes pending job:*/retry:* once-timers on deactivate so they cannot fire against the next profile', async () => {
    const svc = new JobManager()
    const dispose = vi.fn()
    ;(svc['onceDisposables'] as Map<string, { dispose: () => void }>).set('job:x', { dispose })

    await svc.onProfileDeactivate()

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(svc['onceDisposables'].size).toBe(0)
  })
})
