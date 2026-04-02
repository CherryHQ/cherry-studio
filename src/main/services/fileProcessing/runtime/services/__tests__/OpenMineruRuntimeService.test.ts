import { BaseService } from '@main/core/lifecycle'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { OpenMineruRuntimeService } from '../OpenMineruRuntimeService'

describe('OpenMineruRuntimeService', () => {
  let service: OpenMineruRuntimeService

  beforeEach(async () => {
    service = new OpenMineruRuntimeService()
    await service._doInit()
  })

  afterEach(async () => {
    if (!service.isStopped && !service.isDestroyed) {
      await service._doStop()
    }
    BaseService.resetInstances()
  })

  it('aborts and awaits in-flight tasks on stop', async () => {
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
})
