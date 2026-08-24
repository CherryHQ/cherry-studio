import { createSelectionReferenceToken } from '@renderer/components/composer/selectionReferenceToken'
import { type SelectionReference, SelectionReferenceSchema } from '@renderer/types/selectionReference'
import type { AbsoluteFilePath } from '@shared/types/file'
import { describe, expect, it } from 'vitest'

const XLSX_REFERENCE: SelectionReference = {
  path: '/Users/dev/workspace/report.xlsx' as AbsoluteFilePath,
  anchor: { format: 'xlsx', sheet: 'Sheet1', range: 'B2:D8' },
  excerpt: 'Q3 revenue 12,400 — up 8% "YoY" over\\ttarget',
  fileStamp: { size: 20481, mtimeMs: 1750000000000 }
}

/**
 * Stands in for i18next: echoes the key with its interpolations so a label assertion shows which key
 * was used, and would fail loudly if a branch went back to a hardcoded English string.
 */
const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${Object.values(options).join(',')})` : key

/** Mirrors the office-transform skill's side: find the fence, JSON.parse its body. */
function parseSelectionRefFence(promptText: string | undefined): unknown {
  const match = /^```selection-ref\n([\s\S]*)\n```$/.exec(promptText ?? '')
  if (!match) throw new Error(`promptText is not a selection-ref fenced block: ${promptText}`)
  return JSON.parse(match[1])
}

describe('createSelectionReferenceToken', () => {
  it('round-trips the reference through the fenced promptText the skill parses', () => {
    const token = createSelectionReferenceToken(XLSX_REFERENCE, t)

    expect(parseSelectionRefFence(token.promptText)).toEqual(XLSX_REFERENCE)
    expect(SelectionReferenceSchema.parse(parseSelectionRefFence(token.promptText))).toEqual(XLSX_REFERENCE)
  })

  it('keeps the fence body on a single line so the block stays greppable', () => {
    const body = createSelectionReferenceToken(XLSX_REFERENCE, t).promptText?.split('\n') ?? []

    expect(body).toHaveLength(3)
  })

  it('carries the excerpt as the chip description and reuses the reference token kind', () => {
    const token = createSelectionReferenceToken(XLSX_REFERENCE, t)

    expect(token.kind).toBe('reference')
    expect(token.description).toBe(XLSX_REFERENCE.excerpt)
  })

  it.each([
    [XLSX_REFERENCE, 'report.xlsx · Sheet1!B2:D8'],
    [
      {
        path: '/Users/dev/workspace/spec.docx' as AbsoluteFilePath,
        anchor: { format: 'docx', paragraph: 3 },
        excerpt: 'The service must reject unsigned requests.',
        fileStamp: { size: 1024, mtimeMs: 1 }
      } satisfies SelectionReference,
      'spec.docx · ¶4'
    ],
    [
      {
        path: '/Users/dev/workspace/paper.pdf' as AbsoluteFilePath,
        anchor: { format: 'pdf', page: 3 },
        excerpt: 'Results were reproduced across three runs.',
        fileStamp: { size: 1024, mtimeMs: 1 }
      } satisfies SelectionReference,
      'paper.pdf · chat.input.selection_reference.page(3)'
    ],
    [
      {
        path: '/Users/dev/workspace/deck.pptx' as AbsoluteFilePath,
        anchor: { format: 'pptx', slide: 2 },
        excerpt: 'Roadmap',
        fileStamp: { size: 1024, mtimeMs: 1 }
      } satisfies SelectionReference,
      'deck.pptx · chat.input.selection_reference.slide(2)'
    ]
  ])('labels %#: file name plus the format-native locator', (reference, expected) => {
    expect(createSelectionReferenceToken(reference, t).label).toBe(expected)
  })
})
