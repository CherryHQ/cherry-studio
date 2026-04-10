import { describe, expect, it, vi } from 'vitest'

import { assertTaskActive, runAbortable, SHUTDOWN_INTERRUPTED_REASON } from '../taskRuntime'

describe('taskRuntime', () => {
  it('runs active work and returns the step result', async () => {
    const step = vi.fn(async () => 'done')

    await expect(
      runAbortable(() => false, { itemId: 'item-1', signal: new AbortController().signal }, step)
    ).resolves.toBe('done')
    expect(step).toHaveBeenCalledTimes(1)
  })

  it('throws the abort reason when the signal was aborted', () => {
    const controller = new AbortController()
    controller.abort('Knowledge task interrupted by item deletion')

    expect(() => assertTaskActive(() => false, { itemId: 'item-1', signal: controller.signal })).toThrow(
      'Knowledge task interrupted by item deletion'
    )
  })

  it('throws the shutdown reason before invoking the step when stopping', async () => {
    const step = vi.fn(async () => 'done')

    await expect(
      runAbortable(() => true, { itemId: 'item-1', signal: new AbortController().signal }, step)
    ).rejects.toThrow(SHUTDOWN_INTERRUPTED_REASON)
    expect(step).not.toHaveBeenCalled()
  })

  it('rechecks the stopping state after the step instead of using a stale snapshot', async () => {
    let stopping = false

    await expect(
      runAbortable(
        () => stopping,
        { itemId: 'item-1', signal: new AbortController().signal },
        async () => {
          stopping = true
          return 'done'
        }
      )
    ).rejects.toThrow(SHUTDOWN_INTERRUPTED_REASON)
  })
})
