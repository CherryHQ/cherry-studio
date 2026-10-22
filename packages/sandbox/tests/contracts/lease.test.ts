import { PassThrough } from 'node:stream'

import type * as mxc from '@microsoft/mxc-sdk/v1'
import { afterEach, expect, it, vi } from 'vitest'

import { createLease } from '../../src/backends/mxc/lease.js'
import { compilePolicy } from '../../src/backends/mxc/policy.js'
import { completionExitCode } from '../../src/cli/completionExitCode.js'
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
    const retried = instance.stop()
    await vi.advanceTimersByTimeAsync(request.limits.ioDrainTimeoutMs)
    expect(await retried).toMatchObject({ tree: 'unverified', cleanup: 'complete' })
    expect(disposed).toBe(true)
  } finally {
    exit.resolve({ exitCode: 0 })
    for (const stream of streams) stream.destroy()
    await instance.stop()
  }
})

async function sdkProcess(limits: Partial<ReturnType<typeof spec>['limits']> = {}, kill = () => {}) {
  const { MxcProcess } = await vi.importActual<typeof mxc>('@microsoft/mxc-sdk/v1')
  const input = new PassThrough()
  const output = new PassThrough()
  const errors = new PassThrough()
  let running = true
  const child = new MxcProcess({
    id: 1,
    standardInput: input,
    standardOutput: output,
    standardError: errors,
    poll: () => ({ running, exitCode: 0, timedOut: false }),
    wait: async () => ({ exitCode: 0, timedOut: false }),
    warnings: () => [],
    outputMetadata: () => undefined,
    kill() {
      kill()
      running = false
    },
    killForTimeout() {
      running = false
    },
    free: async () => undefined
  })
  spawn.mockResolvedValue(child)
  const request = spec()
  Object.assign(request.limits, limits)
  const instance = createInstance(
    'tail',
    request,
    createLease(request, async () => compilePolicy(request)),
    'mxc'
  )
  await instance.ready
  return {
    instance,
    request,
    output,
    errors,
    async exit() {
      const exited = child.wait()
      running = false
      await vi.advanceTimersByTimeAsync(100)
      await exited
    }
  }
}

it('ends collection after SDK kill throws and retains the instance for a successful retry', async () => {
  vi.useFakeTimers()
  let killFails = true
  const process = await sdkProcess({}, () => {
    if (killFails) throw new Error('Native kill failed')
  })
  process.output.write('partial stdout')
  process.errors.write('partial stderr')
  let collected: string[] | undefined
  const output = Promise.all([readAll(process.instance.stdout), readAll(process.instance.stderr)])
  void output.then((value) => {
    collected = value
  })
  try {
    const stopping = process.instance.stop()
    await vi.advanceTimersByTimeAsync(process.request.limits.stopTimeoutMs + process.request.limits.cleanupTimeoutMs)
    const first = await stopping
    expect(first).toMatchObject({ tree: 'unknown', cleanup: 'incomplete' })
    expect(first.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'CLEANUP_FAILED' }),
        expect.objectContaining({ code: 'OUTPUT_TRUNCATED' })
      ])
    )
    expect(collected).toEqual(['partial stdout', 'partial stderr'])
    expect(process.output.destroyed).toBe(false)
    expect(process.instance.snapshot().state).toBe('failed')
    killFails = false
    const retried = process.instance.stop()
    await vi.advanceTimersByTimeAsync(process.request.limits.stopTimeoutMs + process.request.limits.cleanupTimeoutMs)
    expect(await retried).toMatchObject({ tree: 'unverified', cleanup: 'complete' })
    expect(process.instance.snapshot().state).toBe('stopped')
    expect(process.output.destroyed).toBe(true)
    expect(await process.instance.completion).toBe(first)
  } finally {
    killFails = false
    const stopped = process.instance.stop()
    await vi.advanceTimersByTimeAsync(process.request.limits.stopTimeoutMs + process.request.limits.cleanupTimeoutMs)
    await stopped
    process.output.destroy()
    process.errors.destroy()
    await output
  }
})

it.each(['before', 'after'])('reports CLI output overflow as 124 %s root exit', async (ordering) => {
  vi.useFakeTimers()
  const process = await sdkProcess({ outputBytes: 4 })
  const output = Promise.all([readAll(process.instance.stdout), readAll(process.instance.stderr)])
  if (ordering === 'after') await process.exit()
  process.output.end('over budget')
  process.errors.end()
  if (ordering === 'before') await process.exit()
  await vi.advanceTimersByTimeAsync(process.request.limits.ioDrainTimeoutMs)
  const completion = await process.instance.completion
  expect(completion.reason).toBe(ordering === 'before' ? 'limit' : 'exited')
  expect(completion.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'LIMIT_EXCEEDED' })]))
  expect(completionExitCode(completion, false, undefined)).toBe(124)
  expect(completionExitCode(completion, false, 'SIGINT')).toBe(130)
  expect(completionExitCode(completion, true, 'SIGINT')).toBe(125)
  expect(completionExitCode({ ...completion, cleanup: 'incomplete' }, false, 'SIGINT')).toBe(125)
  expect(completionExitCode({ ...completion, tree: 'unknown' }, false, undefined)).toBe(125)
  await output
})

it('collects tail bytes after the real SDK reports process completion and before each pipe reaches EOF', async () => {
  vi.useFakeTimers()
  const process = await sdkProcess()
  const stdout = readAll(process.instance.stdout)
  const stderr = readAll(process.instance.stderr)
  await process.exit()
  process.output.end('valid stdout tail bytes')
  await vi.advanceTimersByTimeAsync(10)
  process.errors.end('valid stderr tail bytes')
  await vi.advanceTimersByTimeAsync(0)
  expect(await stdout).toBe('valid stdout tail bytes')
  expect(await stderr).toBe('valid stderr tail bytes')
  expect(await process.instance.completion).toMatchObject({
    target: { status: 'exited', exitCode: 0 },
    cleanup: 'complete',
    issues: []
  })
  expect(process.output.destroyed).toBe(true)
  expect(process.errors.destroyed).toBe(true)
})

it('bounds collection when a pipe stays open after exit and reports truncation even with empty queues', async () => {
  vi.useFakeTimers()
  const process = await sdkProcess()
  const stdout = readAll(process.instance.stdout)
  const stderr = readAll(process.instance.stderr)
  await process.exit()
  process.output.end('collected before deadline')
  await vi.advanceTimersByTimeAsync(process.request.limits.ioDrainTimeoutMs)
  expect(await process.instance.completion).toMatchObject({
    cleanup: 'complete',
    issues: [{ code: 'OUTPUT_TRUNCATED' }]
  })
  expect(await stdout).toBe('collected before deadline')
  expect(await stderr).toBe('')
  expect(process.errors.destroyed).toBe(true)
})

it('reports a pipe closed without EOF as truncated', async () => {
  vi.useFakeTimers()
  const process = await sdkProcess()
  const output = Promise.all([readAll(process.instance.stdout), readAll(process.instance.stderr)])
  await process.exit()
  process.output.destroy()
  process.errors.end()
  await vi.advanceTimersByTimeAsync(process.request.limits.ioDrainTimeoutMs)
  expect(await process.instance.completion).toMatchObject({
    cleanup: 'complete',
    issues: [{ code: 'OUTPUT_TRUNCATED' }]
  })
  await output
})

it('uses the cleanup deadline when it is shorter than the output drain deadline', async () => {
  vi.useFakeTimers()
  const process = await sdkProcess({ ioDrainTimeoutMs: 500, cleanupTimeoutMs: 20 })
  const output = Promise.all([readAll(process.instance.stdout), readAll(process.instance.stderr)])
  await process.exit()
  await vi.advanceTimersByTimeAsync(19)
  expect(process.instance.snapshot().state).toBe('stopping')
  expect(process.errors.destroyed).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  expect(await process.instance.completion).toMatchObject({
    cleanup: 'complete',
    issues: [{ code: 'OUTPUT_TRUNCATED' }]
  })
  await expect(output).resolves.toEqual(['', ''])
})

it('reports unread buffered bytes discarded at the drain deadline even after EOF', async () => {
  vi.useFakeTimers()
  const process = await sdkProcess()
  process.output.end('unconsumed output')
  process.errors.end()
  await process.exit()
  await vi.advanceTimersByTimeAsync(process.request.limits.ioDrainTimeoutMs)
  expect(await process.instance.completion).toMatchObject({
    cleanup: 'complete',
    issues: [{ code: 'OUTPUT_TRUNCATED' }]
  })
  expect(await readAll(process.instance.stdout)).toBe('')
})

// A kill error is not evidence that the process is still alive when exit races RPC closure.
it('accepts an independently confirmed exit after SDK kill races the exiting process', async () => {
  vi.useFakeTimers()
  const process = await sdkProcess({}, () => {
    throw new Error('Already exiting')
  })
  const output = Promise.all([readAll(process.instance.stdout), readAll(process.instance.stderr)])
  const stopped = process.instance.stop()
  await process.exit()
  process.output.end()
  process.errors.end()
  await vi.advanceTimersByTimeAsync(process.request.limits.stopTimeoutMs)
  expect(await stopped).toMatchObject({
    tree: 'unverified',
    cleanup: 'complete',
    target: { status: 'exited' },
    issues: []
  })
  await output
})

it('revokes the owned proxy when native spawn fails after proxy initialization', async () => {
  let proxyUrl = ''
  spawn.mockImplementation(async (request: mxc.ContainerRequest) => {
    proxyUrl = request.network?.runtimeConfig?.networkProxy ?? ''
    throw new Error('Native launch refused')
  })
  const request = spec()
  const policy = compilePolicy(request)
  request.network = { mode: 'proxy', targets: [] }
  const instance = createInstance(
    'proxy-spawn-error',
    request,
    createLease(request, async () => policy),
    'mxc'
  )
  await expect(instance.ready).rejects.toThrow('Native launch refused')
  expect(await instance.completion).toMatchObject({ target: { status: 'not-started' }, cleanup: 'complete' })
  expect(proxyUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  await expect(fetch(proxyUrl)).rejects.toMatchObject({ cause: { code: 'ECONNREFUSED' } })
})

it.each(['stop', 'timeout'] as const)(
  'retries termination after delayed spawn and repeated kill failures following %s',
  async (cause) => {
    vi.useFakeTimers()
    const { MxcProcess } = await vi.importActual<typeof mxc>('@microsoft/mxc-sdk/v1')
    const input = new PassThrough(),
      output = new PassThrough(),
      errors = new PassThrough()
    let running = true,
      killFails = true
    const child = new MxcProcess({
      id: 1,
      standardInput: input,
      standardOutput: output,
      standardError: errors,
      poll: () => ({ running, exitCode: 0, timedOut: false }),
      wait: async () => ({ exitCode: 0, timedOut: false }),
      warnings: () => [],
      outputMetadata: () => undefined,
      kill() {
        if (killFails) throw new Error('Transient native kill failure')
        running = false
      },
      killForTimeout() {
        running = false
      },
      free: async () => undefined
    })
    const pending = deferred<mxc.MxcProcess>()
    const spawning = deferred<void>()
    spawn.mockImplementation(() => {
      spawning.resolve()
      return pending.promise
    })
    const request = spec()
    const lease = createLease(request, async () => compilePolicy(request))
    const instance = createInstance('delayed-spawn', request, lease, 'mxc')
    const collected = Promise.all([readAll(instance.stdout), readAll(instance.stderr)])
    try {
      await spawning.promise
      if (cause === 'timeout') await vi.advanceTimersByTimeAsync(request.limits.startupTimeoutMs)
      const stopping = instance.stop()
      pending.resolve(child)
      await vi.advanceTimersByTimeAsync(request.limits.stopTimeoutMs + request.limits.cleanupTimeoutMs)
      const first = await stopping
      expect(first).toMatchObject({ tree: 'unknown', cleanup: 'incomplete' })
      expect(running).toBe(true)
      expect(output.destroyed).toBe(false)
      expect(instance.snapshot().state).toBe('failed')
      await expect(collected).resolves.toEqual(['', ''])
      killFails = false
      const retried = instance.stop()
      await vi.advanceTimersByTimeAsync(request.limits.stopTimeoutMs + request.limits.cleanupTimeoutMs)
      expect(await retried).toMatchObject({ target: { status: 'exited' }, tree: 'unverified', cleanup: 'complete' })
      expect(running).toBe(false)
      expect(output.destroyed).toBe(true)
      expect(instance.snapshot().state).toBe('stopped')
      expect(await instance.completion).toBe(first)
      await expect(lease.failure).resolves.toMatchObject({
        code: cause === 'timeout' ? 'START_TIMEOUT' : 'START_FAILED'
      })
    } finally {
      running = false
      pending.resolve(child)
      await vi.advanceTimersByTimeAsync(100)
      child.dispose()
      input.destroy()
      output.destroy()
      errors.destroy()
      await collected
    }
  }
)
