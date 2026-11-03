import { expect, it } from 'vitest'

import type { BackendLease } from '../../src/backends/types.js'
import { deferred } from '../../src/host/deferred.js'
import { createInstance } from '../../src/host/instance.js'
import type { SandboxError } from '../../src/host/SandboxError.js'
import { spec } from '../fixtures.js'

it('retains the initial failed completion while retrying cleanup without restarting', async () => {
  const started = deferred<Awaited<BackendLease['started']>>()
  const targetExit = deferred<Awaited<BackendLease['targetExit']>>()
  const failure = deferred<SandboxError>()
  let canReap = false
  const empty = { async *[Symbol.asyncIterator]() {} }
  const lease: BackendLease = {
    started: started.promise,
    targetExit: targetExit.promise,
    failure: failure.promise,
    channel: null,
    stdin: { write: async () => undefined, end: async () => undefined },
    stdout: empty,
    stderr: empty,
    terminate: async () => (canReap ? 'gone' : 'unknown'),
    cleanup: async () => ({ status: canReap ? 'complete' : 'incomplete', issues: [] })
  }
  const instance = createInstance('instance', spec(), lease, 'test-backend')
  started.reject(new Error('Trusted launcher disconnected'))
  targetExit.resolve({ status: 'unknown' })
  await expect(instance.ready).rejects.toThrow('Trusted launcher disconnected')
  const first = await instance.completion
  expect(first).toMatchObject({ tree: 'unknown', cleanup: 'incomplete' })
  expect(instance.snapshot().state).toBe('failed')
  canReap = true
  const retry = await instance.stop()
  expect(retry).toMatchObject({ tree: 'gone', cleanup: 'complete' })
  expect(instance.snapshot()).toEqual({ state: 'stopped', lastCompletion: retry })
  expect(await instance.completion).toBe(first)
  expect(await instance.stop()).toBe(retry)
  await expect(instance.ready).rejects.toThrow('Trusted launcher disconnected')
})
