import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { oauthWithCherryIn } from '../oauth'

const mocks = vi.hoisted(() => ({
  listener: undefined as ((result: { state: string; apiKeys: string }) => void) | undefined,
  removeListener: vi.fn(),
  request: vi.fn()
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key },
  getLanguageCode: vi.fn().mockResolvedValue('en-us')
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mocks.request(...args),
    on: (_route: string, listener: (result: { state: string; apiKeys: string }) => void) => {
      mocks.listener = listener
      return mocks.removeListener
    }
  }
}))

describe('oauthWithCherryIn', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listener = undefined
    mocks.request.mockImplementation(async (route: string) => {
      if (route === 'oauth.start_deep_link_flow') {
        return { authUrl: 'https://example.com/authorize', state: 'state-1' }
      }
      if (route === 'oauth.cancel_deep_link_flow') return undefined
      throw new Error(`Unexpected route: ${route}`)
    })
    vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  it('cancels the main-process deep-link request and removes its listener when aborted', async () => {
    const controller = new AbortController()
    const result = oauthWithCherryIn(vi.fn(), {
      oauthServer: 'https://example.com',
      signal: controller.signal
    })

    await waitFor(() => expect(mocks.listener).toBeDefined())
    controller.abort()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.removeListener).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('oauth.cancel_deep_link_flow', {
        providerId: 'cherryin',
        state: 'state-1'
      })
    )
  })

  it('cancels the main-process deep-link request when the renderer wait times out', async () => {
    vi.useFakeTimers()
    const result = oauthWithCherryIn(vi.fn(), { oauthServer: 'https://example.com' })
    const rejection = expect(result).rejects.toThrow('OAuth flow timed out')

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

    await rejection
    expect(mocks.removeListener).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledWith('oauth.cancel_deep_link_flow', {
      providerId: 'cherryin',
      state: 'state-1'
    })
  })
})
