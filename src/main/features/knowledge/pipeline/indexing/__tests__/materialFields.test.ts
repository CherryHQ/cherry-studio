import { describe, expect, it } from 'vitest'

import { type MaterialFieldSource, toMaterialRelativePath } from '../materialFields'

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
