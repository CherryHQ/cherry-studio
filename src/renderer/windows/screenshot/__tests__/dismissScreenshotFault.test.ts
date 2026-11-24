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

  it('sends the fault and the teardown in one request, so closing the overlay cannot strand the fallback', async () => {
    await dismissScreenshotFault(new Error('overlay boom'))

    expect(channels()).toEqual(['screenshot.fail'])
    expect(request.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        source: 'screenshotWindow',
        operation: 'react.render',
        message: 'overlay boom',
        name: 'Error'
      })
    )
  })

  it('resolves when main cannot be reached', async () => {
    request.mockRejectedValue(new Error('ipc failed'))

    await expect(dismissScreenshotFault(new Error('overlay boom'))).resolves.toBeUndefined()
  })

  it('reports a thrown null-prototype object', async () => {
    const thrown = Object.assign(Object.create(null), { message: 'no prototype' })

    await expect(dismissScreenshotFault(thrown)).resolves.toBeUndefined()
    expect(channels()).toEqual(['screenshot.fail'])
  })
})
