import type { AbsoluteFilePath } from '@shared/types/file'
import { describe, expect, it } from 'vitest'

import { getRelativePath, isPathInside, isSamePath } from '../path'

/** Fixture helper — these are shape-valid absolute paths, so the brand is safe to assert. */
const p = (value: string) => value as AbsoluteFilePath

describe('isSamePath', () => {
  it('treats a path as the same as itself', () => {
    expect(isSamePath(p('/workspace/notes.md'), p('/workspace/notes.md'))).toBe(true)
  })

  it('resolves . and .. segments before comparing', () => {
    expect(isSamePath(p('/workspace/./docs/../notes.md'), p('/workspace/notes.md'))).toBe(true)
  })

  it('ignores a trailing separator', () => {
    expect(isSamePath(p('/workspace/'), p('/workspace'))).toBe(true)
  })

  it('treats the POSIX root as the same as itself', () => {
    expect(isSamePath(p('/'), p('/'))).toBe(true)
  })

  it('ignores Windows drive-letter case and separator style', () => {
    expect(isSamePath(p('c:\\workspace\\notes.md'), p('C:/workspace/notes.md'))).toBe(true)
  })

  it('is case-sensitive on the path body', () => {
    expect(isSamePath(p('/Workspace/notes.md'), p('/workspace/notes.md'))).toBe(false)
  })

  it('rejects different paths', () => {
    expect(isSamePath(p('/workspace/a.md'), p('/workspace/b.md'))).toBe(false)
  })

  it('reports byte-identical UNC paths as not provably the same, rather than throwing', () => {
    const unc = p('\\\\server\\share\\notes.md')

    expect(() => isSamePath(unc, unc)).not.toThrow()
    expect(isSamePath(unc, unc)).toBe(false)
  })
})

describe('isPathInside', () => {
  it('reports a descendant as inside', () => {
    expect(isPathInside(p('/workspace/docs/notes.md'), p('/workspace'))).toBe(true)
  })

  it('is strict: a path is not inside itself', () => {
    expect(isPathInside(p('/workspace'), p('/workspace'))).toBe(false)
  })

  it('rejects a sibling that only shares a name prefix', () => {
    expect(isPathInside(p('/workspace-2/notes.md'), p('/workspace'))).toBe(false)
  })

  it('resolves .. before comparing, so a traversal escape is not inside', () => {
    expect(isPathInside(p('/workspace/../outside/secret.txt'), p('/workspace'))).toBe(false)
  })

  it('reports a path as inside the POSIX root', () => {
    expect(isPathInside(p('/notes.md'), p('/'))).toBe(true)
  })

  it('reports a path as inside its Windows drive root', () => {
    expect(isPathInside(p('C:/notes.md'), p('C:\\'))).toBe(true)
  })

  it('matches across separator styles', () => {
    expect(isPathInside(p('c:\\workspace\\docs\\notes.md'), p('C:/workspace'))).toBe(true)
  })

  it('reports an un-canonicalizable child as not inside, rather than throwing', () => {
    expect(() => isPathInside(p('\\\\server\\share\\notes.md'), p('C:\\workspace'))).not.toThrow()
    expect(isPathInside(p('\\\\server\\share\\notes.md'), p('C:\\workspace'))).toBe(false)
  })

  it('reports nothing as inside an un-canonicalizable parent, rather than throwing', () => {
    expect(isPathInside(p('C:\\workspace\\notes.md'), p('\\\\server\\share'))).toBe(false)
  })
})

describe('getRelativePath', () => {
  it('returns the remainder for a descendant', () => {
    expect(getRelativePath(p('/workspace'), p('/workspace/docs/notes.md'))).toBe('docs/notes.md')
  })

  it('returns an empty string for the base itself', () => {
    expect(getRelativePath(p('/workspace'), p('/workspace'))).toBe('')
  })

  it('returns null for a path outside the base', () => {
    expect(getRelativePath(p('/workspace'), p('/other/notes.md'))).toBe(null)
  })

  it('returns null for a sibling that only shares a name prefix', () => {
    expect(getRelativePath(p('/workspace'), p('/workspace-2/notes.md'))).toBe(null)
  })

  it('computes against the POSIX root', () => {
    expect(getRelativePath(p('/'), p('/notes.md'))).toBe('notes.md')
  })

  it('computes against a Windows drive root', () => {
    expect(getRelativePath(p('C:\\'), p('C:/notes.md'))).toBe('notes.md')
  })

  it('returns a forward-slash relative path for Windows inputs', () => {
    expect(getRelativePath(p('C:/workspace'), p('c:\\workspace\\docs\\notes.md'))).toBe('docs/notes.md')
  })

  it('returns null when either side is un-canonicalizable, rather than throwing', () => {
    expect(() => getRelativePath(p('C:\\workspace'), p('\\\\server\\share\\notes.md'))).not.toThrow()
    expect(getRelativePath(p('C:\\workspace'), p('\\\\server\\share\\notes.md'))).toBe(null)
    expect(getRelativePath(p('\\\\server\\share'), p('C:\\workspace\\notes.md'))).toBe(null)
  })
})
