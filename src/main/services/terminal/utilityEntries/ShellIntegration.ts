import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export type ShellIntegrationEvent =
  | { kind: 'program'; revision: number; command?: string }
  | { kind: 'prompt'; revision: number; exitCode: number; cwd: string }
  | { kind: 'ready'; revision: number; promptRevision: number }
  | { kind: 'unknown' }

/** Recognizes only this managed shell's bounded, monotonically numbered integration frames. */
export class ShellIntegration {
  private readonly decoder = new StringDecoder('utf8')
  private readonly prefix: string
  private pending = ''
  private revision = 0

  constructor(
    token: string,
    private readonly event: (event: ShellIntegrationEvent) => void
  ) {
    this.prefix = `\x1b]633;Cherry;${token};`
  }

  push(data: Uint8Array, output: (data: Uint8Array) => void): void {
    this.pending += this.decoder.write(Buffer.from(data))
    while (this.pending) {
      const start = this.pending.indexOf(this.prefix)
      if (start === -1) {
        let tail = Math.min(this.prefix.length - 1, this.pending.length)
        while (tail && !this.prefix.startsWith(this.pending.slice(-tail))) tail--
        const text = this.pending.slice(0, this.pending.length - tail)
        if (text) output(Buffer.from(text))
        this.pending = this.pending.slice(this.pending.length - tail)
        return
      }
      if (start) output(Buffer.from(this.pending.slice(0, start)))
      this.pending = this.pending.slice(start)
      const end = this.pending.indexOf('\x07', this.prefix.length)
      if (end === -1 && this.pending.length <= 16 * 1024) return
      if (end === -1 || end > 16 * 1024) {
        this.event({ kind: 'unknown' })
        output(Buffer.from(this.pending.slice(0, this.prefix.length)))
        this.pending = this.pending.slice(this.prefix.length)
        continue
      }
      const fields = this.pending.slice(this.prefix.length, end).split(';')
      this.pending = this.pending.slice(end + 1)
      const revision = Number(fields[0])
      if (!Number.isSafeInteger(revision) || revision <= this.revision) continue
      this.revision = revision
      if ((fields.length === 2 || fields.length === 3) && fields[1] === 'B') {
        const encoded = fields.length === 3 ? fields[2] : ''
        const bytes = Buffer.from(encoded, 'base64')
        const command = bytes.toString('utf8')
        this.event({
          kind: 'program',
          revision,
          ...(encoded &&
          bytes.toString('base64') === encoded &&
          !command.includes('\0') &&
          Buffer.byteLength(command) <= 8192 &&
          Buffer.from(command).equals(bytes)
            ? { command }
            : {})
        })
      } else if (
        fields.length === 3 &&
        fields[1] === 'R' &&
        /^\d+$/.test(fields[2]) &&
        Number.isSafeInteger(Number(fields[2])) &&
        Number(fields[2]) > 0 &&
        Number(fields[2]) < revision
      ) {
        this.event({ kind: 'ready', revision, promptRevision: Number(fields[2]) })
      } else if (
        fields.length === 4 &&
        fields[1] === 'P' &&
        /^-?\d{1,10}$/.test(fields[2]) &&
        Number.isSafeInteger(Number(fields[2])) &&
        Math.abs(Number(fields[2])) <= 0xffffffff
      ) {
        const cwd = Buffer.from(fields[3], 'base64').toString('utf8')
        if (path.isAbsolute(cwd) && !cwd.includes('\0'))
          this.event({ kind: 'prompt', revision, cwd, exitCode: Number(fields[2]) })
        else this.event({ kind: 'unknown' })
      } else this.event({ kind: 'unknown' })
    }
  }

  finish(output: (data: Uint8Array) => void): void {
    const remaining = this.pending + this.decoder.end()
    this.pending = ''
    if (remaining) output(Buffer.from(remaining))
    this.event({ kind: 'unknown' })
  }
}
