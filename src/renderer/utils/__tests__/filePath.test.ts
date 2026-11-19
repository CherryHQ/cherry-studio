import { afterEach, describe, expect, it } from 'vitest'

import {
  isInlineFilePath,
  normalizeInlineFilePath,
  parseFileLinkHref,
  parseFileLinkTarget,
  parseInlineFileTarget,
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
    ['javascript:42'],
    ['https:42'],
    ['custom.scheme:42'],
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

describe('file source locations', () => {
  it.each([
    ['src/main.ts:42', { path: 'src/main.ts', location: { line: 42 } }],
    ['C:/src/main.ts:42:5', { path: 'C:/src/main.ts', location: { line: 42, column: 5 } }],
    ['src/main.ts#L42', { path: 'src/main.ts', location: { line: 42 } }],
    ['src/main.ts#L42-L48', { path: 'src/main.ts', location: { line: 42, endLine: 48 } }]
  ])('preserves coordinates separately from the path: %s', (source, expected) => {
    expect(parseInlineFileTarget(source)).toEqual(expected)
    expect(parseFileLinkTarget(source)).toEqual(expected)
  })

  it.each(['src/main.ts:0', 'src/main.ts:2:0', 'src/main.ts:9007199254740992', 'src/main.ts#L9-L2', 'src/main.ts#L0'])(
    'does not navigate an invalid location: %s',
    (source) => {
      expect(parseInlineFileTarget(source)).toEqual({ path: 'src/main.ts' })
      expect(parseFileLinkTarget(source)).toEqual({ path: 'src/main.ts' })
    }
  )

  it('parses locations before decoding literal filename punctuation', () => {
    expect(parseFileLinkTarget('./report%3A42')).toEqual({ path: './report:42' })
    expect(parseFileLinkTarget('./report%23L42')).toEqual({ path: './report#L42' })
    expect(parseFileLinkTarget('./report%3A42#L7')).toEqual({ path: './report:42', location: { line: 7 } })
    expect(parseFileLinkTarget('./notes.md#section')).toEqual({ path: './notes.md' })
  })
})
