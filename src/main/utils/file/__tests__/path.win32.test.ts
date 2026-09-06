import type * as NodePath from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('node:path', async () => {
  const actual = await vi.importActual<typeof NodePath>('node:path')
  return { ...actual.win32, default: actual.win32 }
})

describe('isFilesystemRoot on a Windows host', () => {
  it.each([
    'C:\\',
    'C:/',
    'C:\\tmp\\..',
    '\\\\server\\share',
    '\\\\server\\share\\',
    '//server/share',
    '\\\\?\\UNC\\server\\share',
    '\\\\?\\UNC\\server\\share\\',
    '\\\\?\\unc\\server\\share'
  ])('identifies a path that resolves to a filesystem root: %s', async (value) => {
    const { isFilesystemRoot } = await import('../path')
    expect(isFilesystemRoot(value)).toBe(true)
  })

  it.each([
    'C:\\work',
    'C:/work/project',
    '\\\\server\\share\\project',
    '//server/share/project',
    '\\\\?\\UNC\\server\\share\\project'
  ])('does not reject a nested directory: %s', async (value) => {
    const { isFilesystemRoot } = await import('../path')
    expect(isFilesystemRoot(value)).toBe(false)
  })
})
