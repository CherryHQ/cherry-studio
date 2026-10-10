import { describe, expect, it } from 'vitest'

import { sanitizeFilename, validateFileName } from '../filename'

describe('sanitizeFilename', () => {
  it('replaces forbidden characters with underscore by default', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('uses caller-provided replacement string', () => {
    expect(sanitizeFilename('a/b', '-')).toBe('a-b')
  })

  it('preserves valid characters unchanged', () => {
    expect(sanitizeFilename('hello world.txt')).toBe('hello world.txt')
  })

  it('preserves Unicode letters / digits', () => {
    expect(sanitizeFilename('文档2026.txt')).toBe('文档2026.txt')
  })

  it('replaces all forbidden characters in a string of only-forbidden chars', () => {
    expect(sanitizeFilename('///')).toBe('___')
  })

  it('replaces Windows reserved-name prefixes while preserving the trailing dot+ext', () => {
    expect(sanitizeFilename('CON.txt')).toBe('_.txt')
    expect(sanitizeFilename('PRN')).toBe('_')
    expect(sanitizeFilename('COM1.log')).toBe('_.log')
  })

  it('trims trailing whitespace and dots (Windows convention)', () => {
    expect(sanitizeFilename('hello.')).toBe('hello')
    expect(sanitizeFilename('hello  ')).toBe('hello')
    expect(sanitizeFilename('hello. .')).toBe('hello')
  })

  it('truncates to 255 characters', () => {
    const long = 'a'.repeat(300)
    const result = sanitizeFilename(long)
    expect(result.length).toBe(255)
  })

  it('shortens the stem so the extension survives truncation', () => {
    // A caller reading the extension back off the result — to pick a reader, or to decide
    // whether a document processor runs — would otherwise be handed a PDF that looks
    // extensionless, with no error anywhere to say why.
    const result = sanitizeFilename(`${'x'.repeat(300)}.pdf`)
    expect(result).toHaveLength(255)
    expect(result.endsWith('.pdf')).toBe(true)
  })

  it('leaves no trailing dot or space when the cut lands on one', () => {
    // Trailing-character trimming runs before truncation would have re-created one, so the
    // result is a legal Windows name and feeding it back in is a no-op.
    const result = sanitizeFilename(`${'a'.repeat(254)}.txt`)
    expect(result).toHaveLength(255)
    expect(/[\s.]$/.test(result)).toBe(false)
    expect(sanitizeFilename(result)).toBe(result)
  })

  it('is idempotent across every branch', () => {
    for (const name of ['CON.txt', 'a<b.txt', 'name. ', `${'x'.repeat(300)}.pdf`, `${'a'.repeat(254)}.txt`, '..']) {
      expect(sanitizeFilename(sanitizeFilename(name))).toBe(sanitizeFilename(name))
    }
  })

  it('keeps a leading-dot name intact, having no extension to protect', () => {
    const result = sanitizeFilename(`.${'g'.repeat(300)}`)
    expect(result).toHaveLength(255)
    expect(result.startsWith('.g')).toBe(true)
  })

  it('returns "untitled" when every character was sanitised away', () => {
    expect(sanitizeFilename('...')).toBe('untitled')
    expect(sanitizeFilename('   ')).toBe('untitled')
  })

  it('returns the empty string for empty input (distinct from the all-sanitised case)', () => {
    expect(sanitizeFilename('')).toBe('')
  })

  it('replaces ASCII control characters (0x00-0x1f)', () => {
    expect(sanitizeFilename('foo\x01bar\x1fbaz')).toBe('foo_bar_baz')
  })
})

describe('validateFileName', () => {
  it('rejects empty filename', () => {
    expect(validateFileName('')).toEqual({ valid: false, error: expect.stringMatching(/empty/i) })
  })

  it('rejects filename with null byte', () => {
    expect(validateFileName('foo\0bar')).toEqual({ valid: false, error: expect.stringMatching(/null/i) })
  })

  it('rejects filename longer than 255 characters', () => {
    const longName = 'a'.repeat(256)
    expect(validateFileName(longName)).toEqual({ valid: false, error: expect.stringMatching(/length/i) })
  })

  it('rejects Windows-forbidden characters under win32 platform', () => {
    expect(validateFileName('a:b', 'win32')).toEqual({
      valid: false,
      error: expect.stringMatching(/Windows/)
    })
  })

  it('rejects Windows reserved names under win32 platform', () => {
    expect(validateFileName('CON.txt', 'win32')).toEqual({
      valid: false,
      error: expect.stringMatching(/reserved/i)
    })
  })

  it('rejects names ending with dot or space under win32 platform', () => {
    expect(validateFileName('foo.', 'win32').valid).toBe(false)
    expect(validateFileName('foo ', 'win32').valid).toBe(false)
  })

  it('accepts a clean filename', () => {
    expect(validateFileName('hello.txt')).toEqual({ valid: true })
  })
})
