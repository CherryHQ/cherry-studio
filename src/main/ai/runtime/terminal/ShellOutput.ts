import { randomUUID } from 'node:crypto'
import { openSync, writeFileSync, closeSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

import type { ShellSpillOptions } from '@earendil-works/pi-durable/env'

import { application } from '@application'

/** Preserves the native tool's full-output diagnostic while keeping its in-memory prefix bounded. */
export class ShellOutput {
  private readonly decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
  private chunks: Uint8Array[] = []
  private bytes = 0
  private lines = 0
  private fd?: number
  path?: string

  constructor(
    private readonly spill: ShellSpillOptions | undefined,
    private readonly output: (text: string, source: 'stdout' | 'stderr') => void
  ) {}

  push(data: Uint8Array, source: 'stdout' | 'stderr'): void {
    if (this.spill) {
      this.bytes += data.byteLength
      this.lines += data.reduce((count, byte) => count + Number(byte === 10), 0)
      if (
        this.fd === undefined &&
        (this.bytes > Math.min(this.spill.afterBytes, 256 * 1024) || this.lines + 1 > this.spill.afterLines)
      ) {
        this.path = application.getPath('feature.agents.outputs', `shell-${randomUUID()}.log`)
        this.fd = openSync(this.path, 'wx', 0o600)
        for (const chunk of this.chunks) writeFileSync(this.fd, chunk)
        this.chunks = []
      }
      if (this.fd !== undefined) writeFileSync(this.fd, data)
      else this.chunks.push(data.slice())
    }
    const text = this.decoders[source].write(Buffer.from(data))
    if (text) this.output(text, source)
  }

  close(): void {
    if (this.fd !== undefined) {
      closeSync(this.fd)
      this.fd = undefined
    }
    this.chunks = []
    for (const source of ['stdout', 'stderr'] as const) {
      const tail = this.decoders[source].end()
      if (tail) this.output(tail, source)
    }
  }
}
