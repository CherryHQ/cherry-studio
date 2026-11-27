import type { ProcessAdapter } from '../../../src/main/core/utilityProcess/host/processAdapter'
import type { ProcessHost } from '../../../src/main/core/utilityProcess/host/ProcessHost'
import type { ChildFrame, MainFrame } from '../../../src/main/core/utilityProcess/protocol/frames'
import { record } from './evidence'
import { type SmokeContract, type SmokeInitData, streamLimits, streamOptions } from './smokeContract'

export function measureStreams(adapter: ProcessAdapter): ProcessAdapter {
  return {
    spawn: (options) => {
      const handle = adapter.spawn(options)
      const queues = new Map<
        string,
        { frames: Map<number, number>; bytes: number; peakBytes: number; peakFrames: number }
      >()
      const observe = (frame: MainFrame | ChildFrame, fromChild: boolean) => {
        if (frame.kind !== 'stream-data' && frame.kind !== 'stream-credit') return
        const direction = (frame.kind === 'stream-data') === fromChild ? 'output' : 'input'
        const key = `${frame.requestId}:${direction}`
        let queue = queues.get(key)
        if (!queue) {
          queue = { frames: new Map(), bytes: 0, peakBytes: 0, peakFrames: 0 }
          queues.set(key, queue)
        }
        if (frame.kind === 'stream-data') {
          const bytes = Buffer.byteLength(frame.metadata) + (frame.payload?.byteLength ?? 0)
          queue.frames.set(frame.sequence, bytes)
          queue.bytes += bytes
          queue.peakBytes = Math.max(queue.peakBytes, queue.bytes)
          queue.peakFrames = Math.max(queue.peakFrames, queue.frames.size)
        } else {
          queue.bytes -= queue.frames.get(frame.sequence) ?? 0
          queue.frames.delete(frame.sequence)
        }
        if (queue.bytes > streamLimits.maxBufferedBytes || queue.frames.size > streamLimits.maxBufferedFrames)
          throw new Error('Real stream exceeded declared capacity')
      }
      return {
        ...handle,
        get pid() {
          return handle.pid
        },
        send: (frame) => {
          observe(frame, false)
          handle.send(frame)
        },
        onMessage: (listener) =>
          handle.onMessage((frame) => {
            observe(frame as ChildFrame, true)
            listener(frame)
          }),
        onExit: (listener) =>
          handle.onExit((code) => {
            for (const [key, queue] of queues)
              record({
                event: 'stream-capacity',
                key,
                peakBytes: queue.peakBytes,
                peakFrames: queue.peakFrames,
                limits: streamLimits
              })
            listener(code)
          })
      }
    }
  }
}

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 5))
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message)
}

export async function checkDuplexStream(host: ProcessHost<SmokeContract, SmokeInitData>): Promise<void> {
  const stream = await host.openStream('duplex', undefined, streamOptions)
  const values: number[] = []
  const reading = (async () => {
    for await (const frame of stream.output) {
      const n = frame.metadata.n as number
      assert(frame.payload?.every((value) => value === n) ?? false, 'stream binary data corrupted')
      values.push(n)
      await pause()
    }
  })()
  for (let n = 0; n < 64; n++) await stream.write({ metadata: { n }, payload: new Uint8Array(3000).fill(n) })
  await stream.finishInput()
  await reading
  assert((await stream.completed) === 64, 'stream result lost')
  await stream.closed
  assert(values.length === 64 && values.every((value, n) => value === n), 'stream tail or ordering lost')
}

export async function checkStreamCancel(host: ProcessHost<SmokeContract, SmokeInitData>): Promise<void> {
  const stream = await host.openStream('produce', 1000, streamOptions)
  const reader = stream.output[Symbol.asyncIterator]()
  assert(!(await reader.next()).done, 'missing first output')
  await pause()
  await stream.cancel()
  const rejected = await stream.completed.then(
    () => false,
    () => true
  )
  assert(rejected, 'cancelled stream reported success')
  assert((await host.request('ping', undefined)) === 'pong', 'no request after stream cancellation')
}

export async function checkStreamCrash(host: ProcessHost<SmokeContract, SmokeInitData>): Promise<void> {
  const stream = await host.openStream('produce', 1000, streamOptions)
  const reader = stream.output[Symbol.asyncIterator]()
  await reader.next()
  await host.request('crash', undefined).catch(() => {})
  assert(
    await stream.completed.then(
      () => false,
      () => true
    ),
    'crashed stream reported success'
  )
  await stream.closed
  assert((await host.request('ping', undefined)) === 'pong', 'no restart after stream crash')
}

export async function checkStreamStop(host: ProcessHost<SmokeContract, SmokeInitData>): Promise<void> {
  const stream = await host.openStream('streamStall', undefined, streamOptions)
  await host.withStopped(async () => {
    await stream.closed
  })
  assert(
    await stream.completed.then(
      () => false,
      () => true
    ),
    'stopped stream reported success'
  )
  assert((await host.request('ping', undefined)) === 'pong', 'no restart after stream stop')
}
