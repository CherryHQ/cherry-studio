import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getFileType, isTextByContent, mimeToExt } from '../metadata'

// A chunk of UTF-8 text long enough for chardet to detect with high confidence.
const TEXT_SAMPLE = '这是一段自定义格式的纯文本内容，长度足够让编码检测有信心地判定为文本。\n'.repeat(4)
// Binary bytes (contains null) so isBinaryFile classifies it as non-text.
const BINARY_SAMPLE = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x10])

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

  it('falls back to "other" for an unknown extension with binary content', async () => {
    const f = path.join(tmp, 'mystery.xyz123')
    await writeFile(f, BINARY_SAMPLE)
    expect(await getFileType(f as FilePath)).toBe('other')
  })

  // Content-sniff upgrade: uncommon / extension-less text files must be
  // recognized as text so users can attach them in chat (see metadata.ts).
  it('upgrades an unknown extension with text content to "text"', async () => {
    const f = path.join(tmp, 'mystery.xyz123')
    await writeFile(f, TEXT_SAMPLE)
    expect(await getFileType(f as FilePath)).toBe('text')
  })

  it('upgrades an extension-less text file to "text"', async () => {
    const f = path.join(tmp, 'no-ext')
    await writeFile(f, TEXT_SAMPLE)
    expect(await getFileType(f as FilePath)).toBe('text')
  })
})

describe('isTextByContent', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-meta-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns true for text content regardless of extension', async () => {
    const f = path.join(tmp, 'weird.bin')
    await writeFile(f, TEXT_SAMPLE)
    expect(await isTextByContent(f as FilePath)).toBe(true)
  })

  it('returns false for binary content', async () => {
    const f = path.join(tmp, 'data.txt')
    await writeFile(f, BINARY_SAMPLE)
    expect(await isTextByContent(f as FilePath)).toBe(false)
  })

  it('returns false (does not throw) for a missing file', async () => {
    expect(await isTextByContent(path.join(tmp, 'nope') as FilePath)).toBe(false)
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
