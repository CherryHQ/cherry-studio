import { describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { isPathInside, isUnderInternalStorage } from '../path'

describe('isPathInside', () => {
  it('returns true when child is directly inside parent', () => {
    expect(isPathInside('/foo/bar/baz.txt', '/foo/bar')).toBe(true)
  })

  it('returns true when child is nested deeper', () => {
    expect(isPathInside('/foo/bar/baz/qux.txt', '/foo/bar')).toBe(true)
  })

  it('returns false when child is parent itself', () => {
    expect(isPathInside('/foo/bar', '/foo/bar')).toBe(false)
  })

  it('returns false when child is sibling', () => {
    expect(isPathInside('/foo/bar', '/foo/baz')).toBe(false)
  })

  it('returns false when child is parent of parent', () => {
    expect(isPathInside('/foo', '/foo/bar')).toBe(false)
  })

  it('handles path traversal attempts ("../") correctly', () => {
    expect(isPathInside('/foo/bar/../baz', '/foo/bar')).toBe(false)
  })
})

describe('isUnderInternalStorage', () => {
  it('returns true for paths inside the feature.files.data dir', () => {
    expect(isUnderInternalStorage('/mock/feature.files.data/abc.png')).toBe(true)
  })

  it('returns false for paths outside the feature.files.data dir', () => {
    expect(isUnderInternalStorage('/etc/passwd')).toBe(false)
  })

  it('returns false for the feature.files.data dir itself (only strict descendants count)', () => {
    expect(isUnderInternalStorage('/mock/feature.files.data')).toBe(false)
  })
})
