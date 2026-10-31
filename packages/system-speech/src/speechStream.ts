import { spawn } from 'node:child_process'

import {
  type NativeSpeechStream,
  type NativeSpeechStreamRequest,
  speechStreamFrameSchema,
  SystemSpeechError,
  type SystemSpeechErrorCode
} from './contracts'
import type { SystemSpeechNativeClientOptions } from './SystemSpeechNativeClient'

/** A request owns its helper; pulling stdout propagates backpressure to the native callback. */
export function openSpeechStream(
  options: SystemSpeechNativeClientOptions,
  request: NativeSpeechStreamRequest,
  signal?: AbortSignal
): NativeSpeechStream {
  const child = spawn(options.helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let failure: SystemSpeechError | undefined
  let exited = false
  let finished = false
  let killTimer: ReturnType<typeof setTimeout> | undefined
  let readTimer: ReturnType<typeof setTimeout> | undefined
  let resolveCompleted!: () => void
  let rejectCompleted!: (error: unknown) => void
  const completed = new Promise<void>((resolve, reject) => {
    resolveCompleted = resolve
    rejectCompleted = reject
  })
  let resolveClosed!: () => void
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })
  const stop = (code: SystemSpeechErrorCode) => {
    failure ??= new SystemSpeechError(code)
    clearTimeout(readTimer)
    if (exited) {
      rejectCompleted(failure)
      return
    }
    if (killTimer) return
    child.stdout.destroy()
    child.kill('SIGTERM')
    killTimer = setTimeout(() => child.kill('SIGKILL'), options.killGraceMs ?? 2000)
    killTimer.unref()
  }
  const abort = () => stop('cancelled')
  child.stderr.resume()
  child.on('error', () => stop('native_helper_failed'))
  child.stdin.on('error', () => stop('native_helper_failed'))
  child.once('close', (code) => {
    exited = true
    clearTimeout(killTimer)
    clearTimeout(readTimer)
    if (code !== 0) failure ??= new SystemSpeechError('native_helper_failed')
    if (failure) rejectCompleted(failure)
    resolveClosed()
  })
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  else child.stdin.end(`${JSON.stringify(request)}\n`)

  async function* frames() {
    let pending = Buffer.alloc(0)
    for await (const chunk of child.stdout) {
      if (!Buffer.isBuffer(chunk)) throw new SystemSpeechError('native_helper_failed')
      pending = Buffer.concat([pending, chunk])
      let newline: number
      while ((newline = pending.indexOf(10)) !== -1) {
        if (newline > 16384) throw new SystemSpeechError('native_helper_failed')
        const line = pending.subarray(0, newline)
        pending = pending.subarray(newline + 1)
        const frame = speechStreamFrameSchema.parse(JSON.parse(line.toString('utf8')))
        if ('error' in frame) throw new SystemSpeechError(frame.error.code)
        yield frame
      }
      if (pending.length > 16384) throw new SystemSpeechError('native_helper_failed')
    }
    if (pending.length) throw new SystemSpeechError('native_helper_failed')
  }
  const iterator = frames()
  async function read() {
    if (failure) throw failure
    readTimer = setTimeout(() => stop('timeout'), options.timeoutMs ?? 120_000)
    readTimer.unref()
    try {
      const item = await iterator.next()
      if (failure) throw failure
      return item
    } finally {
      clearTimeout(readTimer)
    }
  }
  async function fail(error: unknown): Promise<never> {
    stop(error instanceof SystemSpeechError ? error.code : 'native_helper_failed')
    await closed
    rejectCompleted(failure)
    throw failure
  }
  const output: NativeSpeechStream['output'] = (async () => {
    try {
      const first = await read()
      if (first.done || first.value.type !== 'format') throw new SystemSpeechError('native_helper_failed')
      const { sampleRate, channels } = first.value
      return {
        format: { sampleRate, channels },
        chunks: {
          async *[Symbol.asyncIterator]() {
            let accepted = 0
            try {
              while (true) {
                const item = await read()
                if (item.done) throw new SystemSpeechError('native_helper_failed')
                const frame = item.value
                if (frame.type === 'end') {
                  if (frame.frames !== accepted || !(await read()).done)
                    throw new SystemSpeechError('native_helper_failed')
                  readTimer = setTimeout(() => stop('timeout'), options.timeoutMs ?? 120_000)
                  readTimer.unref()
                  await closed
                  clearTimeout(readTimer)
                  if (failure) throw failure
                  finished = true
                  resolveCompleted()
                  return
                }
                if (frame.type !== 'pcm' || frame.startFrame !== accepted)
                  throw new SystemSpeechError('native_helper_failed')
                const bytes = Buffer.from(frame.data, 'base64')
                if (
                  !bytes.length ||
                  bytes.length > 1024 * channels * 4 ||
                  bytes.length % (channels * 4) ||
                  bytes.toString('base64') !== frame.data
                )
                  throw new SystemSpeechError('native_helper_failed')
                const samples = Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4))
                if (!samples.every(Number.isFinite)) throw new SystemSpeechError('native_helper_failed')
                accepted += samples.length / channels
                yield { startFrame: frame.startFrame, samples }
              }
            } catch (error) {
              await fail(error)
            } finally {
              if (!finished) {
                stop('cancelled')
                await closed
              }
            }
          }
        }
      }
    } catch (error) {
      return fail(error)
    }
  })()
  void output.catch(() => undefined)
  const detachAbort = () => signal?.removeEventListener('abort', abort)
  void completed.then(detachAbort, detachAbort)
  return {
    output,
    completed,
    closed,
    cancel: async () => {
      if (!finished) stop('cancelled')
      await closed
    }
  }
}
