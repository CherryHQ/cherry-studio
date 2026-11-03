import { finished } from 'node:stream/promises'

import type { MxcProcess } from '@microsoft/mxc-sdk/v1'

import { ByteQueue } from '../../host/ByteQueue.js'
import { deferred, within } from '../../host/deferred.js'
import { SandboxError } from '../../host/SandboxError.js'
import type { SandboxSpec } from '../../types.js'
import type { BackendLease } from '../types.js'
import type { compilePolicy } from './policy.js'
import { createProxy } from './proxy.js'

export function createLease(spec: SandboxSpec, prepare: () => Promise<ReturnType<typeof compilePolicy>>): BackendLease {
  const started = deferred<Awaited<BackendLease['started']>>()
  const targetExit = deferred<Awaited<BackendLease['targetExit']>>()
  const failure = deferred<SandboxError>()
  let child: MxcProcess | undefined
  let proxy: Awaited<ReturnType<typeof createProxy>> | undefined
  let stopped = false
  let exited = false
  let spawnFailed = false
  let inputBytes = 0
  let outputBytes = 0
  let outputTruncated = false
  const outputEnded: Promise<void>[] = []
  const fail = (error: SandboxError) => {
    failure.resolve(error)
    started.reject(error)
  }
  const overflow = () => fail(new SandboxError('LIMIT_EXCEEDED', 'Sandbox I/O budget exceeded'))
  const outputOverflow = () => {
    outputTruncated = true
    overflow()
  }
  const stdout = new ByteQueue(spec.limits.ioBufferBytes, outputOverflow)
  const stderr = new ByteQueue(spec.limits.ioBufferBytes, outputOverflow)
  const startupTimer = setTimeout(
    () => fail(new SandboxError('START_TIMEOUT', 'MXC launch deadline exceeded')),
    spec.limits.startupTimeoutMs
  )
  const launched = (async () => {
    try {
      const policy = await prepare()
      if (spec.network.mode === 'proxy') {
        proxy = await createProxy(spec.network.targets, () =>
          fail(new SandboxError('START_FAILED', 'Sandbox proxy failed'))
        )
        policy.request.network = {
          ...policy.request.network,
          runtimeConfig: { networkProxy: proxy.url }
        }
      }
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
          if (outputBytes > (spec.limits.outputBytes ?? 1048576)) outputOverflow()
          else queue.push(chunk)
        })
        outputEnded.push(
          finished(stream, { readable: true, writable: false, cleanup: true }).then(
            () => queue.close(),
            () => {
              outputTruncated = true
              queue.close()
            }
          )
        )
        stream.on('error', () => fail(new SandboxError('START_FAILED', 'MXC output stream failed')))
      }
      if (!child.standardInput) throw new Error('MXC did not expose stdin')
      void child.wait().then(
        (result) => {
          exited = true
          targetExit.resolve({ status: 'exited', exitCode: result.exitCode })
        },
        (error) => {
          fail(new SandboxError('START_FAILED', String(error)))
          targetExit.resolve({ status: 'unknown' })
        }
      )
      if (stopped) child.kill()
      else started.resolve({ effectivePolicy: policy.effectivePolicy })
    } catch (error) {
      if (child) {
        outputTruncated = true
        try {
          child.kill()
        } catch {
          // Retain the child without rejecting launched, so terminate can retry the native kill.
        }
      } else {
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
      await proxy?.close()
      if (spawnFailed) return 'gone'
      if (!exited) {
        try {
          child?.kill()
        } catch (error) {
          // Closing RPC can let the guest exit before MXC observes the kill.
          const exit = await within(targetExit.promise, timeoutMs, { status: 'unknown' as const })
          if (exit.status === 'exited') return 'unverified'
          throw error
        }
      }
      const exit = await within(targetExit.promise, timeoutMs, { status: 'unknown' as const })
      return exit.status === 'exited' ? 'unverified' : 'unknown'
    },
    async cleanup({ timeoutMs }) {
      if (!exited && !spawnFailed) {
        // Output consumers must finish even while we retain the process for cleanup retries.
        outputTruncated = true
        stdout.close()
        stderr.close()
        return {
          status: 'incomplete',
          issues: [{ code: 'OUTPUT_TRUNCATED', message: 'Output collection ended before target exit was confirmed' }]
        }
      }
      const drained = await within(
        Promise.all([...outputEnded, stdout.drained, stderr.drained]).then(() => true),
        Math.min(timeoutMs, spec.limits.ioDrainTimeoutMs),
        false
      )
      const unread = [stdout.discard(), stderr.discard()].some(Boolean)
      const truncated = outputTruncated || !drained || unread
      child?.dispose()
      await proxy?.close()
      return {
        status: 'complete',
        issues: truncated
          ? [{ code: 'OUTPUT_TRUNCATED', message: 'Output collection ended before EOF or consumption' }]
          : []
      }
    }
  }
}
