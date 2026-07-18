import { afterEach, describe, expect, it } from 'vitest'

import {
  isInlineFilePath,
  isWindowsDrivePath,
  normalizeInlineFilePath,
  parseFileLinkHref,
  resolveInlineFilePath,
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

describe('isWindowsDrivePath', () => {
  it.each(['C:/Users/x.md', 'C:\\Users\\x.md', 'c:/users/x.md', 'D:\\a'])('detects %s', (value) => {
    expect(isWindowsDrivePath(value)).toBe(true)
  })

  it.each(['/Users/x.md', './x.md', 'C:x', 'https://c/x', 'CC:/x'])('rejects %s', (value) => {
    expect(isWindowsDrivePath(value)).toBe(false)
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
    // Windows drive paths must not be mistaken for a `c:` URL scheme
    ['C:/Users/Alice/project/README.md', 'C:/Users/Alice/project/README.md'],
    ['C:\\Users\\Alice\\project\\README.md', 'C:\\Users\\Alice\\project\\README.md'],
    ['C:/Users/Alice/notes.md#top', 'C:/Users/Alice/notes.md'],
    // Rooted drive path (the form remarkFileLinks emits) is un-rooted back to `C:/…`
    ['/C:/Users/Alice/project/README.md', 'C:/Users/Alice/project/README.md'],
    ['/D:/Docs/Meeting%20Notes.md#top', 'D:/Docs/Meeting Notes.md'],
    // A real POSIX absolute path keeps its leading slash (no drive letter follows it)
    ['/abs/C-notes/x.md', '/abs/C-notes/x.md']
  ])('parses %s → %s', (href, expected) => {
    expect(parseFileLinkHref(href)).toBe(expected)
  })

  it.each([
    ['https://example.com/page.md'], // external https
    ['http://localhost:5173/x.md'], // external http
    ['mailto:a@b.com'],
    ['file:///Users/x.md'], // file: is blocked upstream by rehype-harden → treated as external
    ['//cdn.example.com/x.md'], // protocol-relative
    ['#section'], // in-page anchor
    [''],
    [undefined]
  ])('returns null for external / non-file href %s', (href) => {
    expect(parseFileLinkHref(href)).toBeNull()
  })
})
