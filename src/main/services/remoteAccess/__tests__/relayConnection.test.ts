import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'

import { afterEach, expect, it, vi } from 'vitest'

import type * as RelayClient from '@cherrystudio/relay-client'
import { defaultRelayLimits, targetKeyDomain } from '@cherrystudio/relay-protocol'

const state = vi.hoisted(() => ({ sockets: [] as any[], attach: vi.fn() }))
vi.mock('@cherrystudio/relay-client', async (importOriginal) => ({
  ...(await importOriginal<typeof RelayClient>()),
  attachRelayStream: state.attach
}))
vi.mock('ws', () => ({
  default: class extends EventEmitter {
    static OPEN = 1
    readyState = 1
    bufferedAmount = 0
    sent: any[] = []
    terminate = vi.fn(() => {
      this.readyState = 3
      this.emit('close')
    })
    ping = vi.fn()
    constructor() {
      super()
      state.sockets.push(this)
    }
    send(value: string) {
      this.sent.push(JSON.parse(value))
    }
  }
}))

import { maintainRelayConnection } from '../relayConnection'

const hostKey = 'a'.repeat(64)
const targetId = createHash('sha256')
  .update(targetKeyDomain + hostKey)
  .digest('hex')
const offer = (sessionId: string) => ({
  v: 1,
  type: 'offer',
  sessionId,
  ownerEpoch: 'epoch',
  limits: defaultRelayLimits,
  ticket: 'b'.repeat(64),
  expiresInMs: 10_000
})
const deliver = (socket: any, value: unknown) => socket.emit('message', Buffer.from(JSON.stringify(value)), false)
const log = Object.assign(() => {}, { enabled: false, trace() {}, error() {}, newScope: () => log })
const operations: { abort: AbortController; promise: Promise<void> }[] = []
function start() {
  const abort = new AbortController()
  const onStatus = vi.fn()
  const onStream = vi.fn()
  const promise = maintainRelayConnection({
    origin: 'https://relay.example.com',
    hostKey,
    signal: abort.signal,
    log,
    onStatus,
    onStream
  })
  operations.push({ abort, promise })
  const socket = state.sockets.at(-1)
  socket.emit('open')
  deliver(socket, { v: 1, type: 'probe', nonce: 'a'.repeat(32) })
  expect(socket.sent.at(-1)).toEqual({ v: 1, type: 'probe_ack', nonce: 'a'.repeat(32) })
  socket.sent.pop()
  deliver(socket, { v: 1, type: 'listening', targetId, ownerEpoch: 'epoch' })
  return { abort, promise, socket, onStatus, onStream }
}
afterEach(async () => {
  for (const operation of operations) operation.abort.abort()
  await Promise.all(operations.splice(0).map((operation) => operation.promise))
  state.sockets.length = 0
  state.attach.mockReset()
  vi.useRealTimers()
})

it('answers DO transport receipts after admission without opening a data session', () => {
  const run = start()
  deliver(run.socket, { v: 1, type: 'probe', nonce: 'b'.repeat(32) })
  expect(run.socket.sent.at(-1)).toEqual({ v: 1, type: 'probe_ack', nonce: 'b'.repeat(32) })
  expect(state.attach).not.toHaveBeenCalled()
  expect(run.socket.terminate).not.toHaveBeenCalled()
})

it('cancels waiting attaches on listener loss while ready streams survive until configuration cancellation', async () => {
  const signals: AbortSignal[] = []
  const stream = new EventTarget() as EventTarget & { status: string; abort: ReturnType<typeof vi.fn> }
  stream.status = 'open'
  stream.abort = vi.fn()
  state.attach.mockImplementationOnce((_offer, options) => {
    signals.push(options.signal)
    return Promise.resolve(stream)
  })
  state.attach.mockImplementationOnce((_offer, options) => {
    signals.push(options.signal)
    return new Promise((_resolve, reject) =>
      options.signal.addEventListener('abort', () => reject(new Error('aborted')))
    )
  })
  const run = start()
  expect(run.socket.sent).toEqual([{ v: 1, type: 'listen', hostKey }])
  deliver(run.socket, offer('ready'))
  await Promise.resolve()
  expect(run.onStream).toHaveBeenCalledWith(stream)
  deliver(run.socket, offer('waiting'))
  run.socket.emit('close')
  expect(signals.map((signal) => signal.aborted)).toEqual([false, true])
  run.abort.abort()
  expect(signals.every((signal) => signal.aborted)).toBe(true)
})

it('rejects another owner epoch without opening a data connection', async () => {
  const run = start()
  deliver(run.socket, { ...offer('wrong'), ownerEpoch: 'other' })
  expect(state.attach).not.toHaveBeenCalled()
  expect(run.socket.terminate).toHaveBeenCalledTimes(1)
})

it('caps pending attaches and releases them on cancellation', async () => {
  const signals: AbortSignal[] = []
  state.attach.mockImplementation((_offer, options) => {
    signals.push(options.signal)
    return new Promise((_resolve, reject) =>
      options.signal.addEventListener('abort', () => reject(new Error('aborted')))
    )
  })
  const run = start()
  for (let index = 0; index < 33; index++) deliver(run.socket, offer(`session-${index}`))
  expect(state.attach).toHaveBeenCalledTimes(32)
  expect(run.socket.sent.at(-1)).toEqual({ v: 1, type: 'cancel', sessionId: 'session-32' })
  run.abort.abort()
  expect(signals.every((signal) => signal.aborted)).toBe(true)
})

it('does not hand a stream that closed immediately after ready to the session owner', async () => {
  const stream = { status: 'closed', abort: vi.fn() }
  state.attach.mockResolvedValue(stream)
  const run = start()
  deliver(run.socket, offer('closed'))
  await Promise.resolve()
  expect(run.onStream).not.toHaveBeenCalled()
  expect(stream.abort).toHaveBeenCalledTimes(1)
})
