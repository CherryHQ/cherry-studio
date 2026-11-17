import { describe, expect, it } from 'vitest'

import { SELECTION_EXCERPT_MAX_LENGTH } from '../documentAnchor'
import { createPreviewSelection, normalizeSelectionText } from '../selection'

const build = (excerpt: string) =>
  createPreviewSelection({ sourceId: 'report.docx', revision: '1', anchor: { format: 'docx', paragraph: 0 }, excerpt })

describe('normalizeSelectionText', () => {
  it('NFC-normalizes, collapses whitespace runs and trims', () => {
    expect(normalizeSelectionText('  a\t\t b \n c  ')).toBe('a b c')
    // e + combining acute must fold to the precomposed form, or the two sides of the
    // office-transform comparison disagree on visually identical text.
    expect(normalizeSelectionText('é')).toBe('é')
  })

  it.each([
    ['U+FEFF zero-width no-break space', '\ufeff'],
    ['U+0085 next line', '\u0085'],
    ['U+001C file separator', '\u001c'],
    ['U+001F unit separator', '\u001f'],
    ['U+00A0 no-break space', '\u00a0'],
    ['U+3000 ideographic space', '\u3000'],
    ['U+2028 line separator', '\u2028']
  ])('treats %s as whitespace, matching the skill-side class', (_label, character) => {
    // The class is spelled out on both sides precisely because JS and Python disagree on `\s`:
    // JS counts U+FEFF, Python counts U+0085 and U+001C-U+001F, and neither is a superset.
    expect(normalizeSelectionText(`A${character}B`)).toBe('A B')
  })

  it.each([
    ['U+200B zero-width space', '\u200b'],
    ['U+2060 word joiner', '\u2060']
  ])('leaves %s alone, since neither runtime counts it as whitespace', (_label, character) => {
    expect(normalizeSelectionText(`A${character}B`)).toBe(`A${character}B`)
  })
})

describe('createPreviewSelection', () => {
  it('truncates to the limit in UTF-16 units, never splitting a surrogate pair', () => {
    // The boundary lands mid-emoji: a bare `.slice()` keeps half of it, and the lone surrogate
    // survives zod and JSON only to reach the Python consumer as U+FFFD.
    const selection = build('a'.repeat(SELECTION_EXCERPT_MAX_LENGTH - 1) + '\u{1F600}tail')

    expect(selection?.excerpt).toBe('a'.repeat(SELECTION_EXCERPT_MAX_LENGTH - 1))
    expect(selection?.excerpt.isWellFormed()).toBe(true)
  })

  it('keeps a surrogate pair that ends exactly on the limit', () => {
    // Giving back a unit is only correct when the boundary splits a pair — a pair that fits must
    // survive whole, or every astral excerpt loses its last character for nothing.
    const selection = build('a'.repeat(SELECTION_EXCERPT_MAX_LENGTH - 2) + '\u{1F600}tail')

    expect(selection?.excerpt).toHaveLength(SELECTION_EXCERPT_MAX_LENGTH)
    expect(selection?.excerpt.endsWith('\u{1F600}')).toBe(true)
  })

  it('stays within the limit in UTF-16 units even when every character is astral', () => {
    // Counting the limit in code points would emit twice the units the host schema's `.max()` accepts.
    const selection = build('\u{1F600}'.repeat(SELECTION_EXCERPT_MAX_LENGTH))

    expect(selection?.excerpt.length).toBeLessThanOrEqual(SELECTION_EXCERPT_MAX_LENGTH)
    expect(selection?.excerpt.isWellFormed()).toBe(true)
  })

  it('keeps an excerpt that ends exactly on the limit', () => {
    const selection = build('b'.repeat(SELECTION_EXCERPT_MAX_LENGTH))
    expect(selection?.excerpt).toHaveLength(SELECTION_EXCERPT_MAX_LENGTH)
  })

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['newlines and tabs', '\n\t\n'],
    ['a zero-width no-break space', '\ufeff']
  ])('reports no selection for a %s selection', (_label, excerpt) => {
    // Such a selection normalizes away entirely; reporting it would put a quote chip on screen
    // that quotes no text. Every format plugin routes through here, so this covers all of them.
    expect(build(excerpt)).toBeNull()
  })
})
