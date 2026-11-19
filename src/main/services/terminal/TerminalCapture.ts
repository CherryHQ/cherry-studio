import type { TerminalCaptureRead } from './contracts'

export class TerminalCapture {
  private readonly bytes: Uint8Array
  private length = 0
  private end = 0

  constructor(private readonly capacity = 2 * 1024 * 1024) {
    this.bytes = new Uint8Array(capacity)
  }

  reset(cursor: number): void {
    this.length = 0
    this.end = cursor
  }

  append(data: Uint8Array): void {
    const retained = data.subarray(Math.max(0, data.byteLength - this.capacity))
    this.end += data.byteLength
    const offset = (this.end - retained.byteLength) % this.capacity
    const first = Math.min(retained.byteLength, this.capacity - offset)
    this.bytes.set(retained.subarray(0, first), offset)
    this.bytes.set(retained.subarray(first), 0)
    this.length = Math.min(this.capacity, this.length + data.byteLength)
  }

  read(cursor: number, limit: number): TerminalCaptureRead {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.end)
      throw new Error('Invalid terminal output cursor')
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid terminal output limit')
    const start = Math.max(cursor, this.end - this.length)
    const size = Math.min(this.end - start, Math.min(60 * 1024, limit))
    const data = new Uint8Array(size)
    const offset = start % this.capacity
    const first = Math.min(size, this.capacity - offset)
    data.set(this.bytes.subarray(offset, offset + first))
    data.set(this.bytes.subarray(0, size - first), first)
    return { start, next: start + size, end: this.end, truncated: cursor < start, data }
  }

  get cursor(): number {
    return this.end
  }
}
