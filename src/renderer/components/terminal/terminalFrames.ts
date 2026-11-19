import type { GhosttySnapshot, TerminalViewFrame } from '@shared/types/terminal'
import { decodeTerminalRows } from '@shared/utils/terminalFrame'

/** A gap discards only presentation state. It never resubmits terminal input. */
export function applyTerminalFrame(
  previous: GhosttySnapshot | null,
  frame: TerminalViewFrame,
  expected: { viewId: string; generation: string; resourceId: string; revision: number | null }
): GhosttySnapshot {
  if (
    frame.viewId !== expected.viewId ||
    frame.resource.host.generation !== expected.generation ||
    frame.resource.id !== expected.resourceId
  )
    throw new Error('Stale terminal frame')
  if (expected.revision !== null && frame.revision < expected.revision) throw new Error('Stale terminal revision')
  if (new Set(frame.rowIndices).size !== frame.rowIndices.length) throw new Error('Duplicate terminal frame row')
  if (frame.rowStart === 0 && frame.baseRevision !== null && frame.baseRevision !== expected.revision)
    throw new Error('Terminal frame gap')
  const rows =
    frame.rowStart === 0 && frame.baseRevision === null
      ? new Array(frame.snapshot.rows)
      : [...(previous?.rowData ?? [])]
  const decoded = decodeTerminalRows(frame.snapshot.rowData, frame.styles)
  decoded.forEach((row, index) => {
    const target = frame.rowIndices[index]
    if (target === undefined || target < 0 || target >= frame.snapshot.rows)
      throw new Error('Invalid terminal frame row')
    rows[target] = row
  })
  if (frame.complete && (rows.length !== frame.snapshot.rows || Array.from(rows).some((row) => !row)))
    throw new Error('Incomplete terminal baseline')
  return { ...frame.snapshot, rowData: rows, dirtyRows: new Set(frame.snapshot.dirtyRows) }
}
