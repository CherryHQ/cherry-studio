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
  it('wraps the summary text and uses the synthetic id', () => {
    const row = summaryRow('myId', 'SummaryText')
    expect(row.id).toBe(summaryMessageId('myId'))
    expect(row.role).toBe('user')
    expect((row.parts[0] as { text: string }).text).toContain('SummaryText')
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
})

describe('planKeepBoundary', () => {
  const rows = [u('a', '12345'), a('b', '12345'), u('c', '12345'), a('d', '12345')]
  it('everything fits → null (keep all)', () => {
    expect(planKeepBoundary(rows, 1_000_000)).toBeNull()
  })
  it('snaps the keep-start to a user row', () => {
    // each '12345' row ≈ 1 token (tokenx). suffix [c,d] = 2 ≤ 3 (fits);
    // suffix [a,b,c,d] = 4 > 3 (doesn't) → earliest fitting user row is 'c' at index 2.
    expect(planKeepBoundary(rows, 3)).toBe(2)
  })
  it('budget 0 → floor keeps the last user row', () => {
    expect(planKeepBoundary(rows, 0)).toBe(2)
  })
  it('single user row, big budget → null (keepStart 0)', () => {
    expect(planKeepBoundary([u('a', 'x')], 1_000_000)).toBeNull()
  })
  it('empty rows → -1 / unchanged / null', () => {
    expect(findDeepestMarker([])).toBe(-1)
    expect(applyDeepestMarker([])).toEqual([])
    expect(planKeepBoundary([], 100)).toBeNull()
  })
})
