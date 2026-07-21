import { afterEach, describe, expect, it } from 'vitest'

import {
  isInlineFilePath,
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

describe('parseFileLinkHref', () => {
  it.each([
    // strips hash / query, decodes percent-encoding, keeps single-segment names
    ['./README.md#安装', './README.md'],
    ['./Meeting%20Notes.md', './Meeting Notes.md'],
    ['docs/guide.md?v=2', 'docs/guide.md'],
    ['README.md', 'README.md'],
    ['./src/', './src/'],
    ['.agents/skills/gh-create-pr/SKILL.md', '.agents/skills/gh-create-pr/SKILL.md'],
    ['/abs/path/x.md', '/abs/path/x.md']
  ])('parses schemeless file path %s → %s', (href, expected) => {
    expect(parseFileLinkHref(href)).toBe(expected)
  })

  it.each([
    ['https://example.com/page.md'], // external https
    ['http://localhost:5173/x.md'], // external http
    ['mailto:a@b.com'],
    ['//cdn.example.com/x.md'], // protocol-relative
    ['#section'], // in-page anchor
    // Scheme-prefixed absolute paths never reach Link — the markdown link-safety pipeline
    // strips them upstream — so they are treated as external (unsupported by design).
    ['C:/Users/Alice/README.md'],
    ['file:///C:/Users/Alice/README.md'],
    ['file:///Users/x.md'],
    [''],
    [undefined]
  ])('returns null for external / scheme-prefixed href %s', (href) => {
    expect(parseFileLinkHref(href)).toBeNull()
  })
})
