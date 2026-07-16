import { describe, expect, it } from 'vitest'

import {
  createFilePreviewTabTarget,
  getFilePreviewExtension,
  getFilePreviewFileName,
  getFilePreviewRefreshKey,
  normalizeFilePreviewPath,
  parseFilePreviewRouteSearch
} from '../filePreview'

describe('file preview paths', () => {
  it('canonicalizes POSIX paths and preserves the file name', () => {
    const path = normalizeFilePreviewPath('/tmp//workspace///./notes/../report.PDF')

    expect(path).toBe('/tmp/workspace/report.PDF')
    expect(getFilePreviewFileName(path)).toBe('report.PDF')
    expect(getFilePreviewExtension(path)).toBe('pdf')
  })

  it('canonicalizes Windows paths with either separator', () => {
    const path = normalizeFilePreviewPath('c:/Users/test/notes/../report.docx')

    expect(path).toBe('C:\\Users\\test\\report.docx')
    expect(getFilePreviewFileName(path)).toBe('report.docx')
  })

  it('normalizes Unicode paths to NFC', () => {
    expect(normalizeFilePreviewPath('/tmp/Cafe\u0301.md')).toBe('/tmp/Caf\u00e9.md')
  })

  it.each(['', 'notes/report.md', './report.md', 'file:///tmp/report.md', '/tmp/bad\0name.md'])(
    'rejects invalid local path %j',
    (path) => {
      expect(() => normalizeFilePreviewPath(path)).toThrow()
    }
  )

  it('does not treat a dotfile or extensionless file as having an extension', () => {
    expect(getFilePreviewExtension('/tmp/.gitignore')).toBeNull()
    expect(getFilePreviewExtension('/tmp/LICENSE')).toBeNull()
  })
})

describe('file preview route target', () => {
  it('builds a canonical encoded route and basename title', () => {
    const target = createFilePreviewTabTarget('/tmp/My Files/notes/../report #1.md')

    expect(target).toEqual({
      filePath: '/tmp/My Files/report #1.md',
      title: 'report #1.md',
      url: '/app/file-preview?path=%2Ftmp%2FMy+Files%2Freport+%231.md'
    })
  })

  it('builds the same URL for lexically equivalent paths', () => {
    expect(createFilePreviewTabTarget('/tmp/notes/../report.md').url).toBe(
      createFilePreviewTabTarget('/tmp/report.md').url
    )
  })

  it('parses valid search paths and contains invalid route input', () => {
    expect(parseFilePreviewRouteSearch({ path: '/tmp/notes/../report.md' })).toEqual({
      path: '/tmp/report.md'
    })
    expect(parseFilePreviewRouteSearch({ path: 'relative/report.md' })).toEqual({ path: undefined })
    expect(parseFilePreviewRouteSearch({})).toEqual({ path: undefined })
  })

  it('accepts only non-negative safe integer refresh keys', () => {
    expect(getFilePreviewRefreshKey({ filePreviewRefreshKey: 3 })).toBe(3)
    expect(getFilePreviewRefreshKey({ filePreviewRefreshKey: -1 })).toBe(0)
    expect(getFilePreviewRefreshKey({ filePreviewRefreshKey: 1.5 })).toBe(0)
    expect(getFilePreviewRefreshKey({ filePreviewRefreshKey: '3' })).toBe(0)
    expect(getFilePreviewRefreshKey(undefined)).toBe(0)
  })
})
