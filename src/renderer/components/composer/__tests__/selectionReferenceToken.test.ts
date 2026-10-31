import { describe, expect, it } from 'vitest'

import { createSelectionReferenceToken } from '@renderer/components/composer/selectionReferenceToken'
import {
  type LineCommentReference,
  type SelectionReference,
  SelectionReferenceSchema
} from '@renderer/types/selectionReference'
import type { AbsoluteFilePath } from '@shared/types/file'

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

  it('attaches a document comment beside the anchor and shows it on the chip', () => {
    const commented = { ...XLSX_REFERENCE, comment: 'Recalculate with the March numbers' }
    const token = createSelectionReferenceToken(commented, t)
    const parsed = SelectionReferenceSchema.parse(parseSelectionRefFence(token.promptText))

    expect(parsed.anchor).toEqual(XLSX_REFERENCE.anchor)
    expect(parsed.comment).toBe('Recalculate with the March numbers')
    expect(token.description).toBe('Recalculate with the March numbers')
    expect(token.icon).toBe('comment')
    expect(createSelectionReferenceToken(XLSX_REFERENCE, t).icon).toBe('quote')
  })
})

describe('createSelectionReferenceToken for a text-file line comment', () => {
  const LINE_COMMENT: LineCommentReference = {
    path: '/Users/dev/workspace/src/app.ts' as AbsoluteFilePath,
    startLine: 19,
    endLine: 21,
    excerpt: 'const a = 1\nconst b = 2\nconst c = 3',
    comment: 'Merge these into one object'
  }

  it('labels a range and a single line with the file name and line numbers', () => {
    expect(createSelectionReferenceToken(LINE_COMMENT, t).label).toBe('app.ts · L19–21')
    expect(createSelectionReferenceToken({ ...LINE_COMMENT, endLine: 19 }, t).label).toBe('app.ts · L19')
  })

  it('sends the path, range, verbatim lines and comment as Markdown, never as a selection-ref block', () => {
    const token = createSelectionReferenceToken(LINE_COMMENT, t)

    expect(token.promptText).toBe(
      '`/Users/dev/workspace/src/app.ts:19-21`\n```\nconst a = 1\nconst b = 2\nconst c = 3\n```\nMerge these into one object'
    )
    expect(token.promptText).not.toContain('selection-ref')
    expect(token.description).toBe(LINE_COMMENT.comment)
    expect(token.icon).toBe('comment')
  })

  it('fences quoted lines that contain backtick fences so they cannot close the block early', () => {
    const excerpt = 'Example:\n```ts\nrun()\n```'
    const token = createSelectionReferenceToken({ ...LINE_COMMENT, excerpt }, t)

    expect(token.promptText).toContain(`\n\`\`\`\`\n${excerpt}\n\`\`\`\`\n`)
  })
})
