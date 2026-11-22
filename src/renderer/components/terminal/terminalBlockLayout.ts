import type { TerminalBlockSummary, TerminalSourcePoint } from '@shared/types/terminal'

export type TerminalLayoutRun =
  | { kind: 'terminal'; start: number; count: number; sourceStart: number }
  | { kind: 'controls' | 'collapsed'; start: number; count: number; block: TerminalBlockSummary; lines: number }
export interface TerminalBlockLayout {
  runs: TerminalLayoutRun[]
  total: number
  top: number
  rows: number
}
export interface TerminalPresentation {
  collapsed: string[]
  offset: number
  selection: { blockId: string; contentRevision: number } | null
  find: { needle: string; scope: 'terminal' | 'block'; blockId: string | null }
}
export const newTerminalPresentation = (): TerminalPresentation => ({
  collapsed: [],
  offset: 0,
  selection: null,
  find: { needle: '', scope: 'terminal', blockId: null }
})

/** One row projection is shared by painting, controls, selection and pointer conversion. */
export function terminalBlockLayout(
  blocks: readonly TerminalBlockSummary[],
  collapsed: readonly string[],
  total: number,
  rows: number,
  offset: number,
  contentEnd: number = total
): TerminalBlockLayout {
  const runs: TerminalLayoutRun[] = []
  let source = 0,
    visual = 0
  const append = (end: number) => {
    if (end > source) {
      runs.push({ kind: 'terminal', start: visual, count: end - source, sourceStart: source })
      visual += end - source
      source = end
    }
  }
  for (const block of blocks) {
    const prompt = block.prompt ?? block.output
    if (!prompt || prompt.x !== 0 || prompt.y < source || prompt.y >= total) continue
    append(prompt.y)
    runs.push({ kind: 'controls', start: visual, count: 2, block, lines: 0 })
    visual += 2
    if (
      block.reliable &&
      !block.outputEmpty &&
      block.status === 'completed' &&
      collapsed.includes(block.id) &&
      block.output &&
      block.end &&
      block.output.x === 0 &&
      block.end.x === 0 &&
      block.end.y > block.output.y
    ) {
      append(block.output.y)
      const lines = block.end.y - block.output.y
      runs.push({ kind: 'collapsed', start: visual, count: 1, block, lines })
      visual++
      source = block.end.y
    }
  }
  append(total)
  const height = Math.max(rows, visual - Math.max(0, total - contentEnd))
  return { runs, total: height, top: Math.max(0, height - rows - Math.max(0, offset)), rows }
}

export function terminalSourceAt(layout: TerminalBlockLayout, visualRow: number): number | null {
  const row = layout.top + visualRow
  const run = layout.runs.find((value) => row >= value.start && row < value.start + value.count)
  return run?.kind === 'terminal' ? run.sourceStart + row - run.start : null
}
export function terminalVisualAt(layout: TerminalBlockLayout, point: TerminalSourcePoint): number | null {
  const run = layout.runs.find(
    (value) => value.kind === 'terminal' && point.y >= value.sourceStart && point.y < value.sourceStart + value.count
  )
  return run?.kind === 'terminal' ? run.start + point.y - run.sourceStart - layout.top : null
}
export function terminalVisibleSpans(layout: TerminalBlockLayout) {
  return layout.runs.flatMap((run) => {
    if (run.kind !== 'terminal') return []
    const first = Math.max(run.start, layout.top),
      last = Math.min(run.start + run.count, layout.top + layout.rows)
    return last > first
      ? [{ sourceStart: run.sourceStart + first - run.start, count: last - first, targetStart: first - layout.top }]
      : []
  })
}
export function terminalOffsetForSource(layout: TerminalBlockLayout, source: number): number {
  const run = layout.runs.find(
    (value) => value.kind === 'terminal' && source >= value.sourceStart && source < value.sourceStart + value.count
  )
  return run?.kind === 'terminal' ? Math.max(0, layout.total - layout.rows - (run.start + source - run.sourceStart)) : 0
}
