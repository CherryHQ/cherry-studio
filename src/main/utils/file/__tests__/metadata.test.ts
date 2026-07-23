import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/types/file'
import iconv from 'iconv-lite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { decodeTextBufferIfText, getFileType, isTextByContent, mimeToExt } from '../metadata'

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

  // Extension wins on mismatch (deliberate — see getFileType's contract). A
  // recognized extension is never content-sniffed, so the bytes are ignored.
  it('keeps a recognized text extension as "text" even when the content is binary', async () => {
    const f = path.join(tmp, 'mislabeled.txt')
    await writeFile(f, BINARY_SAMPLE)
    expect(await getFileType(f as FilePath)).toBe('text')
  })

  it('keeps a recognized non-text extension even when the content is text', async () => {
    const f = path.join(tmp, 'mislabeled.png')
    await writeFile(f, TEXT_SAMPLE)
    expect(await getFileType(f as FilePath)).toBe('image')
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

describe('decodeTextBufferIfText', () => {
  it.each([
    ['UTF-8', 'Cherry Studio can read this extensionless text file.', 'utf8'],
    ['GBK', '这是一个没有扩展名的中文文本文件，用于验证自动编码检测。', 'gbk'],
    ['Big5', '這是一個沒有副檔名的繁體中文文字檔案，用於驗證自動編碼偵測。', 'big5'],
    ['Shift-JIS', 'これは拡張子のない日本語テキストファイルです。文字コードを確認します。', 'shift_jis']
  ])('recognizes and decodes %s text', (_, text, encoding) => {
    expect(decodeTextBufferIfText(iconv.encode(text, encoding))).toBe(text)
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
