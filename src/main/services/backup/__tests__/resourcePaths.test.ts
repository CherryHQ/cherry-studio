import { describe, expect, it } from 'vitest'

import { BACKUP_CEILINGS } from '../ceilings'
import { type ResourcePathCandidate, validateResourcePaths } from '../resourcePaths'

function candidate(overrides: Partial<ResourcePathCandidate> = {}): ResourcePathCandidate {
  return {
    livePath: 'Data/Files/blob-a',
    resourceType: 'file',
    targetState: 'absent',
    ancestorsSafe: true,
    containedInRegisteredRoot: true,
    sameFilesystemAsRoot: true,
    ...overrides
  }
}

describe('validateResourcePaths — happy path', () => {
  it('accepts a clean, distinct, non-overlapping set', () => {
    const result = validateResourcePaths([
      candidate({ livePath: 'Data/Files/a' }),
      candidate({ livePath: 'Data/Files/b' }),
      candidate({ livePath: 'Data/KnowledgeBase/base-1', resourceType: 'directory', targetState: 'directory' })
    ])
    expect(result.ok).toBe(true)
  })

  it('accepts an empty plan', () => {
    expect(validateResourcePaths([]).ok).toBe(true)
  })

  it('accepts installing over an existing target of the SAME type', () => {
    expect(validateResourcePaths([candidate({ resourceType: 'file', targetState: 'file' })]).ok).toBe(true)
    expect(validateResourcePaths([candidate({ resourceType: 'directory', targetState: 'directory' })]).ok).toBe(true)
  })

  it('treats sibling directories under a shared parent as non-overlapping', () => {
    const result = validateResourcePaths([
      candidate({ livePath: 'Data/KnowledgeBase/a', resourceType: 'directory', targetState: 'directory' }),
      candidate({ livePath: 'Data/KnowledgeBase/c', resourceType: 'directory', targetState: 'directory' })
    ])
    expect(result.ok).toBe(true)
  })
})

describe('validateResourcePaths — count ceiling', () => {
  it('rejects more entries than the ceiling', () => {
    const tiny = { ...BACKUP_CEILINGS, maxResourceInstallEntries: 2 }
    const many = [candidate({ livePath: 'a' }), candidate({ livePath: 'b' }), candidate({ livePath: 'c' })]
    const result = validateResourcePaths(many, tiny)
    expect(result).toMatchObject({ ok: false, violation: { code: 'too-many', count: 3, limit: 2 } })
  })
})

describe('validateResourcePaths — per-entry trusted facts (no faked fs)', () => {
  it('rejects an unsafe/absolute live path', () => {
    const result = validateResourcePaths([candidate({ livePath: '/etc/passwd' })])
    expect(result).toMatchObject({ ok: false, violation: { code: 'invalid-path', index: 0 } })
  })

  it('rejects an unsafe ancestor (symlink/special on the path to the target)', () => {
    const result = validateResourcePaths([candidate({ ancestorsSafe: false })])
    expect(result).toMatchObject({ ok: false, violation: { code: 'unsafe-ancestor' } })
  })

  it('rejects a symlink or special-file target', () => {
    expect(validateResourcePaths([candidate({ targetState: 'symlink' })])).toMatchObject({
      ok: false,
      violation: { code: 'target-not-installable', targetState: 'symlink' }
    })
    expect(validateResourcePaths([candidate({ targetState: 'special' })])).toMatchObject({
      ok: false,
      violation: { code: 'target-not-installable', targetState: 'special' }
    })
  })

  it('rejects installing a file over an existing directory (and vice versa)', () => {
    expect(validateResourcePaths([candidate({ resourceType: 'file', targetState: 'directory' })])).toMatchObject({
      ok: false,
      violation: { code: 'target-type-mismatch', resourceType: 'file', targetState: 'directory' }
    })
    expect(validateResourcePaths([candidate({ resourceType: 'directory', targetState: 'file' })])).toMatchObject({
      ok: false,
      violation: { code: 'target-type-mismatch', resourceType: 'directory', targetState: 'file' }
    })
  })

  it('rejects a target outside a registered root (containment fact)', () => {
    const result = validateResourcePaths([candidate({ containedInRegisteredRoot: false })])
    expect(result).toMatchObject({ ok: false, violation: { code: 'outside-root' } })
  })

  it('rejects a cross-filesystem install (EXDEV fact)', () => {
    const result = validateResourcePaths([candidate({ sameFilesystemAsRoot: false })])
    expect(result).toMatchObject({ ok: false, violation: { code: 'cross-filesystem' } })
  })
})

describe('validateResourcePaths — set invariants', () => {
  it('rejects duplicate live paths', () => {
    const result = validateResourcePaths([
      candidate({ livePath: 'Data/Files/a' }),
      candidate({ livePath: 'Data/Files/a' })
    ])
    expect(result).toMatchObject({ ok: false, violation: { code: 'duplicate', index: 1, livePath: 'Data/Files/a' } })
  })

  it('rejects case-insensitive collisions (Foo/a vs foo/a)', () => {
    const result = validateResourcePaths([candidate({ livePath: 'Data/Foo/a' }), candidate({ livePath: 'Data/foo/a' })])
    expect(result).toMatchObject({ ok: false, violation: { code: 'duplicate' } })
  })

  it('rejects Unicode NFC/NFD normalization collisions', () => {
    // "é" as single code point (NFC) vs "e"+combining-acute (NFD).
    const nfc = 'Data/Notes/caf\u00e9.md'
    const nfd = 'Data/Notes/cafe\u0301.md'
    expect(nfc.normalize('NFC')).toBe(nfd.normalize('NFC'))
    const result = validateResourcePaths([candidate({ livePath: nfc }), candidate({ livePath: nfd })])
    expect(result).toMatchObject({ ok: false, violation: { code: 'duplicate' } })
  })

  it('rejects a direct ancestor/descendant overlap', () => {
    const result = validateResourcePaths([
      candidate({ livePath: 'Data/KnowledgeBase/base-1', resourceType: 'directory', targetState: 'directory' }),
      candidate({ livePath: 'Data/KnowledgeBase/base-1/file.txt' })
    ])
    expect(result).toMatchObject({ ok: false, violation: { code: 'ancestor-overlap' } })
  })

  it('detects a non-adjacent (deep) ancestor overlap regardless of input order', () => {
    const result = validateResourcePaths([
      candidate({ livePath: 'Data/kb/base/deep/leaf.txt' }),
      candidate({ livePath: 'Data/kb/base/mid.txt' }),
      candidate({ livePath: 'Data/kb/base', resourceType: 'directory', targetState: 'directory' })
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violation.code).toBe('ancestor-overlap')
    }
  })

  it('detects an overlap when a decoy sibling string-sorts between ancestor and descendant', () => {
    // `Data/kb-old/...` byte-sorts between `Data/kb` and `Data/kb/base` (`-` < `/`),
    // which would defeat a raw-string sort but not a segment-wise sort.
    const result = validateResourcePaths([
      candidate({ livePath: 'Data/kb', resourceType: 'directory', targetState: 'directory' }),
      candidate({ livePath: 'Data/kb-old/note.txt' }),
      candidate({ livePath: 'Data/kb/base.txt' })
    ])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.violation.code).toBe('ancestor-overlap')
    }
  })

  it('detects a case-insensitive ancestor overlap', () => {
    const result = validateResourcePaths([
      candidate({ livePath: 'Data/KB', resourceType: 'directory', targetState: 'directory' }),
      candidate({ livePath: 'Data/kb/child.txt' })
    ])
    expect(result).toMatchObject({ ok: false, violation: { code: 'ancestor-overlap' } })
  })
})

describe('validateResourcePaths — precedence', () => {
  it('reports the count ceiling before per-entry violations', () => {
    const tiny = { ...BACKUP_CEILINGS, maxResourceInstallEntries: 1 }
    const result = validateResourcePaths([candidate({ livePath: '/abs' }), candidate({ livePath: '/abs2' })], tiny)
    expect(result).toMatchObject({ ok: false, violation: { code: 'too-many' } })
  })

  it('reports an invalid path before a duplicate check', () => {
    const result = validateResourcePaths([candidate({ livePath: '/abs' }), candidate({ livePath: '/abs' })])
    expect(result).toMatchObject({ ok: false, violation: { code: 'invalid-path', index: 0 } })
  })
})
