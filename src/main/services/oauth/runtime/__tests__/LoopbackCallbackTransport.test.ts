import { beforeEach, describe, expect, it } from 'vitest'

import { LoopbackCallbackTransport } from '../LoopbackCallbackTransport'

const CONFIG = {
  hosts: ['127.0.0.1'],
  port: 0,
  path: '/callback',
  redirectUri: 'http://127.0.0.1/callback'
} as const

describe('LoopbackCallbackTransport', () => {
  let transport: LoopbackCallbackTransport

  beforeEach(() => {
    transport = new LoopbackCallbackTransport(CONFIG)
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
})
