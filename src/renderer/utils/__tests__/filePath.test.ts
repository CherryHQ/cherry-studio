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
  it('rejects UNC paths unless network targets are explicitly allowed', () => {
    const href = String.raw`\\server\share\docs\report.md`

    expect(parseFileLinkHref(href)).toBeNull()
    expect(parseFileLinkHref(href, { allowNetworkTargets: true })).toBe(href)
  })

  it.each([
    ['parenthesis + TAB', '%28%09%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['parenthesis + LF', '%28%0A%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['parenthesis + CR', '%28%0D%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['parenthesis + NBSP', '%28%C2%A0%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['parenthesis + space', '%28%20%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['backtick + TAB', '%60%09%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['bracket + quote + TAB', '%5B%22%09%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['parenthesis + TAB + forward slashes', '%28%09%2F%2Fattacker.example/share/notes.txt']
  ])('rejects punctuation + whitespace UNC href (%s) unless network targets are explicitly allowed', (_name, href) => {
    expect(parseFileLinkHref(href)).toBeNull()
    const decodedHref = decodeURIComponent(href)
    expect(parseFileLinkHref(decodedHref)).toBeNull()
    expect(parseFileLinkHref(decodedHref, { allowNetworkTargets: true })).toBe(decodedHref)
    expect(parseFileLinkHref(href, { allowNetworkTargets: true })).toBe(decodedHref)
  })

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
    ['%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['%20%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['%09%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['%0A%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['%C2%A0%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['%28%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['%22%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['%5B%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['%60%5C%5Cattacker.example%5Cshare%5Cnotes.txt'],
    ['%5C%2F%5C%2Fattacker.example%5Cshare%5Cnotes.txt'],
    ['%2F%5Cattacker.example%5Cshare%5Cnotes.txt'],
    [String.raw`\\attacker.example\share\notes.txt`], // literal UNC: leading "\\" is a network root
    ['%5C%5C%3F%5CUNC%5Cattacker.example%5Cshare%5Cnotes.txt'],
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
