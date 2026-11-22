import { expect, it } from 'vitest'

import type { TerminalBlockSummary } from '@shared/types/terminal'

import {
  terminalBlockLayout,
  terminalSourceAt,
  terminalVisualAt,
  terminalVisibleSpans,
  terminalOffsetForSource
} from '../terminalBlockLayout'
const block: TerminalBlockSummary = {
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
it('folds only completed output and maps the live cursor and pointer to the same surviving source row', () => {
  const layout = terminalBlockLayout([block], ['block'], 16, 8, 0)
  expect(terminalVisualAt(layout, { x: 2, y: 15 })).toBe(7)
  expect(terminalSourceAt(layout, 7)).toBe(15)
  expect(
    terminalVisibleSpans(layout).flatMap((span) =>
      Array.from({ length: span.count }, (_, index) => span.sourceStart + index)
    )
  ).not.toContain(4)
  expect(terminalSourceAt(layout, 3)).toBeNull()
})
it('preserves a history source anchor when folding above the viewport', () => {
  const before = terminalBlockLayout([block], [], 40, 8, 20)
  const source = terminalSourceAt(before, 0)!
  const folded = terminalBlockLayout([block], ['block'], 40, 8, 0)
  const offset = terminalOffsetForSource(folded, source)
  const after = terminalBlockLayout([block], ['block'], 40, 8, offset)
  expect(terminalSourceAt(after, 0)).toBe(source)
})
it('keeps uncertain or running output expanded even if a previous collapse intent exists', () => {
  for (const changed of [
    { ...block, outputEmpty: true },
    { ...block, reliable: false },
    { ...block, status: 'running' as const }
  ]) {
    const layout = terminalBlockLayout([changed], ['block'], 16, 20, 0)
    expect(terminalVisualAt(layout, { x: 0, y: 5 })).not.toBeNull()
  }
})

it('keeps the first block controls visible when the live grid has unused rows below the prompt', () => {
  const layout = terminalBlockLayout([{ ...block, end: { x: 0, y: 3 } }], [], 44, 44, 0, 5)
  expect(layout.runs.find((run) => run.kind === 'controls')!.start - layout.top).toBe(0)
  expect(terminalVisualAt(layout, { x: 2, y: 4 })).toBe(6)
  expect(terminalSourceAt(layout, 6)).toBe(4)
})
