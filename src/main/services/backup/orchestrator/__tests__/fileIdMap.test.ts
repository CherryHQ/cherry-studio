import path from 'node:path'

import { describe, expect, it } from 'vitest'

function buildFileIdMap(entries: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of entries) {
    map.set(path.parse(entry).name, entry)
  }
  return map
}

describe('buildFileIdMap', () => {
  it('maps UUID to full filename with extension', () => {
    const entries = ['abc123.png', 'def456.jpg', 'ghi789.pdf']
    const map = buildFileIdMap(entries)

    expect(map.get('abc123')).toBe('abc123.png')
    expect(map.get('def456')).toBe('def456.jpg')
    expect(map.get('ghi789')).toBe('ghi789.pdf')
  })

  it('handles files without extensions', () => {
    const map = buildFileIdMap(['abc123'])
    expect(map.get('abc123')).toBe('abc123')
  })

  it('returns undefined for missing UUIDs', () => {
    const map = buildFileIdMap(['abc123.png'])
    expect(map.get('nonexistent')).toBeUndefined()
  })

  it('handles compound extensions by stripping only the last one', () => {
    const map = buildFileIdMap(['archive.tar.gz'])
    expect(map.get('archive.tar')).toBe('archive.tar.gz')
  })

  it('handles empty directory', () => {
    const map = buildFileIdMap([])
    expect(map.size).toBe(0)
  })

  it('handles UUID-style filenames with extensions', () => {
    const entries = ['a1b2c3d4-e5f6-7890-abcd-ef1234567890.png', 'f0e1d2c3-b4a5-6789-0123-456789abcdef.webp']
    const map = buildFileIdMap(entries)

    expect(map.get('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890.png')
    expect(map.get('f0e1d2c3-b4a5-6789-0123-456789abcdef')).toBe('f0e1d2c3-b4a5-6789-0123-456789abcdef.webp')
  })
})
