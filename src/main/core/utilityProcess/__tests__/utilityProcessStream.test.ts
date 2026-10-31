import { describe, expect, it } from 'vitest'

import type { StreamMessage } from '../protocol/frames'
import { StreamChannel } from '../StreamChannel'
import type { UtilityProcessStreamFrame } from '../types'

const limits = { maxFrameBytes: 32, maxBufferedBytes: 32, maxBufferedFrames: 2, maxPendingWrites: 1 }
const frame = (size = 14): UtilityProcessStreamFrame => ({ metadata: {}, payload: new Uint8Array(size) })

function pair() {
  const sent: StreamMessage[] = []
  const left = new StreamChannel(
    limits,
    limits,
    (message) => {
      sent.push(message)
      right.receive(message)
    },
    () => Promise.resolve()
  )
  const right = new StreamChannel(
    limits,
    limits,
    (message) => left.receive(message),
    () => Promise.resolve()
  )
  return { left, right, sent }
}

describe('bounded stream channel', () => {
  it('waits for peer EOF acknowledgement independently of data credit', async () => {
    const sent: StreamMessage[] = []
    const channel = new StreamChannel(
      limits,
      limits,
      (message) => sent.push(message),
      () => Promise.resolve()
    )
    await channel.write(frame(30))
    let finished = false
    const finishing = channel.finish().then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)
    expect(sent.at(-1)).toEqual({ kind: 'stream-end', sequence: 1 })
    channel.receive({ kind: 'stream-end-ack', sequence: 1 })
    await finishing
    expect(finished).toBe(true)
    expect(() => channel.receive({ kind: 'stream-end-ack', sequence: 1 })).toThrow('acknowledgement')
  })

  it('enforces the frame count independently of the byte limit', async () => {
    const small = { ...limits, maxBufferedFrames: 1 }
    const sent: StreamMessage[] = []
    const channel = new StreamChannel(
      small,
      small,
      (message) => sent.push(message),
      () => Promise.resolve()
    )
    await channel.write(frame(0))
    const blocked = channel.write(frame(0))
    expect(sent).toHaveLength(1)
    channel.receive({ kind: 'stream-credit', sequence: 1 })
    await blocked
    expect(sent).toHaveLength(2)
  })

  it('rejects nested metadata and uses UTF-8 bytes for non-ASCII metadata', async () => {
    const { left } = pair()
    await expect(left.write({ metadata: { text: '语音'.repeat(8) } })).rejects.toThrow('frame')
    // @ts-expect-error Nested objects are not part of the stream frame contract.
    await expect(left.write({ metadata: { nested: { text: 'x' } } })).rejects.toThrow('scalar')
  })

  it('rejects concurrent pending reads and a second consumer', async () => {
    const { right } = pair()
    const reader = right.output[Symbol.asyncIterator]()
    const waiting = reader.next()
    await expect(reader.next()).rejects.toThrow('Concurrent')
    expect(() => right.output[Symbol.asyncIterator]()).toThrow('single consumer')
    right.abort(new Error('stopped'))
    await expect(waiting).rejects.toThrow('stopped')
  })

  it('holds byte capacity through consumption and rejects excess pending writers', async () => {
    const { left, right, sent } = pair()
    await left.write(frame())
    await left.write(frame())
    const waiting = left.write(frame())
    await expect(left.write(frame())).rejects.toThrow('pending')
    expect(sent.filter((m) => m.kind === 'stream-data')).toHaveLength(2)
    const reader = right.output[Symbol.asyncIterator]()
    await reader.next()
    expect(sent.filter((m) => m.kind === 'stream-data')).toHaveLength(2)
    await reader.next()
    await waiting
    expect(sent.filter((m) => m.kind === 'stream-data')).toHaveLength(3)
  })

  it('delivers the queued tail before EOF, including finish while a writer is blocked', async () => {
    const { left, right } = pair()
    await left.write(frame(30))
    const waiting = left.write(frame(1))
    const finished = left.finish()
    await expect(left.write(frame())).rejects.toThrow('ended')
    const sizes: number[] = []
    for await (const item of right.output) sizes.push(item.payload!.byteLength)
    await Promise.all([waiting, finished])
    expect(sizes).toEqual([30, 1])
  })

  it('wakes readers and writers on abort even without iteration having started', async () => {
    const { left, right } = pair()
    await left.write(frame(30))
    const waiting = left.write(frame())
    const eof = left.finish()
    const error = new Error('cancelled')
    left.abort(error)
    right.abort(error)
    await expect(waiting).rejects.toBe(error)
    await expect(eof).rejects.toBe(error)
    await expect(right.output[Symbol.asyncIterator]().next()).rejects.toBe(error)
  })

  it('accounts for a byte view rather than its backing buffer and snapshots submitted data', async () => {
    const { left, right } = pair()
    const payload = new Uint8Array(1024).subarray(10, 12)
    payload.set([5, 9])
    await left.write({ metadata: { n: 1 }, payload })
    payload.fill(0)
    const value = (await right.output[Symbol.asyncIterator]().next()).value!
    expect([...value.payload!]).toEqual([5, 9])
    expect(value.payload!.buffer.byteLength).toBe(2)
    await expect(left.write({ metadata: { text: 'x'.repeat(40) } })).rejects.toThrow('frame')
  })

  it('rejects capacity inflation and malformed sequencing', () => {
    const { left, right } = pair()
    expect(() => left.receive({ kind: 'stream-credit', sequence: 1 })).toThrow('credit')
    expect(() => right.receive({ kind: 'stream-end', sequence: 1 })).toThrow('sequence')
    expect(() =>
      right.receive({ kind: 'stream-data', sequence: 2, metadata: '{}', payload: new Uint8Array() })
    ).toThrow('sequence')
  })
})
