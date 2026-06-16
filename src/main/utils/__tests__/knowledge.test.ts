import { describe, expect, it } from 'vitest'

import { nextFreeKnowledgeRelativePath } from '../knowledge'

describe('nextFreeKnowledgeRelativePath', () => {
  const free =
    (taken: string[]) =>
    (candidate: string): boolean =>
      !taken.includes(candidate)

  it('returns the bare path when it is free', () => {
    expect(nextFreeKnowledgeRelativePath('report.pdf', free([]))).toBe('report.pdf')
  })

  it('inserts a `_N` suffix before the extension on collision', () => {
    expect(nextFreeKnowledgeRelativePath('report.pdf', free(['report.pdf']))).toBe('report_1.pdf')
  })

  it('advances the suffix past every taken variant', () => {
    expect(nextFreeKnowledgeRelativePath('report.pdf', free(['report.pdf', 'report_1.pdf', 'report_2.pdf']))).toBe(
      'report_3.pdf'
    )
  })

  it('handles a name with no extension', () => {
    expect(nextFreeKnowledgeRelativePath('notes', free(['notes']))).toBe('notes_1')
  })

  it('keeps directory segments and only suffixes the file stem', () => {
    expect(nextFreeKnowledgeRelativePath('sub/dir/report.md', free(['sub/dir/report.md']))).toBe('sub/dir/report_1.md')
  })

  it('lets the predicate veto several related paths per candidate', () => {
    // A candidate is only free when both it and its ".md" sibling are untaken.
    const taken = new Set(['report.md'])
    const result = nextFreeKnowledgeRelativePath('report.pdf', (candidate) => {
      const sibling = candidate.replace(/\.[^.]+$/, '.md')
      return !taken.has(candidate) && !taken.has(sibling)
    })
    expect(result).toBe('report_1.pdf')
  })
})
