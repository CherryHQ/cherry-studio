import { describe, expect, it } from 'vitest'

import { findLegacyVarHitsInContent, isCommentLine } from '../check-legacy-css-vars'

describe('check-legacy-css-vars', () => {
  it('identifies comment lines', () => {
    expect(isCommentLine('// var(--color-text-1)')).toBe(true)
    expect(isCommentLine('/* var(--color-text-1) */')).toBe(true)
    expect(isCommentLine('  * var(--color-text-1)')).toBe(true)
    expect(isCommentLine('color: var(--color-text-1);')).toBe(false)
  })

  it('ignores variable definitions and comment-only mentions', () => {
    const content = `
      :root {
        --color-text-1: var(--color-foreground);
      }
      // var(--color-text-1)
      /* var(--color-text-2) */
    `

    expect(findLegacyVarHitsInContent(content, 'src/renderer/src/example.css')).toEqual([])
  })

  it('reports real legacy variable usages', () => {
    const content = `
      .title {
        color: var(--color-text-1);
      }

      const node = '<div class="text-[var(--color-text-2)]" />';
    `

    const findings = findLegacyVarHitsInContent(content, 'src/renderer/src/example.tsx')

    expect(findings).toHaveLength(2)
    expect(findings.map((finding) => finding.variable)).toEqual(['--color-text-1', '--color-text-2'])
    expect(findings.map((finding) => finding.line)).toEqual([3, 6])
  })
})
