import { mkdtempSync, rmSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { fileNameFromUrl, resolveDownloadPath, sanitizeDownloadFileName, uniquifyFileName } from '../downloadPath'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-download-path-'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('sanitizeDownloadFileName', () => {
  it('collapses path separators and forbidden characters', () => {
    expect(sanitizeDownloadFileName('../../etc/passwd')).toBe('_.._etc_passwd')
    expect(sanitizeDownloadFileName('a:b*c?d"e<f>g|h.txt')).toBe('a_b_c_d_e_f_g_h.txt')
  })

  it('strips leading dots and control characters', () => {
    expect(sanitizeDownloadFileName('...hidden.txt')).toBe('hidden.txt')
    expect(sanitizeDownloadFileName('a\u0000b.txt')).toBe('a_b.txt')
  })

  it('falls back when nothing usable remains', () => {
    expect(sanitizeDownloadFileName('', 'fallback.bin')).toBe('fallback.bin')
    expect(sanitizeDownloadFileName('...')).toBe('download')
  })

  it('escapes Windows reserved names', () => {
    expect(sanitizeDownloadFileName('CON.txt')).toBe('CON.txt_')
    expect(sanitizeDownloadFileName('lpt1')).toBe('lpt1_')
  })

  it('caps the length', () => {
    expect(sanitizeDownloadFileName('a'.repeat(400)).length).toBeLessThanOrEqual(120)
  })
})

describe('uniquifyFileName', () => {
  it('inserts the counter before the extension', () => {
    expect(uniquifyFileName('report.pdf', 0)).toBe('report.pdf')
    expect(uniquifyFileName('report.pdf', 2)).toBe('report (2).pdf')
    expect(uniquifyFileName('archive.tar.gz', 1)).toBe('archive.tar (1).gz')
  })
})

describe('resolveDownloadPath', () => {
  it('returns the plain path when the name is free', async () => {
    await expect(resolveDownloadPath(dir, 'a.txt', 'uniquify')).resolves.toBe(join(dir, 'a.txt'))
  })

  it('uniquifies around an existing file', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x')
    await expect(resolveDownloadPath(dir, 'a.txt', 'uniquify')).resolves.toBe(join(dir, 'a (1).txt'))
  })

  it('throws for the fail policy and keeps the path for overwrite', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x')
    await expect(resolveDownloadPath(dir, 'a.txt', 'fail')).rejects.toThrow(/already exists/)
    await expect(resolveDownloadPath(dir, 'a.txt', 'overwrite')).resolves.toBe(join(dir, 'a.txt'))
  })
})

describe('fileNameFromUrl', () => {
  it('takes the last path segment and decodes it', () => {
    expect(fileNameFromUrl('https://example.com/files/report%20final.pdf?x=1')).toBe('report final.pdf')
    expect(fileNameFromUrl('https://example.com/')).toBe('download')
    expect(fileNameFromUrl('not a url')).toBe('download')
  })
})
