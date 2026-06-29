import { describe, expect, it } from 'vitest'

import { extractTitleFromRelativePath, type MaterialFieldSource, toMaterialRelativePath } from '../materialFields'

describe('toMaterialRelativePath', () => {
  it('uses a file’s stored relativePath when there is no processed artifact', () => {
    const file: MaterialFieldSource = {
      id: 'file-1',
      type: 'file',
      data: { source: '/docs/report.pdf', relativePath: 'report.pdf' }
    }
    expect(toMaterialRelativePath(file)).toBe('report.pdf')
  })

  it('prefers a file’s processed-artifact path (indexedRelativePath) over the source path', () => {
    const file: MaterialFieldSource = {
      id: 'file-2',
      type: 'file',
      data: { source: '/docs/report.pdf', relativePath: 'report.pdf', indexedRelativePath: 'report.md' }
    }
    expect(toMaterialRelativePath(file)).toBe('report.md')
  })

  it('uses a url’s captured snapshot path once it has one (the real raw/ file, matching the migrator)', () => {
    const url: MaterialFieldSource = {
      id: 'url-1',
      type: 'url',
      data: { source: 'https://example.com', url: 'https://example.com', relativePath: 'example-page.md' }
    }
    expect(toMaterialRelativePath(url)).toBe('example-page.md')
  })

  it('uses a note’s captured snapshot path once it has one (the real raw/ file, matching the migrator)', () => {
    const note: MaterialFieldSource = {
      id: 'note-1',
      type: 'note',
      data: { source: 'My note', content: 'hello', relativePath: 'My note.md' }
    }
    expect(toMaterialRelativePath(note)).toBe('My note.md')
  })

  it('throws for a url that has not been captured yet — a snapshot is always materialized first', () => {
    const url: MaterialFieldSource = {
      id: 'url-2',
      type: 'url',
      data: { source: 'https://example.com', url: 'https://example.com' }
    }
    expect(() => toMaterialRelativePath(url)).toThrow('has no captured snapshot relativePath')
  })

  it('throws for a note that has not been captured yet — a snapshot is always materialized first', () => {
    const note: MaterialFieldSource = {
      id: 'note-2',
      type: 'note',
      data: { source: 'My note', content: 'hello' }
    }
    expect(() => toMaterialRelativePath(note)).toThrow('has no captured snapshot relativePath')
  })
})

describe('extractTitleFromRelativePath', () => {
  it('strips the file extension from a simple filename', () => {
    expect(extractTitleFromRelativePath('report.pdf')).toBe('report')
  })

  it('strips the extension from a path with directories', () => {
    expect(extractTitleFromRelativePath('raw/chapter 1.pdf')).toBe('chapter 1')
  })

  it('handles filenames with multiple dots', () => {
    expect(extractTitleFromRelativePath('my.document.v2.pdf')).toBe('my.document.v2')
  })

  it('handles markdown files', () => {
    expect(extractTitleFromRelativePath('notes.md')).toBe('notes')
  })

  it('handles filenames without extensions', () => {
    expect(extractTitleFromRelativePath('readme')).toBe('readme')
  })

  it('handles CJK filenames', () => {
    expect(extractTitleFromRelativePath('测试文件.pdf')).toBe('测试文件')
  })

  it('handles Chinese chapter names', () => {
    expect(extractTitleFromRelativePath('第一章.pdf')).toBe('第一章')
  })
})
