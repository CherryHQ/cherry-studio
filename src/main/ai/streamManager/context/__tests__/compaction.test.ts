import { describe, expect, it } from 'vitest'

import {
  applyDeepestMarker,
  type CompactionRow,
  estimateRowTokens,
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

describe('estimateRowTokens', () => {
  // #17837 in this lane: a media part used to be JSON.stringify'd into the
  // tokenizer, so its base64 payload scored as prose — a 13 MB MP3 came out at
  // 3.7 M tokens against the provider's real 20 k, tripping the turn-start
  // trigger on a conversation with nothing to fold.
  it.each([
    ['audio/mpeg', 'audio'],
    ['image/png', 'image'],
    ['video/mp4', 'video']
  ])('prices a %s part by its dialect table, not by its payload', (mediaType) => {
    const payload = 'A'.repeat(400_000)
    const row: CompactionRow = {
      id: 'm1',
      role: 'user',
      parts: [{ type: 'file', mediaType, url: `data:${mediaType};base64,${payload}` }]
    }

    const tokens = estimateRowTokens(row, 'openai')

    expect(tokens).toBeGreaterThan(0)
    expect(tokens).toBeLessThan(10_000)
  })

  it('still counts text parts', () => {
    const row: CompactionRow = { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello '.repeat(100) }] }

    expect(estimateRowTokens(row, 'openai')).toBeGreaterThan(50)
  })

  // A tool part carries no mediaType, so it keeps the stringify path — the
  // payload really is what the model reads.
  it('falls back to stringifying a part that declares no media type', () => {
    const row: CompactionRow = { id: 'm1', role: 'assistant', parts: [{ type: 'tool-x', output: 'y'.repeat(4_000) }] }

    expect(estimateRowTokens(row, 'openai')).toBeGreaterThan(100)
  })
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

  it('appends the attachment manifest when handles are provided (and only then)', () => {
    const withManifest = (summaryRow('id', 'S', ['a.txt', 'b.pdf']).parts[0] as { text: string }).text
    expect(withManifest).toContain('readable in full via the read_file tool: a.txt, b.pdf')

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
    expect((out[0].parts[0] as { text: string }).text).toContain('read_file tool: doc.md')
  })
})

describe('planKeepBoundary', () => {
  const rows = [u('a', '12345'), a('b', '12345'), u('c', '12345'), a('d', '12345')]
  it('everything fits → null (keep all)', () => {
    expect(planKeepBoundary(rows, 1_000_000, 'openai')).toBeNull()
  })
  it('snaps the keep-start to a user row', () => {
    // each '12345' row ≈ 1 token (tokenx). suffix [c,d] = 2 ≤ 3 (fits);
    // suffix [a,b,c,d] = 4 > 3 (doesn't) → earliest fitting user row is 'c' at index 2.
    expect(planKeepBoundary(rows, 3, 'openai')).toBe(2)
  })
  it('budget 0 → floor keeps the last user row', () => {
    expect(planKeepBoundary(rows, 0, 'openai')).toBe(2)
  })
  it('single user row, big budget → null (keepStart 0)', () => {
    expect(planKeepBoundary([u('a', 'x')], 1_000_000, 'openai')).toBeNull()
  })
  it('empty rows → -1 / unchanged / null', () => {
    expect(findDeepestMarker([])).toBe(-1)
    expect(applyDeepestMarker([])).toEqual([])
    expect(planKeepBoundary([], 100, 'openai')).toBeNull()
  })
})
