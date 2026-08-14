import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AbsoluteFilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { canWrite, isPathInside, isSameOrInside } from '../path'

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

  it.runIf(process.platform === 'darwin' || process.platform === 'win32')(
    'matches case-insensitively on darwin / win32 (filesystem default)',
    () => {
      // Regression guard: a lexical containment check must not treat
      // differently-cased paths as unrelated on a case-insensitive host.
      expect(isPathInside('/Users/me/Data/Files/x.txt', '/users/me/data/files')).toBe(true)
      expect(isPathInside('/USERS/ME/DATA/FILES/x.txt', '/users/me/data/files')).toBe(true)
    }
  )

  it.runIf(process.platform === 'linux')('stays case-sensitive on linux (filesystem default)', () => {
    // On case-sensitive POSIX filesystems `/Users` and `/users` are
    // genuinely different paths; the function MUST NOT collapse them.
    expect(isPathInside('/Users/me/Data/Files/x.txt', '/users/me/data/files')).toBe(false)
  })
})

describe('isSameOrInside', () => {
  it('accepts equality and descendants', () => {
    expect(isSameOrInside('/foo/bar', '/foo/bar')).toBe(true)
    expect(isSameOrInside('/foo/bar/baz.txt', '/foo/bar')).toBe(true)
  })

  it('rejects ancestors and siblings', () => {
    expect(isSameOrInside('/foo', '/foo/bar')).toBe(false)
    expect(isSameOrInside('/foo/baz', '/foo/bar')).toBe(false)
  })

  it.runIf(process.platform === 'darwin' || process.platform === 'win32')(
    'matches equality case-insensitively on darwin / win32',
    () => {
      expect(isSameOrInside('/Users/me/Data/Files', '/users/me/data/files')).toBe(true)
    }
  )
})

describe('canWrite', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-path-test-'))
  })

  afterEach(async () => {
    // Restore perms before deletion in case a test chmod-restricted the dir
    try {
      await chmod(tmp, 0o755)
    } catch {
      // ignore
    }
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns true for a freshly-created writable directory', async () => {
    expect(await canWrite(tmp as AbsoluteFilePath)).toBe(true)
  })

  it('returns false for a non-existent path', async () => {
    expect(await canWrite(path.join(tmp, 'nope', String(Date.now())) as AbsoluteFilePath)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('returns false for a chmod-stripped directory (POSIX)', async () => {
    await chmod(tmp, 0o500)
    expect(await canWrite(tmp as AbsoluteFilePath)).toBe(false)
  })
})
