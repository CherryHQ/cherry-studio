import { expect, it } from 'vitest'

import type { TerminalBlockSummary } from '@shared/types/terminal'

import {
  terminalBlockLayout,
  terminalBlockHeaders,
  terminalSourceAt,
  terminalVisualAt,
  terminalVisibleSpans,
  terminalOffsetForSource,
  terminalBlockSourceRows,
  terminalBlockNavigation,
  terminalFindReveal
} from '../terminalBlockLayout'
const expandedLayout = (...args: Parameters<typeof terminalBlockLayout>) => {
  args[7] = new Set(args[0].map((block) => block.id))
  return terminalBlockLayout(...args)
}
const block: TerminalBlockSummary = {
  timing: null,
  outputEmpty: false,
  id: 'block',
  contentRevision: 1,
  command: 'run',
  cwd: '/tmp',
  status: 'completed',
  exitCode: 0,
  reliable: true,
  prompt: { x: 0, y: 0 },
  output: { x: 0, y: 2 },
  end: { x: 0, y: 12 }
}
it('previews half a view of completed output without hiding the command or following prompt', () => {
  const completed = { ...block, end: { x: 0, y: 110 } }
  const layout = terminalBlockLayout([completed], 120, 20, 0, 112)
  expect(layout.top).toBe(0)
  expect(layout.total).toBe(20)
  expect(layout.runs.find((run) => run.kind === 'fold')).toMatchObject({ sourceStart: 12, sourceCount: 98 })
  expect(terminalVisualAt(layout, { x: 0, y: 0 })).toBe(2)
  expect(terminalVisualAt(layout, { x: 0, y: 11 })).toBe(13)
  expect(terminalVisualAt(layout, { x: 0, y: 12 })).toBeNull()
  expect(terminalVisualAt(layout, { x: 0, y: 110 })).toBe(16)
  expect(terminalSourceAt(layout, 14)).toBeNull()
  expect(terminalVisibleSpans(layout)).toContainEqual({ sourceStart: 110, count: 4, targetStart: 16 })
  const bottom = terminalBlockNavigation(layout, [completed], completed.id, 112).scroll_bottom
  expect(bottom).not.toBeNull()
})

it('folds only reliable completed output above the threshold and keeps a shared last row visible', () => {
  const completed = { ...block, end: { x: 4, y: 110 } }
  for (const value of [
    { ...completed, status: 'running' as const, end: null },
    { ...completed, status: 'unknown' as const, end: null },
    { ...completed, reliable: false },
    { ...completed, end: { x: 0, y: 12 } }
  ])
    expect(terminalBlockLayout([value], 120, 20, 0, 112).runs.some((run) => run.kind === 'fold')).toBe(false)
  const preview = terminalBlockLayout([completed], 120, 20, 0, 112)
  expect(terminalVisualAt(preview, { x: 0, y: 110 })).not.toBeNull()
  const expanded = terminalBlockLayout([completed], 120, 20, 0, 112, 20, 0, new Set([completed.id]))
  expect(expanded.runs.some((run) => run.kind === 'fold')).toBe(false)
  expect(terminalVisualAt(expanded, { x: 0, y: 109 })).not.toBeNull()
})

it('adapts previews to the viewport while preserving the cleared native screen origin', () => {
  const completed = { ...block, end: { x: 0, y: 90 } }
  const narrow = terminalBlockLayout([completed], 140, 20, 0, 125)
  expect(terminalSourceAt(narrow, 0)).toBe(120)
  const larger = terminalBlockLayout([completed], 140, 40, 0, 125, 20)
  expect(larger.runs.find((run) => run.kind === 'fold')).toMatchObject({ sourceStart: 22 })
  expect(narrow.runs.find((run) => run.kind === 'fold')).toMatchObject({ sourceStart: 12 })
})

it('navigates blocks in source order without wrapping and keeps the next prompt outside the bottom boundary', () => {
  const middle = { ...block, id: 'middle', prompt: { x: 0, y: 30 }, end: { x: 0, y: 60 } }
  const last = { ...block, id: 'last', prompt: { x: 0, y: 70 }, end: { x: 0, y: 95 } }
  const layout = expandedLayout([block, middle, last], 100, 10, 0)
  const navigation = terminalBlockNavigation(layout, [last, block, middle], middle.id, 95)
  const at = (offset: number | null) => {
    expect(offset).not.toBeNull()
    return { ...layout, top: layout.total - layout.rows - offset! }
  }
  expect(terminalSourceAt(at(navigation.previous_block), 2)).toBe(0)
  expect(terminalSourceAt(at(navigation.next_block), 2)).toBe(70)
  expect(terminalSourceAt(at(navigation.scroll_top), 2)).toBe(30)
  expect(terminalSourceAt(at(navigation.scroll_bottom), 9)).toBe(59)
  expect(terminalBlockNavigation(layout, [block, middle, last], block.id, 95).previous_block).toBeNull()
  expect(terminalBlockNavigation(layout, [block, middle, last], last.id, 95).next_block).toBeNull()
  expect(Object.values(terminalBlockNavigation(layout, [middle, last], block.id, 95))).toEqual([null, null, null, null])
})

it('uses the latest running output and preserves source alignment when find removes a block header', () => {
  const running = { ...block, status: 'running' as const, end: null }
  const layout = expandedLayout([], 100, 10, 0)
  const navigation = terminalBlockNavigation(layout, [running], running.id, 50)
  expect(terminalSourceAt({ ...layout, top: layout.total - layout.rows - navigation.scroll_top! }, 0)).toBe(0)
  expect(terminalSourceAt({ ...layout, top: layout.total - layout.rows - navigation.scroll_bottom! }, 9)).toBe(49)
  const partial = { ...block, end: { x: 3, y: 12 } }
  const bottom = terminalBlockNavigation(layout, [partial], partial.id, 50).scroll_bottom!
  expect(terminalSourceAt({ ...layout, top: layout.total - layout.rows - bottom }, 9)).toBe(12)
  expect(terminalBlockNavigation(layout, [{ ...running, status: 'unknown' }], running.id, 50).scroll_bottom).toBeNull()
})

it('bounds a block highlight before the next prompt and includes a partially occupied final row', () => {
  expect(terminalBlockSourceRows({ ...block, prompt: { x: 0, y: 2 }, end: { x: 0, y: 5 } }, 10)).toEqual({
    start: 2,
    end: 5
  })
  expect(terminalBlockSourceRows({ ...block, end: { x: 3, y: 5 } }, 10)).toEqual({ start: 0, end: 6 })
  expect(terminalBlockSourceRows({ ...block, status: 'running', end: null }, 7)).toEqual({ start: 0, end: 7 })
  expect(terminalBlockSourceRows({ ...block, prompt: null, output: { x: 0, y: 3 } }, 5)).toEqual({ start: 3, end: 5 })
  expect(terminalBlockSourceRows({ ...block, end: { x: 0, y: 0 } }, 10)).toBeNull()
})
it('starts the first metadata row at the viewport edge without adding a top gutter', () => {
  const layout = expandedLayout([block], 16, 20, 0)
  expect(terminalBlockHeaders({ layout, height: 19, inset: 0 }).map(({ top }) => top)).toEqual([0])
  expect(terminalSourceAt(layout, 2)).toBe(0)
})

const findGeometry = {
  cols: 24,
  cell: { width: 8, height: 19 },
  obstruction: { left: 64, right: 192, top: 8, bottom: 48 },
  headerRows: 0
}

it('leaves the first-row match to the left of the floating bar in place', () => {
  const layout = expandedLayout([], 44, 44, 0, 5)
  expect(
    terminalFindReveal({
      ...findGeometry,
      layout,
      range: { start: { x: 2, y: 0 }, end: { x: 7, y: 0 } }
    })
  ).toEqual({ offset: 0, leadingRows: 0 })
  expect(terminalSourceAt(layout, 0)).toBe(0)
  expect(layout.total).toBe(layout.rows)
})

it('adds scrollable leading space only when a first-row match is behind the bar', () => {
  const layout = expandedLayout([], 44, 44, 0, 5)
  const revealed = terminalFindReveal({
    ...findGeometry,
    layout,
    range: { start: { x: 12, y: 0 }, end: { x: 14, y: 0 } }
  })
  expect(revealed).toEqual({ offset: 3, leadingRows: 3 })
  const first = expandedLayout([], 44, 44, revealed.offset, 5, 44, revealed.leadingRows)
  expect(terminalVisualAt(first, { x: 12, y: 0 })).toBe(3)
  expect(terminalSourceAt(first, 2)).toBeNull()
  expect(terminalVisibleSpans(first)).toEqual([{ sourceStart: 0, count: 41, targetStart: 3 }])
  const bottom = expandedLayout([], 44, 44, 0, 5, 44, revealed.leadingRows)
  expect(terminalSourceAt(bottom, 0)).toBe(0)
})

it('does not move an already visible match below the bar', () => {
  const layout = expandedLayout([], 44, 44, 0, 8)
  expect(
    terminalFindReveal({
      ...findGeometry,
      layout,
      range: { start: { x: 12, y: 6 }, end: { x: 14, y: 6 } }
    })
  ).toEqual({ offset: 0, leadingRows: 0 })
})

it('uses existing history to reveal an offscreen match instead of reserving viewport rows', () => {
  const layout = expandedLayout([], 100, 10, 70)
  const revealed = terminalFindReveal({
    ...findGeometry,
    layout,
    range: { start: { x: 12, y: 15 }, end: { x: 14, y: 15 } }
  })
  expect(revealed).toEqual({ offset: 78, leadingRows: 0 })
  expect(terminalVisualAt(expandedLayout([], 100, 10, revealed.offset), { x: 12, y: 15 })).toBe(3)
})

it('keeps the cleared native screen origin when opening an unobstructing floating bar', () => {
  const layout = expandedLayout([], 124, 44, 0, 86, 44)
  expect(terminalSourceAt(layout, 0)).toBe(80)
  expect(
    terminalFindReveal({
      ...findGeometry,
      layout,
      range: { start: { x: 2, y: 80 }, end: { x: 7, y: 80 } }
    })
  ).toEqual({ offset: 0, leadingRows: 0 })
})

it('tests every wrapped match segment for obstruction', () => {
  const layout = expandedLayout([], 44, 44, 0, 5)
  expect(
    terminalFindReveal({
      ...findGeometry,
      layout,
      range: { start: { x: 2, y: 0 }, end: { x: 14, y: 1 } }
    })
  ).toEqual({ offset: 3, leadingRows: 3 })
})

it('accounts for the existing metadata header without moving that header below the find bar', () => {
  const layout = expandedLayout([block], 44, 12, 0, 12, 44)
  const revealed = terminalFindReveal({
    ...findGeometry,
    headerRows: 2,
    layout,
    range: { start: { x: 12, y: 0 }, end: { x: 14, y: 0 } }
  })
  expect(revealed.leadingRows).toBe(1)
  const next = expandedLayout([block], 44, 12, revealed.offset, 12, 44, revealed.leadingRows)
  expect(terminalVisualAt(next, { x: 12, y: 0 })).toBe(3)
  expect(terminalBlockHeaders({ layout: next, height: 19, inset: 0 }).map(({ top }) => top)).toEqual([19])
})

it.each([
  { top: 10, inset: 8, headers: [{ id: 'block', top: 8 }] },
  {
    top: 21,
    inset: 8,
    headers: [
      { id: 'block', top: -10 },
      { id: 'next', top: 10 }
    ]
  },
  { top: 22, inset: 8, headers: [{ id: 'next', top: 8 }] },
  { top: 10, inset: 48, headers: [{ id: 'block', top: 48 }] },
  { top: 18, inset: 48, headers: [{ id: 'next', top: 48 }] }
])(
  'keeps the current block below the inset and lets the next header push it away: $top/$inset',
  ({ top, inset, headers }) => {
    const next = { ...block, id: 'next', prompt: { x: 0, y: 20 }, end: { x: 0, y: 80 } }
    const layout = expandedLayout([{ ...block, end: next.prompt }, next], 100, 10, 94 - top)
    expect(
      terminalBlockHeaders({ layout, height: 10, inset }).map(({ run, top }) => ({ id: run.block.id, top }))
    ).toEqual(headers)
  }
)

it('does not pin the preceding header across a command whose metadata has been removed for find', () => {
  const later = { ...block, id: 'later', prompt: { x: 0, y: 20 }, end: { x: 0, y: 30 } }
  const layout = expandedLayout([block, later], 40, 10, 16)
  const headers = terminalBlockHeaders({ layout, height: 19, inset: 38 }).map(({ run }) => run.block.id)
  expect(headers).not.toContain(block.id)
  expect(headers).toContain(later.id)
})

it('does not pin a command before its header reaches the viewport', () => {
  const layout = expandedLayout([{ ...block, prompt: { x: 0, y: 20 } }], 100, 10, 100)
  expect(terminalBlockHeaders({ layout, height: 10, inset: 8 })).toEqual([])
})

it('accounts for native scrolling in an observing view without moving source rows', () => {
  const layout = expandedLayout(
    [block, { ...block, id: 'next', prompt: { x: 0, y: 20 }, end: { x: 0, y: 80 } }],
    100,
    10,
    84
  )
  expect(
    terminalBlockHeaders({ layout, height: 10, inset: 8, scrollTop: 120 }).map(({ run, top }) => ({
      id: run.block.id,
      top
    }))
  ).toEqual([{ id: 'next', top: 8 }])
  expect(terminalSourceAt(layout, 0)).toBe(8)
})

it('reveals a search match below the overlays even when the inset crosses a block boundary', () => {
  const blocks = [block, { ...block, id: 'next', prompt: { x: 0, y: 20 } }]
  const layout = expandedLayout(blocks, 100, 10, 0)
  const offset = terminalOffsetForSource(layout, 21, 5)
  const revealed = expandedLayout(blocks, 100, 10, offset)
  expect(terminalSourceAt(revealed, 5)).toBe(21)
})

it('preserves every output row and maps the cursor and pointer around block controls', () => {
  const layout = expandedLayout([block], 16, 20, 0)
  expect(terminalVisualAt(layout, { x: 2, y: 15 })).toBe(17)
  expect(terminalSourceAt(layout, 17)).toBe(15)
  expect(
    terminalVisibleSpans(layout).flatMap((span) =>
      Array.from({ length: span.count }, (_, index) => span.sourceStart + index)
    )
  ).toEqual(Array.from({ length: 16 }, (_, row) => row))
  expect(terminalSourceAt(layout, 0)).toBeNull()
})
it('preserves a history source anchor when block controls appear above the viewport', () => {
  const before = expandedLayout([], 40, 8, 20)
  const source = terminalSourceAt(before, 0)!
  const decorated = expandedLayout([block], 40, 8, 0)
  const offset = terminalOffsetForSource(decorated, source)
  const after = expandedLayout([block], 40, 8, offset)
  expect(terminalSourceAt(after, 0)).toBe(source)
})

it('keeps the first block controls visible when the live grid has unused rows below the prompt', () => {
  const layout = expandedLayout([{ ...block, end: { x: 0, y: 3 } }], 44, 44, 0, 5)
  expect(layout.runs.find((run) => run.kind === 'controls')!.start - layout.top).toBe(0)
  expect(terminalVisualAt(layout, { x: 2, y: 4 })).toBe(6)
  expect(terminalSourceAt(layout, 6)).toBe(4)
})

it.each([44, 8])('keeps clear history above a %i-row live viewport without pinning its old command header', (rows) => {
  const cleared = {
    ...block,
    command: 'clear',
    prompt: { x: 0, y: 2 },
    output: { x: 0, y: 3 },
    end: { x: 0, y: 3 }
  }
  const live = expandedLayout([cleared], 47, rows, 0, 4, 44)
  expect(terminalSourceAt(live, 0)).toBe(3)
  expect(terminalBlockHeaders({ layout: live, height: 19, inset: 0 })).toEqual([])
  const history = expandedLayout([cleared], 47, rows, live.top, 4, 44)
  expect(terminalSourceAt(history, 0)).toBe(0)
  expect(terminalBlockHeaders({ layout: history, height: 19, inset: 0 }).map(({ run }) => run.block.command)).toEqual([
    'clear'
  ])
})
