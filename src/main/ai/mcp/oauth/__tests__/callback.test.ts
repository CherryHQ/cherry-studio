import { EventEmitter } from 'events'
import type http from 'http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CallBackServer, OAuthCallbackTimeoutError } from '../callback'

class TestCallBackServer extends CallBackServer {
  override initialize(): Promise<http.Server> {
    return Promise.resolve({ close: vi.fn() } as unknown as http.Server)
  }
}

describe('CallBackServer.waitForAuthCode', () => {
  let events: EventEmitter
  let server: CallBackServer

  beforeEach(() => {
    vi.useFakeTimers()
    events = new EventEmitter()
    server = new TestCallBackServer({ port: 0, path: '/oauth/callback', events })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await server.close()
  })

  it('resolves with the code when auth-code-received fires before the timeout', async () => {
    const promise = server.waitForAuthCode(1000)

    events.emit('auth-code-received', 'the-auth-code')

    await expect(promise).resolves.toBe('the-auth-code')
  })

  it('rejects when no auth-code-received fires within the timeout', async () => {
    const promise = server.waitForAuthCode(1000)
    const assertion = expect(promise).rejects.toBeInstanceOf(OAuthCallbackTimeoutError)

    await vi.advanceTimersByTimeAsync(1000)

    await assertion
  })

  it('does not reject after resolving (timer is cleared on success)', async () => {
    const promise = server.waitForAuthCode(1000)
    events.emit('auth-code-received', 'first-code')

    await expect(promise).resolves.toBe('first-code')

    // Advancing past the original timeout must not trigger any late rejection,
    // and the listener must have been removed (no leak for a second emit).
    await vi.advanceTimersByTimeAsync(2000)
    expect(events.listenerCount('auth-code-received')).toBe(0)
  })
})
