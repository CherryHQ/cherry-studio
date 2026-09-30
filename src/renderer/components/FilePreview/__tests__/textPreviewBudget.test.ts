import { describe, expect, it } from 'vitest'

import { shouldRenderRichTextPreview } from '../textPreviewBudget'

const ONE_MIB = 1024 * 1024

describe('shouldRenderRichTextPreview', () => {
  it('keeps a document that fits both budgets on the rich renderer', () => {
    expect(shouldRenderRichTextPreview(ONE_MIB, '# Title\n\nA short paragraph.\n')).toBe(true)
  })

  it('refuses a document over the byte budget regardless of its shape', () => {
    expect(shouldRenderRichTextPreview(ONE_MIB + 1, '# Title\n')).toBe(false)
  })

  it('refuses a long single line even when it is newline-terminated', () => {
    // A trailing newline must not double the line count and halve the measured average.
    expect(shouldRenderRichTextPreview(ONE_MIB, `${'a'.repeat(6_000)}\n`)).toBe(false)
    expect(shouldRenderRichTextPreview(ONE_MIB, 'a'.repeat(6_000))).toBe(false)
  })

  it('keeps a single line that is still inside the line-length budget', () => {
    expect(shouldRenderRichTextPreview(ONE_MIB, `${'a'.repeat(4_000)}\n`)).toBe(true)
  })

  it('keeps a line exactly at the line-length budget, newline or not', () => {
    // The budget is a strict bound on line length: the terminator is not part of the line.
    expect(shouldRenderRichTextPreview(ONE_MIB, `${'a'.repeat(5_000)}\n`)).toBe(true)
    expect(shouldRenderRichTextPreview(ONE_MIB, 'a'.repeat(5_000))).toBe(true)
    expect(shouldRenderRichTextPreview(ONE_MIB, `${'a'.repeat(5_000)}\n${'b'.repeat(5_000)}\n`)).toBe(true)
    expect(shouldRenderRichTextPreview(ONE_MIB, `${'a'.repeat(5_001)}\n`)).toBe(false)
    expect(shouldRenderRichTextPreview(ONE_MIB, `${'a'.repeat(5_000)}\n${'b'.repeat(5_002)}\n`)).toBe(false)
  })

  it('refuses a document whose average line length exceeds the budget', () => {
    expect(shouldRenderRichTextPreview(ONE_MIB, `${'a'.repeat(6_000)}\n${'b'.repeat(6_000)}\n`)).toBe(false)
  })

  it('treats a CRLF terminator as one terminator rather than content', () => {
    expect(shouldRenderRichTextPreview(ONE_MIB, `${'a'.repeat(5_000)}\r\n`)).toBe(true)
    expect(shouldRenderRichTextPreview(ONE_MIB, `${'a'.repeat(5_001)}\r\n`)).toBe(false)
    expect(shouldRenderRichTextPreview(ONE_MIB, `${'a'.repeat(5_000)}\r\n${'b'.repeat(5_000)}\r\n`)).toBe(true)
    expect(shouldRenderRichTextPreview(ONE_MIB, `${'a'.repeat(5_000)}\r\n${'b'.repeat(5_002)}\r\n`)).toBe(false)
  })
})
