import { BaseService, getDependencies, LifecycleEvents, LifecycleManager, ServiceContainer } from '@main/core/lifecycle'
import { Phase } from '@main/core/lifecycle/types'
import { afterEach, describe, expect, it } from 'vitest'

import { Doc2xRuntimeService } from '../Doc2xRuntimeService'
import { FileProcessingRuntimeService } from '../FileProcessingRuntimeService'

describe('Doc2xRuntimeService', () => {
  let service: Doc2xRuntimeService | undefined

  afterEach(async () => {
    if (service && !service.isStopped && !service.isDestroyed) {
      await service._doStop()
    }
    LifecycleManager.reset()
    ServiceContainer.reset()
    BaseService.resetInstances()
  })

  it('declares FileProcessingRuntimeService as a lifecycle dependency', () => {
    expect(getDependencies(Doc2xRuntimeService)).toContain('FileProcessingRuntimeService')
  })

  it('deduplicates concurrent queries for the same provider task id', async () => {
    service = new Doc2xRuntimeService()
    await service._doInit()

    let callCount = 0
    let resolveQuery: ((value: { status: 'processing'; progress: 50; processorId: 'doc2x' }) => void) | undefined

    const firstPromise = service.runDedupedQuery(
      'task-1',
      () =>
        new Promise((resolve) => {
          callCount += 1
          resolveQuery = resolve
        })
    )
    const secondPromise = service.runDedupedQuery(
      'task-1',
      () =>
        new Promise(() => {
          callCount += 1
        })
    )

    expect(callCount).toBe(1)

    resolveQuery?.({
      status: 'processing',
      progress: 50,
      processorId: 'doc2x'
    })

    await expect(firstPromise).resolves.toEqual({
      status: 'processing',
      progress: 50,
      processorId: 'doc2x'
    })
    await expect(secondPromise).resolves.toEqual({
      status: 'processing',
      progress: 50,
      processorId: 'doc2x'
    })
  })

  it('aborts and awaits in-flight queries on stop', async () => {
    service = new Doc2xRuntimeService()
    await service._doInit()

    let aborted = false
    let settled = false

    void service.runDedupedQuery('task-2', (signal) => {
      return new Promise((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
            settled = true
            resolve({
              status: 'failed',
              progress: 0,
              processorId: 'doc2x',
              error: 'stopped'
            })
          },
          { once: true }
        )
      })
    })

    await service._doStop()

    expect(aborted).toBe(true)
    expect(settled).toBe(true)
  })

  it('stops during BeforeReady lifecycle shutdown', async () => {
    const manager = LifecycleManager.getInstance()
    const container = ServiceContainer.getInstance()
    const stopOrder: string[] = []

    container.register(FileProcessingRuntimeService)
    container.register(Doc2xRuntimeService)

    await manager.startPhase(Phase.BeforeReady)

    expect(container.getInstance('FileProcessingRuntimeService')).toBeDefined()
    expect(container.getInstance('Doc2xRuntimeService')).toBeDefined()

    manager.on(LifecycleEvents.SERVICE_STOPPING, ({ name }) => {
      if (name === 'Doc2xRuntimeService') {
        stopOrder.push(name)
      }
    })

    await manager.stop('Doc2xRuntimeService')

    expect(stopOrder).toEqual(['Doc2xRuntimeService'])
  })

  it('stops before FileProcessingRuntimeService during lifecycle cascade', async () => {
    const manager = LifecycleManager.getInstance()
    const container = ServiceContainer.getInstance()
    const stopOrder: string[] = []

    container.register(FileProcessingRuntimeService)
    container.register(Doc2xRuntimeService)

    await manager.startPhase(Phase.BeforeReady)

    const runtimeService = container.getInstance('FileProcessingRuntimeService')
    const doc2xRuntimeService = container.getInstance('Doc2xRuntimeService')

    expect(runtimeService).toBeDefined()
    expect(doc2xRuntimeService).toBeDefined()

    manager.on(LifecycleEvents.SERVICE_STOPPING, ({ name }) => {
      if (name === 'Doc2xRuntimeService' || name === 'FileProcessingRuntimeService') {
        stopOrder.push(name)
      }
    })

    await manager.stop('FileProcessingRuntimeService')

    expect(stopOrder).toEqual(['Doc2xRuntimeService', 'FileProcessingRuntimeService'])
  })
})
