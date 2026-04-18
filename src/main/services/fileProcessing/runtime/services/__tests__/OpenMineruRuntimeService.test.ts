import { BaseService, getDependencies, LifecycleEvents, LifecycleManager, ServiceContainer } from '@main/core/lifecycle'
import { Phase } from '@main/core/lifecycle/types'
import { afterEach, describe, expect, it } from 'vitest'

import { FileProcessingRuntimeService } from '../FileProcessingRuntimeService'
import { OpenMineruRuntimeService } from '../OpenMineruRuntimeService'

describe('OpenMineruRuntimeService', () => {
  let service: OpenMineruRuntimeService | undefined

  afterEach(async () => {
    if (service && !service.isStopped && !service.isDestroyed) {
      await service._doStop()
    }
    LifecycleManager.reset()
    ServiceContainer.reset()
    BaseService.resetInstances()
  })

  it('declares FileProcessingRuntimeService as a lifecycle dependency', () => {
    expect(getDependencies(OpenMineruRuntimeService)).toContain('FileProcessingRuntimeService')
  })

  it('aborts and awaits in-flight tasks on stop', async () => {
    service = new OpenMineruRuntimeService()
    await service._doInit()

    let aborted = false
    let settled = false

    service.startTask(
      'task-1',
      (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              settled = true
              resolve()
            },
            { once: true }
          )
        })
    )

    await service._doStop()

    expect(aborted).toBe(true)
    expect(settled).toBe(true)
  })

  it('stops before FileProcessingRuntimeService during lifecycle cascade', async () => {
    const manager = LifecycleManager.getInstance()
    const container = ServiceContainer.getInstance()
    const stopOrder: string[] = []

    container.register(FileProcessingRuntimeService)
    container.register(OpenMineruRuntimeService)

    await manager.startPhase(Phase.BeforeReady)

    const runtimeService = container.getInstance('FileProcessingRuntimeService')
    const openMineruRuntimeService = container.getInstance('OpenMineruRuntimeService')

    expect(runtimeService).toBeDefined()
    expect(openMineruRuntimeService).toBeDefined()
    manager.on(LifecycleEvents.SERVICE_STOPPING, ({ name }) => {
      if (name === 'OpenMineruRuntimeService' || name === 'FileProcessingRuntimeService') {
        stopOrder.push(name)
      }
    })

    await manager.stop('FileProcessingRuntimeService')

    expect(stopOrder).toEqual(['OpenMineruRuntimeService', 'FileProcessingRuntimeService'])
  })
})
