import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = vi.fn()

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => request(...args) }
}))

import { appErrorContextSchema } from '@shared/utils/appError'

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

  it('sends a report main accepts when the error carries non-string fields', async () => {
    const thrown = new Error('overlay boom')
    Object.defineProperty(thrown, 'stack', { value: ['frame 1', 'frame 2'] })
    Object.defineProperty(thrown, 'name', { value: 42 })
    Object.defineProperty(thrown, 'message', { value: { detail: 'not a string' } })

    await dismissScreenshotFault(thrown)

    expect(appErrorContextSchema.safeParse(request.mock.calls[0][1]).success).toBe(true)
  })

  it('still cancels the session when main rejects the report', async () => {
    request.mockImplementation(async (channel: string) => {
      if (channel === 'screenshot.fail') throw new Error('invalid input')
    })

    await dismissScreenshotFault(new Error('overlay boom'))

    expect(channels()).toEqual(['screenshot.fail', 'screenshot.cancel'])
  })
})
