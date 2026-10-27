import { afterEach, describe, expect, it } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import {
  isInlineFilePath,
  normalizeInlineFilePath,
  parseFileLinkHref,
  resolveInlineFilePath,
  resolveMarkdownImageSrc,
  resolveNoteImageSrc,
  setInlineFilePathHomePath
} from '../filePath'

describe('filePath utils', () => {
  afterEach(() => {
    setInlineFilePathHomePath(undefined)
  })

  it('keeps home-relative paths readable while resolving them for file actions', () => {
    setInlineFilePathHomePath('/Users/alice')

    expect(normalizeInlineFilePath('`~/Desktop/report.html`')).toBe('~/Desktop/report.html')
    expect(resolveInlineFilePath('`~/Desktop/report.html`')).toBe('/Users/alice/Desktop/report.html')
    expect(isInlineFilePath('~/Desktop/report.html')).toBe(true)
  })
})

describe('parseFileLinkHref', () => {
  it.each([
    // strips hash / query, decodes percent-encoding, keeps single-segment names
    ['./README.md#安装', './README.md'],
    ['./Meeting%20Notes.md', './Meeting Notes.md'],
    ['docs/guide.md?v=2', 'docs/guide.md'],
    ['README.md', 'README.md'],
    ['./src/', './src/'],
    ['.agents/skills/gh-create-pr/SKILL.md', '.agents/skills/gh-create-pr/SKILL.md'],
    ['/abs/path/x.md', '/abs/path/x.md'],
    ['C:/Users/Alice/README.md', 'C:/Users/Alice/README.md'],
    ['C:\\Users\\Alice\\README.md', 'C:\\Users\\Alice\\README.md']
  ])('parses schemeless file path %s → %s', (href, expected) => {
    expect(parseFileLinkHref(href)).toBe(expected)
  })

  it.each([
    ['https://example.com/page.md'], // external https
    ['http://localhost:5173/x.md'], // external http
    ['mailto:a@b.com'],
    ['//cdn.example.com/x.md'], // protocol-relative
    ['https%3A%2F%2Fexample.com%2Fpage.md'], // encoded external https
    ['%2F%2Fcdn.example.com%2Fx.md'], // encoded protocol-relative
    ['javascript%3Aalert(1)'], // encoded unsafe scheme
    ['#section'], // in-page anchor
    ['file:///C:/Users/Alice/README.md'],
    ['file:///Users/x.md'],
    [''],
    [undefined]
  ])('returns null for external / scheme-prefixed href %s', (href) => {
    expect(parseFileLinkHref(href)).toBeNull()
  })
})

describe('resolveMarkdownImageSrc', () => {
  const note = '/notes/folder/note.md' as AbsoluteFilePath

  it.each([
    ['附件/a b.png', 'file:///notes/folder/%E9%99%84%E4%BB%B6/a%20b.png'],
    ['../shared/c.png', 'file:///notes/shared/c.png'],
    ['./d.png', 'file:///notes/folder/d.png']
  ])('resolves %s against the document folder', (src, expected) => {
    expect(resolveMarkdownImageSrc(note, src)).toBe(expected)
  })

  it.each(['https://example.com/a.png', 'file:///elsewhere/a.png', 'data:image/png;base64,AAAA', '/abs/a.png', '#x'])(
    'leaves %s unchanged',
    (src) => {
      expect(resolveMarkdownImageSrc(note, src)).toBe(src)
    }
  )
})

describe('resolveNoteImageSrc', () => {
  const note = '/notes/folder/note.md' as AbsoluteFilePath

  it.each([
    ['/Users/me/图 库/a b.png', 'file:///Users/me/%E5%9B%BE%20%E5%BA%93/a%20b.png'],
    ['/Users/me/a%20b.png', 'file:///Users/me/a%20b.png'],
    ['C:\\Users\\me\\a b.png', 'file:///C:/Users/me/a%20b.png'],
    ['附件/a.png', 'file:///notes/folder/%E9%99%84%E4%BB%B6/a.png']
  ])('resolves %s to a local file URL', (src, expected) => {
    expect(resolveNoteImageSrc(note, src)).toBe(expected)
  })

  it.each(['//server/share/a.png', 'https://example.com/a.png', 'data:image/png;base64,AAAA'])(
    'leaves %s unchanged',
    (src) => {
      expect(resolveNoteImageSrc(note, src)).toBe(src)
    }
  )
})
