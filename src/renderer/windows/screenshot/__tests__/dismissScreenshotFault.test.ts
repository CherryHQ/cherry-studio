import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => request(...args) }
}))

import { dismissScreenshotFault } from '../ScreenshotApp'

function channels(): string[] {
  return request.mock.calls.map(([channel]) => channel as string)
}

describe('dismissScreenshotFault', () => {
  beforeEach(() => {
    request.mockReset().mockResolvedValue(undefined)
  })

  it('hands the original fault to main and then releases the overlay', async () => {
    await dismissScreenshotFault(new Error('overlay boom'))

    expect(channels()).toEqual(['app.error.handoff', 'screenshot.cancel'])
    expect(request.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        source: 'screenshotWindow',
        operation: 'react.render',
        message: 'overlay boom',
        name: 'Error'
      })
    )
  })

  it('still releases the overlay when handoff and the local dialog both fail', async () => {
    request.mockImplementation((channel: string) => {
      if (channel === 'screenshot.cancel') return Promise.reject(new Error('cancel failed'))
      return Promise.reject(new Error(`${channel} failed`))
    })

    await expect(dismissScreenshotFault(new Error('overlay boom'))).resolves.toBeUndefined()
    expect(channels()).toEqual(['app.error.handoff', 'screenshot.cancel', 'app.error.degraded'])
  })
})
