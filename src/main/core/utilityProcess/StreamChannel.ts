import type { StreamMessage } from './protocol/frames'
import { encodeStreamFrame, isStreamLimits } from './streamFrame'
import type { UtilityProcessStreamFrame, UtilityProcessStreamLimits } from './types'

type Waiter<T> = ReturnType<typeof Promise.withResolvers<T>>
type Write = ReturnType<typeof encodeStreamFrame> & Waiter<void>
type Received = { value: UtilityProcessStreamFrame; sequence: number; bytes: number }

/** One request's two directions. Credits cover queued frames and the reader's current frame. */
export class StreamChannel {
  private readonly outgoing: UtilityProcessStreamLimits
  private readonly incoming: UtilityProcessStreamLimits
  private readonly writes: Write[] = []
  private readonly inFlight = new Map<number, number>()
  private sentBytes = 0
  private sentSequence = 0
  private readonly queue: Received[] = []
  private receivedBytes = 0
  private receivedCount = 0
  private receivedSequence = 0
  private held: Received | undefined
  private reader: Waiter<IteratorResult<UtilityProcessStreamFrame>> | undefined
  private iteratorTaken = false
  private iteratorEnded = false
  private inputEnded = false
  private outputEnded = false
  private endAcknowledged = false
  private end: Waiter<void> | undefined
  private failure: { reason: unknown } | undefined
  private detached = false

  readonly output: AsyncIterable<UtilityProcessStreamFrame> = {
    [Symbol.asyncIterator]: () => {
      if (this.iteratorTaken) throw new Error('Stream output has a single consumer')
      this.iteratorTaken = true
      return {
        next: () => this.next(),
        return: async () => {
          if (!this.iteratorEnded) {
            this.iteratorEnded = true
            this.abort(new DOMException('Stream consumer stopped', 'AbortError'))
            await this.cancel()
          } else this.releaseHeld()
          return { done: true, value: undefined }
        }
      }
    }
  }

  constructor(
    outgoing: UtilityProcessStreamLimits,
    incoming: UtilityProcessStreamLimits,
    private send: (message: StreamMessage) => void,
    private cancel: () => Promise<void>
  ) {
    if (!isStreamLimits(outgoing) || !isStreamLimits(incoming)) throw new RangeError('Invalid stream limits')
    this.outgoing = { ...outgoing }
    this.incoming = { ...incoming }
  }

  write(frame: UtilityProcessStreamFrame): Promise<void> {
    if (this.failure) return Promise.reject(this.failure.reason)
    if (this.end || this.detached) return Promise.reject(new Error('Stream input has ended'))
    if (this.writes.length >= this.outgoing.maxPendingWrites)
      return Promise.reject(new RangeError('Too many pending stream writes'))
    try {
      const encoded = encodeStreamFrame(frame, this.outgoing.maxFrameBytes)
      const waiter = Promise.withResolvers<void>()
      this.writes.push({ ...encoded, ...waiter })
      this.pump()
      return waiter.promise
    } catch (error) {
      return Promise.reject(error)
    }
  }

  finish(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure.reason)
    if (this.end) return this.end.promise
    if (this.detached) return Promise.reject(new Error('Stream is closed'))
    this.end = Promise.withResolvers<void>()
    this.pump()
    return this.end.promise
  }

  receive(message: StreamMessage): void {
    if (this.failure || this.detached) return
    switch (message.kind) {
      case 'stream-credit': {
        const first = this.inFlight.entries().next().value
        if (!first || first[0] !== message.sequence) throw new Error('Invalid stream credit sequence')
        this.inFlight.delete(first[0])
        this.sentBytes -= first[1]
        this.pump()
        return
      }
      case 'stream-end-ack':
        if (!this.outputEnded || this.endAcknowledged || message.sequence !== this.sentSequence)
          throw new Error('Invalid stream EOF acknowledgement')
        this.endAcknowledged = true
        this.end!.resolve()
        return
      case 'stream-end':
        if (this.inputEnded || message.sequence !== this.receivedSequence)
          throw new Error('Invalid stream EOF sequence')
        this.inputEnded = true
        this.send({ kind: 'stream-end-ack', sequence: message.sequence })
        this.deliver()
        return
      case 'stream-data': {
        if (this.inputEnded || message.sequence !== this.receivedSequence + 1)
          throw new Error('Invalid stream data sequence')
        const bytes = Buffer.byteLength(message.metadata) + (message.payload?.byteLength ?? 0)
        if (
          bytes > this.incoming.maxFrameBytes ||
          this.receivedBytes + bytes > this.incoming.maxBufferedBytes ||
          this.receivedCount >= this.incoming.maxBufferedFrames
        ) {
          throw new Error('Stream receiving capacity exceeded')
        }
        const value: UtilityProcessStreamFrame = { metadata: JSON.parse(message.metadata), payload: message.payload }
        value.payload = encodeStreamFrame(value, this.incoming.maxFrameBytes).payload
        this.receivedSequence = message.sequence
        this.receivedBytes += bytes
        this.receivedCount += 1
        this.queue.push({ value, bytes, sequence: message.sequence })
        this.deliver()
      }
    }
  }

  get ended(): boolean {
    return this.inputEnded
  }

  abort(reason: unknown): void {
    if (this.failure) return
    this.failure = { reason }
    for (const writer of this.writes.splice(0)) writer.reject(reason)
    this.end?.reject(reason)
    this.reader?.reject(reason)
    this.reader = undefined
    this.queue.length = 0
    this.held = undefined
    this.inFlight.clear()
    this.sentBytes = this.receivedBytes = this.receivedCount = 0
  }

  /** After the close acknowledgement, queued output remains readable without contacting the peer. */
  detach(): void {
    this.detached = true
    // A retained output handle must not keep the host or process generation alive.
    this.send = () => {}
    this.cancel = () => Promise.resolve()
    const error = new Error('Stream is closed')
    for (const writer of this.writes.splice(0)) writer.reject(error)
    this.end?.reject(error)
    this.inFlight.clear()
  }

  private pump(): void {
    try {
      while (this.writes.length > 0) {
        const writer = this.writes[0]
        if (
          this.inFlight.size >= this.outgoing.maxBufferedFrames ||
          this.sentBytes + writer.bytes > this.outgoing.maxBufferedBytes
        )
          break
        this.writes.shift()
        const sequence = ++this.sentSequence
        this.inFlight.set(sequence, writer.bytes)
        this.sentBytes += writer.bytes
        try {
          this.send({ kind: 'stream-data', sequence, metadata: writer.metadata, payload: writer.payload })
          writer.resolve()
        } catch (error) {
          writer.reject(error)
          throw error
        }
      }
      if (this.end && this.writes.length === 0) {
        // Keep the waiter as the write barrier, but only send EOF once.
        if (!this.outputEnded) {
          this.outputEnded = true
          this.send({ kind: 'stream-end', sequence: this.sentSequence })
        }
      }
    } catch (error) {
      this.abort(error)
    }
  }

  private next(): Promise<IteratorResult<UtilityProcessStreamFrame>> {
    if (this.failure) return Promise.reject(this.failure.reason)
    if (this.reader) return Promise.reject(new Error('Concurrent stream reads are not supported'))
    try {
      this.releaseHeld()
    } catch (error) {
      this.abort(error)
      return Promise.reject(error)
    }
    this.reader = Promise.withResolvers<IteratorResult<UtilityProcessStreamFrame>>()
    const promise = this.reader.promise
    this.deliver()
    return promise
  }

  private releaseHeld(): void {
    const held = this.held
    if (!held) return
    this.held = undefined
    this.receivedBytes -= held.bytes
    this.receivedCount -= 1
    if (!this.detached) this.send({ kind: 'stream-credit', sequence: held.sequence })
  }

  private deliver(): void {
    if (!this.reader) return
    const value = this.queue.shift()
    if (!value && !this.inputEnded) return
    const reader = this.reader
    this.reader = undefined
    this.held = value
    if (!value) this.iteratorEnded = true
    reader.resolve(value ? { done: false, value: value.value } : { done: true, value: undefined })
  }
}
