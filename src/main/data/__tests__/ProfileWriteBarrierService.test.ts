import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'

import { BaseService } from '@main/core/lifecycle/BaseService'
import { getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProfileWriteBarrierService } from '../ProfileWriteBarrierService'

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('ProfileWriteBarrierService', () => {
  let service: ProfileWriteBarrierService

  beforeEach(async () => {
    BaseService.resetInstances()
    service = new ProfileWriteBarrierService()
    await service._doInit()
  })

  afterEach(() => {
    vi.useRealTimers()
    BaseService.resetInstances()
  })

  it('is registered as a BeforeReady lifecycle service', () => {
    const registrySource = readFileSync(resolve(__dirname, '../../core/application/serviceRegistry.ts'), 'utf8')

    expect(getPhase(ProfileWriteBarrierService)).toBe(Phase.BeforeReady)
    expect(registrySource).toContain("import { ProfileWriteBarrierService } from '@data/ProfileWriteBarrierService'")
    expect(registrySource).toMatch(/^ {2}ProfileWriteBarrierService,$/m)
  })

  it('tracks an acquired lease until its idempotent disposal', async () => {
    const lease = await service.acquireWriteLease('file-storage:upload')

    expect(service.listActiveWork()).toHaveLength(1)
    expect(service.listActiveWork()[0]).toMatchObject({
      id: lease.id,
      summary: expect.stringContaining('file-storage:upload')
    })

    lease.dispose()
    lease.dispose()
    expect(service.listActiveWork()).toEqual([])
  })

  it.each(['finish', 'abort'] as const)('keeps a write-stream lease until %s', async (outcome) => {
    const stream = new PassThrough()
    stream.resume()
    const lease = await service.acquireWriteLease(`stream:${outcome}`)
    if (outcome === 'finish') stream.once('finish', () => lease.dispose())
    else stream.once('close', () => lease.dispose())
    const hold = service.pause('backup')
    const drain = service.drainInFlight({ timeoutMs: 1_000 })

    if (outcome === 'finish') stream.end('payload')
    else stream.destroy()

    await expect(drain).resolves.toEqual({ stragglerIds: [] })
    expect(service.listActiveWork()).toEqual([])
    hold.dispose()
  })

  it('queues paused writes outside the in-flight set and admits them after the final hold releases', async () => {
    const first = service.pause('backup')
    const second = service.pause('diagnostics')
    const started: string[] = []

    const firstWrite = service.runWrite('preference:set:first', () => {
      started.push('first')
    })
    const secondWrite = service.runWrite('preference:set:second', () => {
      started.push('second')
    })
    await Promise.resolve()

    expect(started).toEqual([])
    expect(service.listActiveWork()).toEqual([])
    await expect(service.drainInFlight({ timeoutMs: 10 })).resolves.toEqual({ stragglerIds: [] })
    first.dispose()
    await Promise.resolve()
    expect(started).toEqual([])

    second.dispose()
    await Promise.all([firstWrite, secondWrite])
    expect(started).toEqual(['first', 'second'])
  })

  it('allows an admitted write to make reentrant calls after pause without creating another lease', async () => {
    const continueOuter = deferred()
    const running = service.runWrite('data-api:POST /topics', async () => {
      await continueOuter.promise
      return service.runWrite('preference:set:app.language', () => 'nested-result')
    })

    expect(service.listActiveWork()).toHaveLength(1)
    const hold = service.pause('backup')
    continueOuter.resolve()

    await expect(running).resolves.toBe('nested-result')
    expect(service.listActiveWork()).toEqual([])
    hold.dispose()
  })

  it('keeps the outer lease alive for a reentrant operation the caller did not await', async () => {
    const finishNested = deferred()
    const nestedStarted = deferred()
    let outerSettled = false

    const running = service
      .runWrite('data-api:POST /topics', async () => {
        void service.runWrite('preference:set:app.language', async () => {
          nestedStarted.resolve()
          await finishNested.promise
        })
      })
      .finally(() => {
        outerSettled = true
      })

    await nestedStarted.promise
    await Promise.resolve()
    expect(outerSettled).toBe(false)
    expect(service.listActiveWork()).toHaveLength(1)

    finishNested.resolve()
    await running
    expect(service.listActiveWork()).toEqual([])
  })

  it('drains writes admitted before pause', async () => {
    const finish = deferred()
    const running = service.runWrite('preference:set', () => finish.promise)
    const hold = service.pause('backup')

    let drained = false
    const drain = service.drainInFlight({ timeoutMs: 1_000 }).then((result) => {
      drained = true
      return result
    })

    await Promise.resolve()
    expect(drained).toBe(false)

    finish.resolve()
    await expect(drain).resolves.toEqual({ stragglerIds: [] })
    await running
    hold.dispose()
  })

  it('reports, but does not abort, writes that exceed the drain timeout', async () => {
    vi.useFakeTimers()
    const finish = deferred()
    const running = service.runWrite('file-storage:upload', () => finish.promise)
    const [active] = service.listActiveWork()
    const hold = service.pause('backup')

    const drain = service.drainInFlight({ timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(50)

    await expect(drain).resolves.toEqual({ stragglerIds: [active.id] })
    expect(service.listActiveWork()).toHaveLength(1)

    finish.resolve()
    await running
    hold.dispose()
  })

  it('keeps admission closed after shutdown even when pause holds are released', async () => {
    const hold = service.pause('backup')
    const queued = service.runWrite('preference:set', () => undefined)
    await Promise.resolve()

    service.shutdown()
    hold.dispose()

    expect(service.isWriteQuiesced).toBe(true)
    await expect(queued).rejects.toThrow('Profile writes are unavailable during shutdown')
    await expect(service.runWrite('preference:set', () => undefined)).rejects.toThrow(
      'Profile writes are unavailable during shutdown'
    )
  })

  it('does not abort an active write during shutdown', async () => {
    const finish = deferred()
    const running = service.runWrite('file-storage:upload', async () => {
      await finish.promise
      return 'completed'
    })
    await Promise.resolve()
    expect(service.listActiveWork()).toHaveLength(1)

    service.shutdown()
    finish.resolve()

    await expect(running).resolves.toBe('completed')
    expect(service.listActiveWork()).toEqual([])
  })
})
