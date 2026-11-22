import { createHash } from 'node:crypto'

import type { TerminalBlockRead, TerminalBlockSummary, TerminalSourcePoint } from '@shared/types/terminal'

import type { GhosttyTerminalCore } from '../ghostty/GhosttyTerminalCore'
import type { ShellIntegrationEvent } from './ShellIntegration'

interface Block {
  summary: TerminalBlockSummary
  fingerprint?: string
  verificationStart?: string
}
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const metadata = (value: string | undefined): string | null =>
  value !== undefined && Buffer.byteLength(value) <= 8192 && size(value) <= 8192 ? value : null
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const samePoint = (first: TerminalSourcePoint | null, second: TerminalSourcePoint | null) =>
  first?.x === second?.x && first?.y === second?.y

/** Metadata and tracked anchors only; text remains in the authoritative core. */
export class TerminalBlockIndex {
  private readonly blocks: Block[] = []
  private sequence = 0
  private prompt: string | null = null
  private cwd: string | null = null
  private active: Block | null = null
  private pendingCommand: string | undefined
  revision = 0
  private verifiedMutation = -1

  constructor(
    private readonly core: GhosttyTerminalCore,
    private readonly resourceId: string
  ) {}

  submitted(command: string): void {
    this.pendingCommand = command
  }

  written(): void {
    if (this.active) this.active.summary.contentRevision++
  }

  boundary(event: Exclude<ShellIntegrationEvent, { kind: 'ready' }>): void {
    this.verifiedMutation = -1
    if (event.kind === 'unknown') {
      if (this.active) {
        this.active.summary.status = 'unknown'
        this.active.summary.reliable = false
        this.active.summary.contentRevision++
        this.active = null
        this.revision++
      }
      this.pendingCommand = undefined
      return
    }
    if (this.core.isAlternateScreen()) return
    if (event.kind === 'prompt') {
      if (this.active) {
        const block = this.active
        this.core.track(`${block.summary.id}:end`)
        block.summary.end = this.core.anchorPoint(`${block.summary.id}:end`)
        block.summary.status = 'completed'
        block.summary.exitCode = event.exitCode
        block.summary.contentRevision++
        this.revision++
        const output = this.core.anchorPoint(`${block.summary.id}:output`)
        const end = block.summary.end
        block.summary.outputEmpty = !!(output && end && this.format(output, end, 1) === '')
        block.summary.reliable = !!(output && end && (output.y < end.y || (output.y === end.y && output.x <= end.x)))
        if (block.summary.reliable && output && end && (end.y > output.y || end.x > output.x)) {
          const origin = this.core.viewportPointToScreen(0, 0)?.y ?? 0
          const prompt = this.core.anchorPoint(`${block.summary.id}:prompt`) ?? output
          const from = { x: prompt.y >= origin ? prompt.x : 0, y: Math.max(prompt.y, origin) }
          const text = this.format(from, end, 64 * 1024)
          if (text !== null) {
            block.verificationStart = `${block.summary.id}:verify`
            this.core.track(block.verificationStart, from)
            block.fingerprint = hash(text)
          } else block.summary.reliable = false
        }
        this.active = null
      } else if (this.prompt) {
        this.cwd = metadata(event.cwd)
        this.core.track(this.prompt)
        return
      }
      this.cwd = metadata(event.cwd)
      if (this.prompt) this.core.dropAnchor(this.prompt)
      this.prompt = `${this.resourceId}:prompt`
      this.core.track(this.prompt)
      this.pendingCommand = undefined
    } else {
      if (!this.prompt || this.active) return
      const id = `${this.resourceId}:${++this.sequence}`
      const prompt = this.core.anchorPoint(this.prompt)
      if (prompt) this.core.track(`${id}:prompt`, prompt)
      this.core.track(`${id}:output`)
      const block: Block = {
        summary: {
          outputEmpty: false,
          id,
          contentRevision: 1,
          command: metadata(this.pendingCommand ?? event.command),
          cwd: this.cwd,
          status: 'running',
          exitCode: null,
          reliable: false,
          prompt,
          output: this.core.anchorPoint(`${id}:output`),
          end: null
        }
      }
      this.blocks.push(block)
      this.active = block
      this.core.dropAnchor(this.prompt)
      this.prompt = null
      this.pendingCommand = undefined
      this.revision++
      while (this.blocks.length > 256 || size(this.blocks.map((value) => value.summary)) > 256 * 1024) {
        const retired = this.blocks.find((value) => value !== this.active)
        if (!retired) break
        this.remove(retired)
      }
    }
  }

  summaries(): TerminalBlockSummary[] {
    if (this.core.isAlternateScreen()) return []
    if (this.verifiedMutation === this.core.revision) return this.blocks.map((block) => structuredClone(block.summary))
    this.verifiedMutation = this.core.revision
    try {
      this.core.scrollToBottom()
      const origin = this.core.viewportPointToScreen(0, 0)?.y ?? 0
      for (const block of [...this.blocks]) {
        const value = block.summary
        const prompt = this.core.anchorPoint(`${value.id}:prompt`)
        const output = this.core.anchorPoint(`${value.id}:output`)
        const end = value.status === 'running' ? this.core.cursorPoint() : this.core.anchorPoint(`${value.id}:end`)
        if (!prompt && !output && !end && block !== this.active) {
          this.remove(block)
          continue
        }
        if (!samePoint(value.prompt, prompt) || !samePoint(value.output, output) || !samePoint(value.end, end)) {
          value.contentRevision++
          this.revision++
        }
        value.prompt = prompt
        value.output = output
        value.end = end
        if (value.reliable && block.verificationStart && end && end.y >= origin) {
          const start = this.core.anchorPoint(block.verificationStart)
          if (start && block.fingerprint !== hash(this.format(start, end, 64 * 1024) ?? '\0')) {
            value.reliable = false
            value.contentRevision++
            this.revision++
          }
        }
      }
      return this.blocks.map((block) => structuredClone(block.summary))
    } finally {
      this.core.scrollToBottom()
    }
  }

  read(blockId: string, part: 'command' | 'output' | 'block', exact?: number): TerminalBlockRead {
    const summary = this.summaries().find((block) => block.id === blockId)
    if (!summary) return { kind: 'unavailable' }
    if (exact !== undefined && exact !== summary.contentRevision) return { kind: 'stale' }
    const partial: Extract<TerminalBlockRead, { kind: 'content' }>['partial'] = []
    if (summary.command === null || summary.cwd === null) partial.push('metadata')
    if (part === 'command')
      return summary.command === null
        ? { kind: 'unavailable' }
        : { kind: 'content', block: summary, text: summary.command, partial, mapping: [] }
    if (!summary.end || (summary.status !== 'running' && !summary.reliable)) return { kind: 'unavailable' }
    const end = summary.end
    if (!summary.output) partial.push('history')
    let start = summary.output ?? { x: 0, y: 0 }
    let text = this.format(start, end, 40 * 1024)
    if (text === null) {
      partial.push('size')
      let low = start.y,
        high = end.y
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (this.format({ x: 0, y: middle }, end, 40 * 1024) === null) low = middle + 1
        else high = middle
      }
      start = { x: 0, y: low }
      text = this.format(start, end, 40 * 1024) ?? ''
    }
    if (!summary.prompt && !partial.includes('history')) partial.push('history')
    const mapping: Extract<TerminalBlockRead, { kind: 'content' }>['mapping'] = []
    const output = text
    let mapped = '',
      mappingBytes = 0
    try {
      const cols = this.core.dimensions().cols
      for (let y = start.y; y < end.y || (y === end.y && end.x > 0);) {
        const rows = this.core.sourceRows(y, Math.min(128, end.y - y + 1))
        if (!rows.length) break
        for (const row of rows) {
          if (y > end.y) break
          const first = y === start.y ? start.x : 0
          const last = y === end.y ? end.x : cols
          const cells = row.cells.slice(first, last)
          let line = ''
          const lineMapping: typeof mapping = []
          for (let x = 0; x < cells.length; x++) {
            const cell = cells[x]
            if (cell.wide === 2 || cell.wide === 3) continue
            const value = cell.text || ' '
            const span = {
              start: mapped.length + line.length,
              end: mapped.length + line.length + value.length,
              from: { x: first + x, y },
              to: { x: Math.min(cols - 1, first + x + (cell.wide === 1 ? 1 : 0)), y }
            }
            if (mappingBytes + size(span) < 8192) {
              lineMapping.push(span)
              mappingBytes += size(span)
            }
            line += value
          }
          line = line.trimEnd()
          mapping.push(...lineMapping.filter((span) => span.end <= mapped.length + line.length))
          mapped += line
          if (!row.wrapsToNext && y < end.y - 1) mapped += '\n'
          y++
          if (mapped.length > output.length + cols) break
        }
        if (mapped.length > output.length + cols) break
      }
    } finally {
      this.core.scrollToBottom()
    }
    if (mapped !== output) mapping.length = 0
    const prefixFor = () =>
      part === 'block'
        ? `${JSON.stringify({ cwd: summary.cwd, status: summary.status, exitCode: summary.exitCode, commandAvailable: summary.command !== null, partial })}\n${summary.command ?? ''}\n`
        : ''
    let prefix = prefixFor()
    for (const span of mapping) {
      span.start += prefix.length
      span.end += prefix.length
    }
    const result: Extract<TerminalBlockRead, { kind: 'content' }> = {
      kind: 'content',
      block: summary,
      text: prefix + output,
      partial,
      mapping
    }
    while (size(result) > 60 * 1024 && result.mapping.length) result.mapping.pop()
    if (size(result) > 60 * 1024) {
      result.partial.push('size')
      prefix = prefixFor()
      result.mapping = []
      let tail = output
      while (size({ ...result, text: prefix + tail }) > 60 * 1024 && tail.length)
        tail = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(tail)]
          .slice(Math.max(1, Math.floor(tail.length / 8)))
          .map((value) => value.segment)
          .join('')
      result.text = prefix + tail
    }
    return result
  }

  command(id: string, revision: number): string | null {
    const block = this.blocks.find((value) => value.summary.id === id)?.summary
    return block?.contentRevision === revision && block.status === 'completed' ? block.command : null
  }

  private format(start: TerminalSourcePoint, end: TerminalSourcePoint, limit: number): string | null {
    if (end.y < start.y || (end.y === start.y && end.x <= start.x)) return ''
    const cols = this.core.dimensions().cols
    return this.core.formatRange(start, end.x > 0 ? { x: end.x - 1, y: end.y } : { x: cols - 1, y: end.y - 1 }, limit)
  }

  private remove(block: Block): void {
    for (const suffix of ['prompt', 'output', 'end', 'verify']) this.core.dropAnchor(`${block.summary.id}:${suffix}`)
    this.blocks.splice(this.blocks.indexOf(block), 1)
    this.revision++
  }

  dispose(): void {
    for (const block of [...this.blocks]) this.remove(block)
    if (this.prompt) this.core.dropAnchor(this.prompt)
  }
}
