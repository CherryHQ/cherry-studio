import { createDisposableTimeoutSignal, IdleTimeoutController } from '@shared/utils/async'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '../BaseService'

afterEach(() => vi.useRealTimers())

describe('async resources in the service lifecycle', () => {
  it('releases deadlines on stop and creates fresh resources on restart', async () => {
    vi.useFakeTimers()
    class DeadlineService extends BaseService {
      idle!: IdleTimeoutController
      deadline!: ReturnType<typeof createDisposableTimeoutSignal>

      protected override onInit(): void {
        this.idle = this.registerDisposable(new IdleTimeoutController(100))
        this.deadline = this.registerDisposable(createDisposableTimeoutSignal(100, () => new Error('deadline')))
      }
    }
    const service = new DeadlineService()
    await service._doInit()
    const previousIdle = service.idle
    const previousDeadline = service.deadline
    await service._doStop()
    previousIdle.reset()
    await vi.advanceTimersByTimeAsync(200)
    expect(previousIdle.signal.aborted).toBe(false)
    expect(previousDeadline.signal.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    await service._doInit()
    await vi.advanceTimersByTimeAsync(100)
    expect(service.idle.signal.reason).toMatchObject({ name: 'TimeoutError' })
    expect(service.deadline.signal.reason).toEqual(new Error('deadline'))
    expect(previousIdle.signal.aborted).toBe(false)
    expect(previousDeadline.signal.aborted).toBe(false)
    await service._doDestroy()
  })
})
