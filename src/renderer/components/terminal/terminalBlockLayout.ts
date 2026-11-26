import type { TerminalBlockSummary, TerminalSourcePoint } from '@shared/types/terminal'

export type TerminalLayoutRun =
  | { kind: 'terminal'; start: number; count: number; sourceStart: number }
  | { kind: 'controls'; start: number; count: number; block: TerminalBlockSummary }
  | {
      kind: 'fold'
      start: number
      count: number
      sourceStart: number
      sourceCount: number
      block: TerminalBlockSummary
    }
export interface TerminalBlockLayout {
  runs: TerminalLayoutRun[]
  total: number
  top: number
  rows: number
}
export interface TerminalPresentation {
  offset: number
  expandedBlocks?: Set<string>
  selection: { blockId: string; contentRevision: number } | null
  find: { needle: string; scope: 'terminal' } | { needle: string; scope: 'block'; blockId: string }
}
export const newTerminalPresentation = (): TerminalPresentation => ({
  offset: 0,
  selection: null,
  find: { needle: '', scope: 'terminal' }
})

export function terminalBlockSourceRows(block: TerminalBlockSummary, contentEnd: number) {
  const start = block.prompt?.y ?? block.output?.y
  const boundary = block.end ? block.end.y + Number(block.end.x > 0) : block.status === 'running' ? contentEnd : null
  const end = boundary === null ? null : Math.min(boundary, contentEnd)
  return start !== undefined && end !== null && end > start ? { start, end } : null
}

/** One row projection is shared by painting, controls, selection and pointer conversion. */
export function terminalBlockLayout(
  blocks: readonly TerminalBlockSummary[],
  total: number,
  rows: number,
  offset: number,
  contentEnd: number = total,
  nativeRows: number = rows,
  leadingRows = 0,
  expandedBlocks?: ReadonlySet<string>
): TerminalBlockLayout {
  leadingRows = Math.min(Math.max(0, leadingRows), Math.max(0, rows - 1))
  const runs: TerminalLayoutRun[] = []
  const sourceTop = Math.max(0, total - nativeRows)
  let screenTop = sourceTop + leadingRows
  let source = 0,
    visual = leadingRows
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
    const header = visual
    runs.push({ kind: 'controls', start: header, count: 2, block })
    visual += 2
    if (prompt.y < sourceTop) screenTop += 2
    const firstHidden = (block.output?.y ?? total) + Math.max(1, Math.floor(rows / 2))
    const end = Math.min(block.end?.y ?? 0, contentEnd, total)
    if (block.status === 'completed' && block.reliable && !expandedBlocks?.has(block.id) && firstHidden < end) {
      append(firstHidden)
      runs.push({
        kind: 'fold',
        start: visual,
        count: 2,
        sourceStart: firstHidden,
        sourceCount: end - firstHidden,
        block
      })
      visual += 2
      source = end
      if (sourceTop >= end) screenTop -= end - firstHidden - 2
      else if (sourceTop >= firstHidden) screenTop = header
    }
  }
  append(total)
  const height = Math.max(screenTop + rows, visual - Math.max(0, total - contentEnd))
  return {
    runs,
    total: height,
    top: Math.max(0, height - rows - Math.max(0, offset)),
    rows
  }
}

export function terminalSourceAt(layout: TerminalBlockLayout, visualRow: number): number | null {
  const row = layout.top + visualRow
  const run = layout.runs.find((value) => row >= value.start && row < value.start + value.count)
  return run?.kind === 'terminal' ? run.sourceStart + row - run.start : null
}

export function terminalBlockHeaders({
  layout,
  height,
  inset,
  scrollTop = 0
}: {
  layout: TerminalBlockLayout
  height: number
  inset: number
  scrollTop?: number
}) {
  const headers = layout.runs.filter((run) => run.kind === 'controls')
  return headers.flatMap((run, index) => {
    const naturalTop = (run.start - layout.top) * height - scrollTop
    const next = headers[index + 1]
    let top = Math.min(
      Math.max(naturalTop, inset),
      next ? (next.start - layout.top) * height - scrollTop - run.count * height : Infinity
    )
    if (top + run.count * height <= inset || top >= layout.rows * height) return []
    const end = run.block.status === 'completed' && run.block.end ? terminalVisualAt(layout, run.block.end) : null
    if (end !== null) top = Math.min(top, end * height - scrollTop - run.count * height)
    return top + run.count * height > inset && top < layout.rows * height ? [{ run, top }] : []
  })
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
      ? [
          {
            sourceStart: run.sourceStart + first - run.start,
            count: last - first,
            targetStart: first - layout.top
          }
        ]
      : []
  })
}
export function terminalOffsetForSource(layout: TerminalBlockLayout, source: number, coveredRows = 0): number {
  const run = layout.runs.find(
    (value) => value.kind === 'terminal' && source >= value.sourceStart && source < value.sourceStart + value.count
  )
  return run?.kind === 'terminal'
    ? Math.max(
        0,
        Math.min(
          layout.total - layout.rows,
          layout.total - layout.rows - (run.start + source - run.sourceStart) + coveredRows
        )
      )
    : 0
}

export function terminalBlockNavigation(
  layout: TerminalBlockLayout,
  blocks: readonly TerminalBlockSummary[],
  blockId: string,
  contentEnd: number
): Record<'scroll_top' | 'scroll_bottom' | 'previous_block' | 'next_block', number | null> {
  const ordered = blocks
    .filter((block) => {
      const start = block.prompt ?? block.output
      return start && start.y >= 0 && start.y < contentEnd
    })
    .toSorted((a, b) => (a.prompt ?? a.output)!.y - (b.prompt ?? b.output)!.y)
  const index = ordered.findIndex((block) => block.id === blockId)
  const maxOffset = Math.max(0, layout.total - layout.rows)
  const offsetFor = (block: TerminalBlockSummary | undefined, bottom = false) => {
    if (!block) return null
    const start = (block.prompt ?? block.output)!
    const range = terminalBlockSourceRows(block, contentEnd)
    if (bottom && !range) return null
    const point = bottom ? { x: 0, y: range!.end - 1 } : start
    const fold = layout.runs.find(
      (run) =>
        run.kind === 'fold' &&
        run.block.id === block.id &&
        point.y >= run.sourceStart &&
        point.y < run.sourceStart + run.sourceCount
    )
    const row = terminalVisualAt(layout, point) ?? (bottom && fold ? fold.start + fold.count - 1 - layout.top : null)
    if (row === null) return null
    const header = layout.runs.find((run) => run.kind === 'controls' && run.block.id === block.id)
    const top = bottom ? layout.top + row - layout.rows + 1 : (header?.start ?? layout.top + row)
    return Math.max(0, Math.min(maxOffset, maxOffset - top))
  }
  return {
    scroll_top: offsetFor(ordered[index]),
    scroll_bottom: offsetFor(ordered[index], true),
    previous_block: index < 0 ? null : offsetFor(ordered[index - 1]),
    next_block: index < 0 ? null : offsetFor(ordered[index + 1])
  }
}

export function terminalFindReveal({
  layout,
  range,
  cols,
  cell,
  obstruction,
  headerRows
}: {
  layout: TerminalBlockLayout
  range: { start: TerminalSourcePoint; end: TerminalSourcePoint }
  cols: number
  cell: { width: number; height: number }
  obstruction: { left: number; right: number; top: number; bottom: number }
  headerRows: number
}): { offset: number; leadingRows: number } {
  const first = terminalVisualAt(layout, range.start),
    last = terminalVisualAt(layout, range.end),
    currentOffset = layout.total - layout.rows - layout.top
  if (first === null || last === null) return { offset: currentOffset, leadingRows: 0 }
  const obscured = (top: number) => {
    for (
      let row = Math.max(0, first + layout.top - top);
      row <= Math.min(layout.rows - 1, last + layout.top - top);
      row++
    ) {
      const source = terminalSourceAt({ ...layout, top }, row)
      if (source === null) continue
      const left = source === range.start.y ? range.start.x * cell.width : 0
      const right = (source === range.end.y ? range.end.x + 1 : cols) * cell.width
      if (
        left < obstruction.right &&
        right > obstruction.left &&
        row * cell.height < obstruction.bottom + 8 &&
        (row + 1) * cell.height > obstruction.top
      )
        return true
    }
    return false
  }
  if (first >= headerRows && last < layout.rows && !obscured(layout.top))
    return { offset: currentOffset, leadingRows: 0 }
  const initialOffset = terminalOffsetForSource(layout, range.start.y, headerRows)
  const coveredRows = obscured(layout.total - layout.rows - initialOffset)
    ? Math.min(layout.rows - 1, Math.max(headerRows, Math.ceil((obstruction.bottom + 8) / cell.height)))
    : headerRows
  const leadingRows = Math.max(0, coveredRows - first - layout.top)
  return {
    offset: Math.max(0, layout.total - layout.rows - first - layout.top + coveredRows),
    leadingRows
  }
}
