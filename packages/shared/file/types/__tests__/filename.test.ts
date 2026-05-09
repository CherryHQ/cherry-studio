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
