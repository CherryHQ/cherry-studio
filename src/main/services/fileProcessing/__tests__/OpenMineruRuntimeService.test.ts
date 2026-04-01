import { describe, expect, it } from 'vitest'

import { OpenMineruRuntimeService } from '../OpenMineruRuntimeService'

describe('OpenMineruRuntimeService', () => {
  it('aborts and awaits in-flight tasks on stop', async () => {
    const service = new OpenMineruRuntimeService()
    await (service as any).onInit()
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

    await (service as any).onStop()

    expect(aborted).toBe(true)
    expect(settled).toBe(true)
  })
})
