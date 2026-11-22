import type { TerminalSearchProjection, TerminalSearchScope } from '@shared/types/terminal'

import { GhosttySearchCapacityError, type GhosttyTerminalCore } from '../ghostty/GhosttyTerminalCore'
import type { TerminalBlockIndex } from './TerminalBlockIndex'

const ascii = (text: string) => text.replace(/[A-Z]/g, (value) => value.toLowerCase())

/** A view owns one query; the Host schedules its bounded native turns. */
export class TerminalSearch {
  readonly signature: string
  private mutation = -1
  private blockRevision = -1
  private fingerprint = ''
  private closed = false
  private native = false
  private feedRequired = false
  private blockMatches: TerminalSearchProjection['selected'][] = []
  projection: TerminalSearchProjection

  constructor(
    readonly id: string,
    readonly queryRevision: number,
    readonly scope: TerminalSearchScope,
    readonly needle: string,
    private readonly core: GhosttyTerminalCore,
    private readonly blocks: TerminalBlockIndex
  ) {
    this.signature = JSON.stringify({ scope, needle })
    this.projection = {
      queryRevision,
      resultRevision: 0,
      status: 'searching',
      count: 0,
      selected: null,
      matches: [],
      highlightsLimited: false,
      partial: false
    }
    if (!needle) {
      this.closed = true
      this.projection.status = 'unavailable'
      return
    }
    if (scope.kind === 'terminal') {
      try {
        core.openSearch(id, needle)
        this.native = true
      } catch (error) {
        this.fail(error)
      }
    } else {
      try {
        core.openSnapshotSearch(id)
      } catch (error) {
        this.fail(error)
      }
    }
  }

  step(mutation: number, viewport = false): TerminalSearchProjection {
    if (this.closed || ['capacity', 'failed', 'unavailable'].includes(this.projection.status)) return this.projection
    try {
      if (this.scope.kind === 'terminal') {
        const result = this.core.advanceSearch(this.id, viewport || this.mutation !== mutation || this.feedRequired)
        this.feedRequired = result.status === 'feed-required'
        this.mutation = mutation
        this.projection = {
          ...this.projection,
          status: result.status === 'complete' ? 'caught-up' : 'searching',
          count: result.count,
          selected: result.selected,
          matches: result.matches,
          highlightsLimited: result.highlightsLimited
        }
      } else {
        const blockId = this.scope.blockId
        const summary = this.blocks.summaries().find((block) => block.id === blockId)
        if (summary?.contentRevision === this.blockRevision) return this.projection
        const read = this.blocks.read(this.scope.blockId, 'block')
        if (read.kind !== 'content') {
          this.projection.status = 'unavailable'
          return this.publish()
        }
        if (this.blockRevision === read.block.contentRevision) return this.projection
        this.blockRevision = read.block.contentRevision
        const text = ascii(read.text),
          needle = ascii(this.needle)
        const matches: TerminalSearchProjection['selected'][] = []
        let position = 0
        while ((position = text.indexOf(needle, position)) !== -1) {
          if (matches.length === 2000) break
          const first = read.mapping.find((span) => span.start <= position && span.end > position)
          const last = read.mapping.find(
            (span) => span.start < position + needle.length && span.end >= position + needle.length
          )
          matches.push({ index: matches.length, range: first && last ? { start: first.from, end: last.to } : null })
          position += needle.length
        }
        this.blockMatches = matches.reverse().map((match, index) => match && { ...match, index })
        this.projection = {
          ...this.projection,
          status: matches.length === 2000 ? 'limited' : 'caught-up',
          count: matches.length,
          selected: null,
          matches: matches.flatMap((value) => (value?.range ? [value.range] : [])),
          highlightsLimited: matches.length === 2000 || matches.some((match) => !match?.range),
          partial: read.partial.length > 0
        }
      }
      return this.publish()
    } catch (error) {
      this.fail(error)
      return this.publish()
    }
  }

  navigate(resultRevision: number, direction: 'next' | 'previous', mutation: number): TerminalSearchProjection | null {
    if (resultRevision !== this.projection.resultRevision || this.closed) return null
    if (this.scope.kind === 'terminal' && this.mutation !== mutation) {
      this.step(mutation)
      return null
    }
    if (this.scope.kind === 'block') {
      this.step(mutation)
      if (resultRevision !== this.projection.resultRevision) return null
    }
    try {
      if (this.native) {
        const result = this.core.navigateSearch(this.id, direction)
        this.projection = { ...this.projection, selected: result.selected, matches: result.matches }
      } else if (this.blockMatches.length) {
        const current = this.projection.selected?.index
        const index =
          current === undefined
            ? 0
            : (current + (direction === 'next' ? 1 : -1) + this.blockMatches.length) % this.blockMatches.length
        this.projection = { ...this.projection, selected: this.blockMatches[index] }
      }
      return this.publish()
    } catch (error) {
      this.fail(error)
      return this.publish()
    }
  }

  private publish(): TerminalSearchProjection {
    if (Buffer.byteLength(JSON.stringify(this.projection)) > 24 * 1024) {
      this.projection.matches = []
      this.projection.highlightsLimited = true
    }
    const fingerprint = JSON.stringify({ ...this.projection, resultRevision: 0 })
    if (fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint
      this.projection.resultRevision++
    }
    return this.projection
  }

  private fail(error: unknown): void {
    this.projection.status = error instanceof GhosttySearchCapacityError ? 'capacity' : 'failed'
    this.projection.matches = []
    this.projection.selected = null
    this.core.closeSearch(this.id)
    this.native = false
  }

  close(): void {
    this.closed = true
    this.core.closeSearch(this.id)
    this.native = false
    this.projection = { ...this.projection, status: 'unavailable', count: 0, selected: null, matches: [] }
    this.publish()
  }
}
