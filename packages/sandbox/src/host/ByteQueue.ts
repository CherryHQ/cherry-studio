import { deferred } from './deferred.js'
import { SandboxError } from './SandboxError.js'

export class ByteQueue implements AsyncIterable<Uint8Array> {
  private readonly drainedSignal = deferred<void>()
  readonly drained = this.drainedSignal.promise
  private chunks: Uint8Array[] = []
  private bytes = 0
  private ended = false
  private subscribed = false
  private wake?: () => void

  constructor(
    private readonly limit: number,
    private readonly overflow: () => void
  ) {}

  push(chunk: Uint8Array) {
    if (this.ended) return
    if (this.bytes + chunk.byteLength > this.limit) {
      this.overflow()
      return
    }
    this.chunks.push(Uint8Array.from(chunk))
    this.bytes += chunk.byteLength
    this.wake?.()
  }

  close() {
    this.ended = true
    if (!this.bytes) this.drainedSignal.resolve()
    this.wake?.()
  }

  discard(): boolean {
    const truncated = this.bytes > 0
    this.chunks = []
    this.bytes = 0
    this.close()
    return truncated
  }

  async *[Symbol.asyncIterator]() {
    if (this.subscribed) throw new SandboxError('INVALID_SPEC', 'Output streams have one consumer')
    this.subscribed = true
    for (;;) {
      const chunk = this.chunks.shift()
      if (chunk) {
        this.bytes -= chunk.byteLength
        if (this.ended && !this.bytes) this.drainedSignal.resolve()
        yield chunk
      } else if (this.ended) return
      else
        await new Promise<void>((resolve) => {
          this.wake = resolve
        })
    }
  }
}
