import { describe, expect, it } from 'vitest'

import { expectRejected } from './hostTestUtils'

describe('expectRejected', () => {
  it.each([new Error('boom'), undefined, 'cancelled', { reason: 'caller' }])(
    'inspects the original rejection reason: %j',
    async (reason) => {
      expect.assertions(1)
      await expectRejected(Promise.reject(reason), (error) => expect(error).toBe(reason))
    }
  )

  it('fails instead of passing a resolution off as a rejection', async () => {
    await expect(expectRejected(Promise.resolve('pong'))).rejects.toThrow('expected rejection, got "pong"')
  })

  it('propagates a failed inspection', async () => {
    const failure = new Error('inspection failed')
    await expect(
      expectRejected(Promise.reject('cancelled'), () => {
        throw failure
      })
    ).rejects.toBe(failure)
  })
})
