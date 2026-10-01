import { describe, expect, it } from 'vitest'

import { hasPathologicalLongLines } from '../textPreviewGuard'

describe('hasPathologicalLongLines', () => {
  it('keeps a document made of ordinary lines', () => {
    expect(hasPathologicalLongLines('# Title\n\nA short paragraph.\n')).toBe(false)
  })

  it('refuses a long single line even when it is newline-terminated', () => {
    // A trailing newline must not double the line count and halve the measured average.
    expect(hasPathologicalLongLines(`${'a'.repeat(6_000)}\n`)).toBe(true)
    expect(hasPathologicalLongLines('a'.repeat(6_000))).toBe(true)
  })

  it('keeps a line exactly at the line-length budget, newline or not', () => {
    // The budget is a strict bound on line length: the terminator is not part of the line.
    expect(hasPathologicalLongLines(`${'a'.repeat(5_000)}\n`)).toBe(false)
    expect(hasPathologicalLongLines('a'.repeat(5_000))).toBe(false)
    expect(hasPathologicalLongLines(`${'a'.repeat(5_000)}\n${'b'.repeat(5_000)}\n`)).toBe(false)
    expect(hasPathologicalLongLines(`${'a'.repeat(5_001)}\n`)).toBe(true)
    expect(hasPathologicalLongLines(`${'a'.repeat(5_000)}\n${'b'.repeat(5_002)}\n`)).toBe(true)
  })

  it('refuses a document whose average line length exceeds the budget', () => {
    expect(hasPathologicalLongLines(`${'a'.repeat(6_000)}\n${'b'.repeat(6_000)}\n`)).toBe(true)
  })

  it('treats a CRLF terminator as one terminator rather than content', () => {
    expect(hasPathologicalLongLines(`${'a'.repeat(5_000)}\r\n`)).toBe(false)
    expect(hasPathologicalLongLines(`${'a'.repeat(5_001)}\r\n`)).toBe(true)
    expect(hasPathologicalLongLines(`${'a'.repeat(5_000)}\r\n${'b'.repeat(5_000)}\r\n`)).toBe(false)
    expect(hasPathologicalLongLines(`${'a'.repeat(5_000)}\r\n${'b'.repeat(5_002)}\r\n`)).toBe(true)
  })
})
