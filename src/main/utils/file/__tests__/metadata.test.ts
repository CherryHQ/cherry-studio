import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/types/file'
import iconv from 'iconv-lite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { decodeTextBufferIfText, getFileType, isTextFile, mimeToExt } from '../metadata'

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

describe('decodeTextBufferIfText', () => {
  it.each([
    ['UTF-8', 'Cherry Studio can read this extensionless text file.', 'utf8'],
    ['GBK', '这是一个没有扩展名的中文文本文件，用于验证自动编码检测。', 'gbk'],
    ['Big5', '這是一個沒有副檔名的繁體中文文字檔案，用於驗證自動編碼偵測。', 'big5'],
    ['Shift-JIS', 'これは拡張子のない日本語テキストファイルです。文字コードを確認します。', 'shift_jis']
  ])('recognizes and decodes %s text', (_, text, encoding) => {
    expect(decodeTextBufferIfText(iconv.encode(text, encoding))).toBe(text)
  })

  it('accepts a truncated sample that ends inside a UTF-8 character', () => {
    const text = `${'a'.repeat(8191)}中文`
    const sample = Buffer.from(text).subarray(0, 8192)

    expect(decodeTextBufferIfText(sample, { sampleMayBeTruncated: true })).toBe('a'.repeat(8191))
  })

  it.each([
    ['PDF', Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj')],
    ['ZIP', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 0xff, 0x00, 0x80, 0x01])],
    ['binary data', Buffer.from([0x00, 0xff, 0x80, 0x01, 0x02, 0x03, 0xfe, 0x7f])]
  ])('rejects %s bytes', (_, buffer) => {
    expect(decodeTextBufferIfText(buffer)).toBeNull()
  })

  it.each([
    ['GBK', '中文文本文件', 'gbk'],
    ['Big5', '中文', 'big5'],
    ['Shift-JIS', '日本語', 'shift_jis']
  ])('rejects ambiguous short %s bytes instead of returning mojibake', (_, text, encoding) => {
    expect(decodeTextBufferIfText(iconv.encode(text, encoding))).toBeNull()
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
