import { PassThrough } from 'node:stream'

import { afterEach, expect, it, vi } from 'vitest'

import { createLease } from '../../src/backends/mxc/lease.js'
import { compilePolicy } from '../../src/backends/mxc/policy.js'
import { deferred } from '../../src/host/deferred.js'
import { createInstance } from '../../src/host/instance.js'
import { SandboxError } from '../../src/host/SandboxError.js'
import { readAll, spec } from '../fixtures.js'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('@microsoft/mxc-sdk/v1', () => ({ spawn }))

afterEach(() => {
  vi.useRealTimers()
  spawn.mockReset()
})

it('preserves a preparation failure instead of treating not-started as an exit', async () => {
  const error = new SandboxError('START_FAILED', 'Preparation failed')
  const request = spec()
  const lease = createLease(request, async () => {
    throw error
  })
  const instance = createInstance('failed', request, lease, 'mxc')
  await expect(instance.ready).rejects.toBe(error)
  expect(await instance.completion).toMatchObject({
    reason: 'startup-error',
    target: { status: 'not-started' },
    tree: 'gone',
    cleanup: 'complete',
    issues: [{ code: 'START_FAILED', message: 'Preparation failed' }]
  })
})

it('ends output collection after a launch deadline while retaining cleanup retry ownership', async () => {
  vi.useFakeTimers()
  const preparation = deferred<ReturnType<typeof compilePolicy>>()
  const request = spec()
  const lease = createLease(request, () => preparation.promise)
  const instance = createInstance('pending', request, lease, 'mxc')
  const stdout = readAll(instance.stdout)
  const stderr = readAll(instance.stderr)
  const output = Promise.all([stdout, stderr])
  let collected = false
  void output.then(() => {
    collected = true
  })
  await vi.advanceTimersByTimeAsync(request.limits.startupTimeoutMs + request.limits.stopTimeoutMs)
  await expect(instance.ready).rejects.toMatchObject({ code: 'START_TIMEOUT' })
  const first = await instance.completion
  expect(first).toMatchObject({ reason: 'startup-error', tree: 'unknown', cleanup: 'incomplete' })
  expect(instance.snapshot().state).toBe('failed')
  try {
    expect(collected).toBe(true)
    await expect(output).resolves.toEqual(['', ''])
  } finally {
    preparation.reject(new SandboxError('START_FAILED', 'Preparation abandoned'))
    await output
  }
  expect(await instance.stop()).toMatchObject({ tree: 'gone', cleanup: 'complete' })
  expect(instance.snapshot().state).toBe('stopped')
  expect(await instance.completion).toBe(first)
})

it('preserves a rejected SDK spawn as a startup failure', async () => {
  spawn.mockRejectedValue(new Error('SDK spawn failed'))
  const request = spec()
  const instance = createInstance(
    'spawn-failed',
    request,
    createLease(request, async () => compilePolicy(request)),
    'mxc'
  )
  await expect(instance.ready).rejects.toMatchObject({ code: 'START_FAILED', message: 'Error: SDK spawn failed' })
  expect(await instance.completion).toMatchObject({ reason: 'startup-error', target: { status: 'not-started' } })
})

it('preserves buffered output on incomplete stop and disposes the process only after exit', async () => {
  vi.useFakeTimers()
  const streams = [new PassThrough(), new PassThrough(), new PassThrough()]
  const exit = deferred<{ exitCode: number }>()
  let disposed = false
  spawn.mockResolvedValue({
    standardInput: streams[0],
    standardOutput: streams[1],
    standardError: streams[2],
    wait: () => exit.promise,
    kill() {},
    dispose() {
      disposed = true
    }
  })
  const request = spec()
  const instance = createInstance(
    'running',
    request,
    createLease(request, async () => compilePolicy(request)),
    'mxc'
  )
  try {
    await instance.ready
    streams[1].write('partial stdout')
    streams[2].write('partial stderr')
    const stopped = instance.stop()
    await vi.advanceTimersByTimeAsync(request.limits.stopTimeoutMs)
    expect(await stopped).toMatchObject({
      tree: 'unknown',
      cleanup: 'incomplete',
      issues: [{ code: 'OUTPUT_TRUNCATED' }]
    })
    expect(disposed).toBe(false)
    await expect(readAll(instance.stdout)).resolves.toBe('partial stdout')
    await expect(readAll(instance.stderr)).resolves.toBe('partial stderr')
    exit.resolve({ exitCode: 0 })
    expect(await instance.stop()).toMatchObject({ tree: 'unverified', cleanup: 'complete' })
    expect(disposed).toBe(true)
  } finally {
    exit.resolve({ exitCode: 0 })
    for (const stream of streams) stream.destroy()
    await instance.stop()
  }
})
