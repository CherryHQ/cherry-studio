import type { MxcProcess } from '@microsoft/mxc-sdk/v1'

import { ByteQueue } from '../../host/ByteQueue.js'
import { deferred, within } from '../../host/deferred.js'
import { SandboxError } from '../../host/SandboxError.js'
import type { SandboxSpec } from '../../types.js'
import type { BackendLease } from '../types.js'
import type { compilePolicy } from './policy.js'

export function createLease(spec: SandboxSpec, prepare: () => Promise<ReturnType<typeof compilePolicy>>): BackendLease {
  const started = deferred<Awaited<BackendLease['started']>>()
  const targetExit = deferred<Awaited<BackendLease['targetExit']>>()
  const failure = deferred<SandboxError>()
  let child: MxcProcess | undefined
  let stopped = false
  let exited = false
  let spawnFailed = false
  let inputBytes = 0
  let outputBytes = 0
  const fail = (error: SandboxError) => {
    failure.resolve(error)
    started.reject(error)
  }
  const overflow = () => fail(new SandboxError('LIMIT_EXCEEDED', 'Sandbox I/O budget exceeded'))
  const stdout = new ByteQueue(spec.limits.ioBufferBytes, overflow)
  const stderr = new ByteQueue(spec.limits.ioBufferBytes, overflow)
  const startupTimer = setTimeout(
    () => fail(new SandboxError('START_TIMEOUT', 'MXC launch deadline exceeded')),
    spec.limits.startupTimeoutMs
  )
  const launched = (async () => {
    try {
      const policy = await prepare()
      const { spawn } = await import('@microsoft/mxc-sdk/v1')
      if (stopped) throw new SandboxError('CANCELLED', 'Stopped before MXC launch')
      child = await spawn(policy.request)
      for (const [stream, queue] of [
        [child.standardOutput, stdout],
        [child.standardError, stderr]
      ] as const) {
        if (!stream) throw new Error('MXC did not expose standard output pipes')
        stream.on('data', (chunk: Buffer) => {
          outputBytes += chunk.length
          if (outputBytes > (spec.limits.outputBytes ?? 1048576)) overflow()
          else queue.push(chunk)
        })
        stream.on('end', () => queue.close())
        stream.on('error', () => fail(new SandboxError('START_FAILED', 'MXC output stream failed')))
      }
      if (!child.standardInput) throw new Error('MXC did not expose stdin')
      void child.wait().then(
        (result) => {
          exited = true
          targetExit.resolve({ status: 'exited', exitCode: result.exitCode })
          stdout.close()
          stderr.close()
        },
        (error) => {
          fail(new SandboxError('START_FAILED', String(error)))
          targetExit.resolve({ status: 'unknown' })
        }
      )
      if (stopped) child.kill()
      else started.resolve({ effectivePolicy: policy.effectivePolicy })
    } catch (error) {
      if (child) child.kill()
      else {
        spawnFailed = true
        targetExit.resolve({ status: 'not-started' })
      }
      fail(error instanceof SandboxError ? error : new SandboxError('START_FAILED', String(error)))
      stdout.close()
      stderr.close()
    } finally {
      clearTimeout(startupTimer)
    }
  })()
  return {
    started: started.promise,
    targetExit: targetExit.promise,
    failure: failure.promise,
    channel: null,
    stdout,
    stderr,
    stdin: {
      async write(data) {
        inputBytes += data.byteLength
        try {
          if (inputBytes > spec.limits.ioBufferBytes) {
            overflow()
            throw new SandboxError('LIMIT_EXCEEDED', 'Sandbox input queue exceeded')
          }
          await started.promise
          if (stopped || !child?.standardInput) throw new SandboxError('CANCELLED', 'Sandbox input is closed')
          await new Promise<void>((resolve, reject) =>
            child!.standardInput!.write(data, (error) => (error ? reject(error) : resolve()))
          )
        } finally {
          inputBytes -= data.byteLength
        }
      },
      async end() {
        await started.promise
        if (!stopped) child?.standardInput?.end()
      }
    },
    async terminate({ timeoutMs }) {
      stopped = true
      clearTimeout(startupTimer)
      if (
        !(await within(
          launched.then(() => true),
          timeoutMs,
          false
        ))
      )
        return 'unknown'
      if (spawnFailed) return 'gone'
      if (!exited) child?.kill()
      const exit = await within(targetExit.promise, timeoutMs, { status: 'unknown' as const })
      return exit.status === 'exited' ? 'unverified' : 'unknown'
    },
    async cleanup() {
      if (!exited && !spawnFailed) {
        // Output consumers must finish even while we retain the process for cleanup retries.
        stdout.close()
        stderr.close()
        return {
          status: 'incomplete',
          issues: [{ code: 'OUTPUT_TRUNCATED', message: 'Output collection ended before target exit was confirmed' }]
        }
      }
      child?.dispose()
      await within(Promise.all([stdout.drained, stderr.drained]), spec.limits.ioDrainTimeoutMs, undefined)
      const truncated = [stdout.discard(), stderr.discard()].some(Boolean)
      return {
        status: 'complete',
        issues: truncated ? [{ code: 'OUTPUT_TRUNCATED', message: 'Unread output discarded after drain deadline' }] : []
      }
    }
  }
}
