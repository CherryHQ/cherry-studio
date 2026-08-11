import { describe, expect, it } from 'vitest'

import {
  isSelectionReferenceStale,
  parseSelectionReference,
  SELECTION_EXCERPT_MAX_LENGTH,
  type SelectionReference
} from '../selectionReference'

const validReference = {
  path: '/workspace/report.xlsx',
  anchor: { format: 'xlsx', sheet: 'Sheet1', range: 'A1:C10' },
  excerpt: 'Q1 revenue table',
  fileStamp: { size: 1024, mtimeMs: 1_700_000_000_000 }
}

describe('SelectionReferenceSchema', () => {
  it('accepts each anchor format a producer can emit', () => {
    expect(parseSelectionReference(validReference)).not.toBeNull()
    expect(
      parseSelectionReference({
        ...validReference,
        path: '/workspace/spec.docx',
        anchor: { format: 'docx', paragraph: 0, charRange: [0, 12] }
      })
    ).not.toBeNull()
    expect(
      parseSelectionReference({
        ...validReference,
        path: '/workspace/paper.pdf',
        anchor: { format: 'pdf', page: 3 }
      })
    ).not.toBeNull()
    expect(
      parseSelectionReference({
        ...validReference,
        path: '/workspace/deck.pptx',
        anchor: { format: 'pptx', slide: 2, nodeId: '4', tableCell: { row: 1, col: 0 } }
      })
    ).not.toBeNull()
  })

  it('rejects a zero-based slide number that would address the wrong slide', () => {
    expect(parseSelectionReference({ ...validReference, anchor: { format: 'pptx', slide: 0, nodeId: '4' } })).toBeNull()
  })

  it('rejects malformed A1 ranges before they can mis-address an extraction', () => {
    for (const range of ['a1:c10', '1A', 'A0', 'A1:', 'A1:C10:D2', '']) {
      expect(parseSelectionReference({ ...validReference, anchor: { format: 'xlsx', sheet: 'S', range } })).toBeNull()
    }
  })

  it('rejects an inverted charRange that would slice the wrong text', () => {
    expect(
      parseSelectionReference({
        ...validReference,
        anchor: { format: 'docx', paragraph: 2, charRange: [10, 4] }
      })
    ).toBeNull()
  })

  it('rejects non-absolute paths that skill scripts could not resolve', () => {
    expect(parseSelectionReference({ ...validReference, path: 'report.xlsx' })).toBeNull()
  })

  it('caps the excerpt so a reference cannot bloat the message', () => {
    expect(
      parseSelectionReference({ ...validReference, excerpt: 'x'.repeat(SELECTION_EXCERPT_MAX_LENGTH + 1) })
    ).toBeNull()
  })

  it('returns null instead of throwing on arbitrary junk', () => {
    expect(parseSelectionReference(undefined)).toBeNull()
    expect(parseSelectionReference('{}')).toBeNull()
    expect(parseSelectionReference({ anchor: { format: 'xlsx' } })).toBeNull()
  })
})

describe('isSelectionReferenceStale', () => {
  const reference = parseSelectionReference(validReference) as SelectionReference

  it('flags a changed file so a stale anchor is never silently re-used', () => {
    expect(isSelectionReferenceStale(reference, { size: 1024, mtimeMs: 1_700_000_000_001 })).toBe(true)
    expect(isSelectionReferenceStale(reference, { size: 2048, mtimeMs: 1_700_000_000_000 })).toBe(true)
  })

  it('accepts an unchanged file', () => {
    expect(isSelectionReferenceStale(reference, { size: 1024, mtimeMs: 1_700_000_000_000 })).toBe(false)
  })
})
