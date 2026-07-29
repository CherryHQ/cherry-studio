import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CallBackServer } from '../callback'

describe('CallBackServer.waitForAuthCallback', () => {
  let events: EventEmitter
  let server: CallBackServer

  beforeEach(() => {
    vi.useFakeTimers()
    events = new EventEmitter()
    // Port 0 lets the OS pick a free ephemeral port, so the real HTTP server in
    // the constructor never collides with another test or a running app.
    server = new CallBackServer({ port: 0, path: '/oauth/callback', events })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await server.close()
  })

  it('resolves with all callback parameters before the timeout', async () => {
    const promise = server.waitForAuthCallback(1000)

    events.emit('auth-callback-received', new URLSearchParams('code=the-auth-code&iss=https%3A%2F%2Fissuer&state=s'))

    const params = await promise
    expect(Object.fromEntries(params)).toEqual({
      code: 'the-auth-code',
      iss: 'https://issuer',
      state: 's'
    })
  })

  it('rejects when no callback arrives within the timeout', async () => {
    const promise = server.waitForAuthCallback(1000)
    const assertion = expect(promise).rejects.toThrow(/Timed out waiting for OAuth callback/)

    await vi.advanceTimersByTimeAsync(1000)

    await assertion
  })

  it('does not reject after resolving (timer is cleared on success)', async () => {
    const promise = server.waitForAuthCallback(1000)
    events.emit('auth-callback-received', new URLSearchParams('code=first-code'))

    await expect(promise).resolves.toBeInstanceOf(URLSearchParams)

    // Advancing past the original timeout must not trigger any late rejection,
    // and the listener must have been removed (no leak for a second emit).
    await vi.advanceTimersByTimeAsync(2000)
    expect(events.listenerCount('auth-callback-received')).toBe(0)
  })
})
