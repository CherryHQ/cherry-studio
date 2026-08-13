import type { Server } from 'node:http'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LoopbackCallbackTransport } from '../LoopbackCallbackTransport'

const CONFIG = {
  hosts: ['127.0.0.1'],
  port: 0, // ephemeral — read the bound port off the live server
  path: '/callback',
  redirectUri: 'http://127.0.0.1/callback'
} as const

/** Wait for the transport's loopback server to bind, then return its port. */
async function activePort(transport: LoopbackCallbackTransport): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const server = (transport as unknown as { activeServers: Server[] }).activeServers[0]
    const addr = server?.address()
    if (addr && typeof addr === 'object') return addr.port
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('callback server did not start listening')
}

describe('LoopbackCallbackTransport', () => {
  let transport: LoopbackCallbackTransport

  beforeEach(() => {
    transport = new LoopbackCallbackTransport(CONFIG)
  })

  afterEach(() => {
    transport.close()
  })

  // Guards W2: a second sign-in must not slip past while one is in progress.
  // tryAcquire is the *synchronous* reservation the service does before its
  // first await, closing the check-then-await race that let a double-click kill
  // the first flow.
  it('tryAcquire reserves exclusively until close', () => {
    expect(transport.isActive).toBe(false)
    expect(transport.tryAcquire()).toBe(true)
    expect(transport.isActive).toBe(true)
    // A concurrent sign-in is rejected.
    expect(transport.tryAcquire()).toBe(false)

    transport.close()
    expect(transport.isActive).toBe(false)
    // After the first flow ends the transport is reusable.
    expect(transport.tryAcquire()).toBe(true)
  })

  it('resolves with the authorization code when the callback state matches', async () => {
    const promise = transport.waitForAuthorizationCode('expected', AbortSignal.timeout(5000))
    const port = await activePort(transport)

    const res = await fetch(`http://127.0.0.1:${port}/callback?code=the-code&state=expected`)
    expect(res.status).toBe(200)
    await expect(promise).resolves.toBe('the-code')
  })

  it('rejects on a state mismatch (CSRF guard)', async () => {
    const promise = transport.waitForAuthorizationCode('expected', AbortSignal.timeout(5000))
    const port = await activePort(transport)

    // Attach the rejection handler before triggering the callback — the reject
    // fires during the fetch round-trip, so awaiting after would flag it unhandled.
    const rejection = expect(promise).rejects.toThrow(/state mismatch/)
    await fetch(`http://127.0.0.1:${port}/callback?code=x&state=forged`)
    await rejection
  })

  it('rejects when the provider returns an error', async () => {
    const promise = transport.waitForAuthorizationCode('expected', AbortSignal.timeout(5000))
    const port = await activePort(transport)

    const rejection = expect(promise).rejects.toThrow(/access_denied/)
    await fetch(`http://127.0.0.1:${port}/callback?error=access_denied&state=expected`)
    await rejection
  })

  it('returns 404 for an unknown path without settling', async () => {
    const promise = transport.waitForAuthorizationCode('expected', AbortSignal.timeout(5000))
    const port = await activePort(transport)

    const res = await fetch(`http://127.0.0.1:${port}/nope`)
    expect(res.status).toBe(404)

    // Still pending — drive the real callback so the promise settles and cleans up.
    await fetch(`http://127.0.0.1:${port}/callback?code=ok&state=expected`)
    await expect(promise).resolves.toBe('ok')
  })

  // Regression for W1/#5: AbortSignal.timeout has no cancel, so a finished
  // flow's 10-min timer eventually fires. It must NOT close the shared
  // transport's *next* sign-in. The `settled` latch makes the stale abort a
  // no-op; without it, abort() here would tear down flow 2's server.
  it('a settled flow does not let its stale timeout tear down a later sign-in', async () => {
    const stale = new AbortController()
    const first = transport.waitForAuthorizationCode('s1', stale.signal)
    const port1 = await activePort(transport)
    await fetch(`http://127.0.0.1:${port1}/callback?code=c1&state=s1`)
    expect(await first).toBe('c1')
    transport.close() // mirrors the service's finally after a successful flow

    const second = transport.waitForAuthorizationCode('s2', AbortSignal.timeout(5000))
    const port2 = await activePort(transport)
    stale.abort() // flow 1's stale timeout fires — must be a no-op

    const res = await fetch(`http://127.0.0.1:${port2}/callback?code=c2&state=s2`)
    expect(res.status).toBe(200)
    expect(await second).toBe('c2')
  })
})
