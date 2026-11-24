import { expect, it } from 'vitest'

import { readNativeForkHistory } from '../nativeHistory'

it.each([
  { failure: Object.assign(new Error('Missing history'), { code: 'ENOENT' }), reason: 'history_missing' },
  { failure: new SyntaxError('Invalid history JSON'), reason: 'history_corrupt' }
])('classifies the native history failure as $reason', async ({ failure, reason }) => {
  await expect(
    readNativeForkHistory(async () => {
      throw failure
    })
  ).rejects.toMatchObject({ name: 'AgentSessionForkError', reason })
})

it('preserves an unreadable rejection instead of throwing during error classification', async () => {
  const failure = Proxy.revocable({}, {})
  failure.revoke()

  await expect(
    readNativeForkHistory(async () => {
      throw failure.proxy
    })
  ).rejects.toBe(failure.proxy)
})
