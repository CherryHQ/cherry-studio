import { describe, expect, it } from 'vitest'

import { rejectionOf } from './hostTestUtils'

describe('rejectionOf', () => {
  it('returns the rejection reason', async () => {
    const reason = new Error('boom')
    await expect(rejectionOf(Promise.reject(reason))).resolves.toBe(reason)
  })

  it('fails instead of passing a resolution off as a rejection', async () => {
    // Five suites assert on its return value; swallowing a resolution would certify the very
    // bugs they exist to catch.
    await expect(rejectionOf(Promise.resolve('pong'))).rejects.toThrow('expected rejection, got "pong"')
  })
})
