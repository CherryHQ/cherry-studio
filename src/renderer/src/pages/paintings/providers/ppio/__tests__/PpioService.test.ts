import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PpioService from '../service'

describe('PpioService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('stops polling immediately when the request is aborted', async () => {
    const service = new PpioService('token')
    const controller = new AbortController()
    const getTaskResultSpy = vi.spyOn(service, 'getTaskResult').mockResolvedValue({
      task: {
        task_id: 'task-1',
        status: 'TASK_STATUS_PROCESSING',
        task_type: 'image'
      },
      images: []
    })

    const pollingPromise = service.pollTaskResult('task-1', {
      signal: controller.signal
    })

    await Promise.resolve()
    controller.abort()

    await expect(pollingPromise).rejects.toMatchObject({ name: 'AbortError', message: 'Task polling aborted' })

    await vi.advanceTimersByTimeAsync(15000)
    expect(getTaskResultSpy).toHaveBeenCalledTimes(1)
  })
})
