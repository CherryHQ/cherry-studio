import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/file/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getFileType, isTextFile, mimeToExt } from '../metadata'

describe('getFileType', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-meta-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('classifies image extension as image', async () => {
    const f = path.join(tmp, 'pic.png')
    await writeFile(f, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(await getFileType(f as FilePath)).toBe('image')
  })

  it('classifies pdf as document', async () => {
    const f = path.join(tmp, 'doc.pdf')
    await writeFile(f, '%PDF-')
    expect(await getFileType(f as FilePath)).toBe('document')
  })

  it('falls back to "other" for unknown extension', async () => {
    const f = path.join(tmp, 'mystery.xyz123')
    await writeFile(f, '...')
    expect(await getFileType(f as FilePath)).toBe('other')
  })

  it('falls back to "other" for files with no extension', async () => {
    const f = path.join(tmp, 'no-ext')
    await writeFile(f, '...')
    expect(await getFileType(f as FilePath)).toBe('other')
  })
})

describe('isTextFile', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-meta-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns true for known text extensions', async () => {
    const f = path.join(tmp, 'note.txt')
    await writeFile(f, 'plain text')
    expect(await isTextFile(f as FilePath)).toBe(true)
  })

  it('returns false for image extensions', async () => {
    const f = path.join(tmp, 'pic.png')
    await writeFile(f, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(await isTextFile(f as FilePath)).toBe(false)
  })
})

describe('mimeToExt', () => {
  it('maps image/png to png (no leading dot)', () => {
    expect(mimeToExt('image/png')).toBe('png')
  })

  it('maps application/pdf to pdf', () => {
    expect(mimeToExt('application/pdf')).toBe('pdf')
  })

  it('returns undefined for unknown mime types', () => {
    expect(mimeToExt('foo/bar-unknown-xyz')).toBeUndefined()
  })
})
