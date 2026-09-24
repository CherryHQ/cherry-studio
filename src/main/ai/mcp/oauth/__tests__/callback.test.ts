import { EventEmitter } from 'events'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

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

  it('cancels authorization immediately and removes the callback waiter', async () => {
    const controller = new AbortController()
    const waiting = server.waitForAuthCallback(300_000, controller.signal)
    controller.abort(new Error('request cancelled'))
    await expect(waiting).rejects.toThrow('request cancelled')
    expect(events.listenerCount('auth-callback-received')).toBe(0)
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

  it('retains a callback received before the authorization-code waiter is attached', async () => {
    vi.useRealTimers()
    const listener = await server.getServer
    const { port } = listener.address() as AddressInfo
    const status = await new Promise<number | undefined>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/oauth/callback?code=early-code`, (response) => {
          response.resume()
          response.on('end', () => resolve(response.statusCode))
        })
        .on('error', reject)
    })

    expect(status).toBe(200)
    expect((await server.waitForAuthCallback(100)).get('code')).toBe('early-code')
  })

  it('close resolves when listen failed so a bind failure can reject first', async () => {
    const failed = new CallBackServer({ port: 99999, path: '/oauth/callback', events: new EventEmitter() })
    await expect(failed.getServer).rejects.toThrow()
    await expect(failed.close()).resolves.toBeUndefined()
  })
})
