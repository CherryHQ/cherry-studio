import { SELECTION_EXCERPT_MAX_LENGTH, SelectionReferenceSchema } from '@renderer/types/selectionReference'
import type { AbsoluteFilePath } from '@shared/types/file'
import { describe, expect, it } from 'vitest'

import { createSelectionReference, normalizeSelectionText } from '../selectionReference'

const filePath = '/workspace/report.docx' as AbsoluteFilePath
const anchor = { format: 'docx', paragraph: 0 } as const
const metadata = { size: 1024, modifiedAt: 1_700_000_000_000 }

const build = (excerpt: string) => createSelectionReference({ filePath, anchor, excerpt, metadata })

describe('normalizeSelectionText', () => {
  it('NFC-normalizes, collapses whitespace runs and trims', () => {
    expect(normalizeSelectionText('  a\t\t b \n c  ')).toBe('a b c')
    // e + combining acute must fold to the precomposed form, or the two sides of the
    // office-transform comparison disagree on visually identical text.
    expect(normalizeSelectionText('é')).toBe('é')
  })

  it.each([
    ['U+FEFF zero-width no-break space', '﻿'],
    ['U+0085 next line', ''],
    ['U+001C file separator', ''],
    ['U+001F unit separator', ''],
    ['U+00A0 no-break space', ' '],
    ['U+3000 ideographic space', '　'],
    ['U+2028 line separator', ' ']
  ])('treats %s as whitespace, matching the skill-side class', (_label, character) => {
    // The class is spelled out on both sides precisely because JS and Python disagree on `\s`:
    // JS counts U+FEFF, Python counts U+0085 and U+001C-U+001F, and neither is a superset.
    expect(normalizeSelectionText(`A${character}B`)).toBe('A B')
  })

  it.each([
    ['U+200B zero-width space', '​'],
    ['U+2060 word joiner', '⁠']
  ])('leaves %s alone, since neither runtime counts it as whitespace', (_label, character) => {
    expect(normalizeSelectionText(`A${character}B`)).toBe(`A${character}B`)
  })
})

describe('createSelectionReference', () => {
  it('stamps the reference with the metadata the preview loaded with', () => {
    expect(build('Q1 revenue')).toEqual({
      path: filePath,
      anchor,
      excerpt: 'Q1 revenue',
      fileStamp: { size: 1024, mtimeMs: 1_700_000_000_000 }
    })
  })

  it('truncates to the limit in UTF-16 units, never splitting a surrogate pair', () => {
    // The boundary lands mid-emoji: a bare `.slice()` keeps half of it, and the lone surrogate
    // survives zod and JSON only to reach the Python consumer as U+FFFD.
    const reference = build('a'.repeat(SELECTION_EXCERPT_MAX_LENGTH - 1) + '\u{1F600}tail')

    expect(reference?.excerpt).toBe('a'.repeat(SELECTION_EXCERPT_MAX_LENGTH - 1))
    expect(reference?.excerpt.isWellFormed()).toBe(true)
  })

  it('keeps a surrogate pair that ends exactly on the limit', () => {
    // Giving back a unit is only correct when the boundary splits a pair — a pair that fits must
    // survive whole, or every astral excerpt loses its last character for nothing.
    const reference = build('a'.repeat(SELECTION_EXCERPT_MAX_LENGTH - 2) + '\u{1F600}tail')

    expect(reference?.excerpt).toHaveLength(SELECTION_EXCERPT_MAX_LENGTH)
    expect(reference?.excerpt.endsWith('\u{1F600}')).toBe(true)
  })

  it('produces an excerpt the schema accepts even when every character is astral', () => {
    // Counting this limit in code points emits 2000 of them, which is 4000 UTF-16 units, and the
    // schema's `.max()` counts UTF-16 units like every other budget here. This is what ties the
    // producer's idea of the limit to the schema's, so the two cannot drift apart again.
    const reference = build('\u{1F600}'.repeat(SELECTION_EXCERPT_MAX_LENGTH))

    expect(SelectionReferenceSchema.safeParse(reference).success).toBe(true)
  })

  it('keeps an excerpt that ends exactly on the limit', () => {
    const reference = build('b'.repeat(SELECTION_EXCERPT_MAX_LENGTH))
    expect(reference?.excerpt).toHaveLength(SELECTION_EXCERPT_MAX_LENGTH)
  })

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['newlines and tabs', '\n\t\n'],
    ['a zero-width no-break space', '﻿']
  ])('reports no reference for a %s selection', (_label, excerpt) => {
    // Such a selection normalizes away entirely; reporting it would put a quote chip on screen
    // that quotes no text. Every producer routes through here, so this covers all four.
    expect(build(excerpt)).toBeNull()
  })
})
