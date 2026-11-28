import { describe, expect, it } from 'vitest'

import {
  applyDeepestMarker,
  type CompactionRow,
  findDeepestMarker,
  planKeepBoundary,
  summaryMessageId,
  summaryRow
} from '../compaction'

const u = (id: string, text: string, compactionSummary?: string): CompactionRow => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
  compactionSummary
})
const a = (id: string, text: string, compactionSummary?: string): CompactionRow => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text }],
  compactionSummary
})

describe('findDeepestMarker', () => {
  it('returns -1 when no row carries a summary', () => {
    expect(findDeepestMarker([u('a', 'q'), a('b', 'r')])).toBe(-1)
  })
  it('returns the deepest (highest index) marked row', () => {
    expect(findDeepestMarker([a('a', 'r', 'S1'), u('b', 'q'), a('c', 'r', 'S2'), u('d', 'q')])).toBe(2)
  })
})

describe('summaryRow', () => {
  it('preserves the summary text in the user context', () => {
    const row = summaryRow('myId', 'SummaryText')
    expect(row.role).toBe('user')
    expect((row.parts[0] as { text: string }).text).toContain('SummaryText')
  })

  it('appends the attachment manifest when handles are provided (and only then)', () => {
    const withManifest = (summaryRow('id', 'S', ['a.txt', 'b.pdf']).parts[0] as { text: string }).text
    expect(withManifest).toContain('a.txt')
    expect(withManifest).toContain('b.pdf')

    const without = (summaryRow('id', 'S', []).parts[0] as { text: string }).text
    expect(without).not.toContain('read_file')
    // Deterministic bytes: same handles → same text (prefix-cache contract).
    expect((summaryRow('id', 'S', ['a.txt', 'b.pdf']).parts[0] as { text: string }).text).toBe(withManifest)
  })
})

describe('applyDeepestMarker', () => {
  it('no marker → unchanged', () => {
    const rows = [u('a', 'q1'), a('b', 'a1')]
    expect(applyDeepestMarker(rows)).toEqual(rows)
  })
  it('marker present → [summary(boundary)] + rows after the deepest marker', () => {
    const rows = [a('a', 'r', 'S1'), u('b', 'q2'), a('c', 'r2', 'S2'), u('d', 'q3')]
    const out = applyDeepestMarker(rows)
    expect(out.map((r) => r.id)).toEqual([summaryMessageId('c'), 'd'])
    expect((out[0].parts[0] as { text: string }).text).toContain('S2')
  })
  it('threads attachment handles into the served summary row', () => {
    const rows = [a('a', 'r', 'S1'), u('b', 'q2')]
    const out = applyDeepestMarker(rows, ['doc.md'])
    expect((out[0].parts[0] as { text: string }).text).toContain('doc.md')
  })
})

describe('planKeepBoundary', () => {
  const rows = [u('a', '12345'), a('b', '12345'), u('c', '12345'), a('d', '12345')]
  const estimateAt = async () => 1
  it('everything fits → null (keep all)', async () => {
    expect(await planKeepBoundary(rows, 4, estimateAt)).toBeNull()
  })
  it('snaps the keep-start to a user row', async () => {
    expect(await planKeepBoundary(rows, 3, estimateAt)).toBe(2)
  })
  it('budget 0 → floor keeps the last user row', async () => {
    expect(await planKeepBoundary(rows, 0, estimateAt)).toBe(2)
  })
  it('single user row, big budget → null (keepStart 0)', async () => {
    expect(await planKeepBoundary([u('a', 'x')], 2, estimateAt)).toBeNull()
  })
  it('empty rows → -1 / unchanged / null', async () => {
    expect(findDeepestMarker([])).toBe(-1)
    expect(applyDeepestMarker([])).toEqual([])
    expect(await planKeepBoundary([], 100, estimateAt)).toBeNull()
  })
})
