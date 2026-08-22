import { EventEmitter } from 'events'
import type http from 'http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CallBackServer, OAuthCallbackTimeoutError } from '../callback'

class TestCallBackServer extends CallBackServer {
  override initialize(): Promise<http.Server> {
    return Promise.resolve({ close: vi.fn() } as unknown as http.Server)
  }
}

class FailingCallBackServer extends CallBackServer {
  override initialize(): Promise<http.Server> {
    return Promise.reject(new Error('callback server failed to listen'))
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

  it('rejects and removes the listener when the callback server fails to listen', async () => {
    server = new FailingCallBackServer({ port: 0, path: '/oauth/callback', events })

    await expect(server.waitForAuthCode(1000)).rejects.toThrow('callback server failed to listen')
    expect(events.listenerCount('auth-code-received')).toBe(0)
    await expect(server.close()).resolves.toBeUndefined()
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

  it('rejects and removes the listener when aborted', async () => {
    const controller = new AbortController()
    const reason = new Error('callback wait cancelled')
    const promise = server.waitForAuthCode(1000, controller.signal)
    const assertion = expect(promise).rejects.toBe(reason)

    controller.abort(reason)

    await assertion
    expect(events.listenerCount('auth-code-received')).toBe(0)
  })
})
