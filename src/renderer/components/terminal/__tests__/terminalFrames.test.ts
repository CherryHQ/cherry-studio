import { expect, it } from 'vitest'

import type { GhosttyRow, TerminalResourceState, TerminalViewFrame } from '@shared/types/terminal'
import { encodeTerminalRows } from '@shared/utils/terminalFrame'

import { applyTerminalFrame } from '../terminalFrames'

const resource = { id: 'resource', host: { generation: 'generation' } } as TerminalResourceState
const expected = { viewId: 'view', generation: 'generation', resourceId: 'resource', revision: null }
function frame(text: string, rowIndex = 0): TerminalViewFrame {
  const row: GhosttyRow = { text, cells: [], isWrapContinuation: false, wrapsToNext: false }
  const encoded = encodeTerminalRows([row])
  return {
    controlling: false,
    scrollOffset: 0,
    viewId: 'view',
    resource,
    geometryEpoch: 0,
    revision: 1,
    baseRevision: null,
    rowStart: 0,
    rowIndices: [rowIndex],
    complete: false,
    styles: encoded.styles,
    snapshot: {
      cols: 20,
      rows: 2,
      foreground: { r: 255, g: 255, b: 255 },
      background: { r: 0, g: 0, b: 0 },
      cursor: { r: 255, g: 255, b: 255 },
      cursorX: 0,
      cursorY: 0,
      cursorVisible: false,
      cursorBlinking: false,
      cursorStyle: 0,
      dirtyRows: [rowIndex],
      rowData: encoded.rowData
    }
  }
}
it('assembles a baseline before applying a patch to one row without losing its sibling', () => {
  const first = applyTerminalFrame(null, frame('中文'), expected)
  const second = { ...frame('second', 1), rowStart: 1, complete: true }
  const baseline = applyTerminalFrame(first, second, expected)
  const patch = { ...frame('updated', 1), revision: 2, baseRevision: 1, complete: true }
  const next = applyTerminalFrame(baseline, patch, { ...expected, revision: 1 })
  expect(next.rowData.map((row) => row.text)).toEqual(['中文', 'updated'])
  expect(baseline.rowData[1]?.text).toBe('second')
})
it('rejects missing baselines, revision gaps and frames from another view or Host generation', () => {
  expect(() => applyTerminalFrame(null, { ...frame('missing', 1), complete: true }, expected)).toThrow('Incomplete')
  expect(() => applyTerminalFrame(null, { ...frame('gap'), baseRevision: 3 }, expected)).toThrow('gap')
  expect(() => applyTerminalFrame(null, { ...frame('stale'), viewId: 'other' }, expected)).toThrow('Stale')
  expect(() =>
    applyTerminalFrame(
      null,
      {
        ...frame('stale'),
        resource: { ...resource, host: { ...resource.host, generation: 'old' as typeof resource.host.generation } }
      },
      expected
    )
  ).toThrow('Stale')
})
