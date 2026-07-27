import { describe, expect, it } from 'vitest'

import type { ManagedRootIdentity } from '../../manifest'
import {
  type BackupPlatform,
  classifyManagedPath,
  isPathContainedIn,
  type ManagedRootRebaseTable,
  prepareManagedRootRebase,
  REBASABLE_MANAGED_ROOT_KEYS
} from '../managedPathRebase'

const NOTES = 'feature.notes.data'
const WORKSPACES = 'feature.agents.workspaces'

const PRODUCER_NOTES = '/Users/alice/Library/Application Support/CherryStudio/Data/Notes'
const TARGET_NOTES = '/Users/bob/Library/Application Support/CherryStudio/Data/Notes'

function table(overrides: {
  producerPlatform?: BackupPlatform
  targetPlatform?: BackupPlatform
  producerRoots?: readonly ManagedRootIdentity[]
  targetRoots?: Record<string, string>
}): ManagedRootRebaseTable {
  const result = prepareManagedRootRebase({
    producerPlatform: overrides.producerPlatform ?? 'darwin',
    targetPlatform: overrides.targetPlatform ?? 'darwin',
    producerRoots: overrides.producerRoots ?? [{ key: NOTES, path: PRODUCER_NOTES }],
    targetRoots: overrides.targetRoots ?? { [NOTES]: TARGET_NOTES }
  })
  if (!result.ok) throw new Error(`expected a prepared table, got ${result.error.code}`)
  return result.table
}

describe('REBASABLE_MANAGED_ROOT_KEYS', () => {
  it('contains only the two roots a DB column stores absolute paths under', () => {
    // Widening this list widens what an archive can redirect, so the set is
    // asserted rather than merely documented.
    expect([...REBASABLE_MANAGED_ROOT_KEYS]).toEqual([NOTES, WORKSPACES])
  })

  it('never admits an external or OS-owned scope', () => {
    for (const key of REBASABLE_MANAGED_ROOT_KEYS) {
      expect(key.startsWith('feature.')).toBe(true)
    }
  })
})

describe('prepareManagedRootRebase', () => {
  it('pairs a declared rebasable root with its trusted target', () => {
    const result = prepareManagedRootRebase({
      producerPlatform: 'darwin',
      targetPlatform: 'darwin',
      producerRoots: [{ key: NOTES, path: PRODUCER_NOTES }],
      targetRoots: { [NOTES]: TARGET_NOTES }
    })
    expect(result.ok).toBe(true)
  })

  it('ignores a producer root this build does not rebase', () => {
    // A newer/older producer may declare roots we know nothing about; paths under
    // them must fall through to `external`, not fail the restore.
    const prepared = table({
      producerRoots: [
        { key: 'external.openclaw.config', path: '/Users/alice/.openclaw' },
        { key: 'feature.files.data', path: '/Users/alice/Data/Files' },
        { key: NOTES, path: PRODUCER_NOTES }
      ]
    })
    expect(classifyManagedPath(prepared, '/Users/alice/.openclaw/config.json')).toEqual({ kind: 'external' })
    expect(classifyManagedPath(prepared, '/Users/alice/Data/Files/blob')).toEqual({ kind: 'external' })
  })

  it.each([
    ['the volume root itself', '/'],
    ['a dot segment', '/Users/alice/../bob/Notes'],
    ['a current-dir segment', '/Users/alice/./Notes'],
    ['a relative path', 'Users/alice/Notes'],
    ['an empty path', '']
  ])('rejects a producer root that is %s', (_label, path) => {
    const result = prepareManagedRootRebase({
      producerPlatform: 'darwin',
      targetPlatform: 'darwin',
      producerRoots: [{ key: NOTES, path }],
      targetRoots: { [NOTES]: TARGET_NOTES }
    })
    expect(result).toEqual({ ok: false, error: { code: 'producer-root-unusable', key: NOTES, path } })
  })

  it('rejects a win32 producer root that is only a drive root', () => {
    const result = prepareManagedRootRebase({
      producerPlatform: 'win32',
      targetPlatform: 'darwin',
      producerRoots: [{ key: NOTES, path: 'C:\\' }],
      targetRoots: { [NOTES]: TARGET_NOTES }
    })
    expect(result.ok).toBe(false)
  })

  it('rejects when the trusted target root for a declared root is missing', () => {
    const result = prepareManagedRootRebase({
      producerPlatform: 'darwin',
      targetPlatform: 'darwin',
      producerRoots: [{ key: NOTES, path: PRODUCER_NOTES }],
      targetRoots: {}
    })
    expect(result).toEqual({ ok: false, error: { code: 'target-root-missing', key: NOTES } })
  })

  it('rejects an unusable trusted target root', () => {
    const result = prepareManagedRootRebase({
      producerPlatform: 'darwin',
      targetPlatform: 'darwin',
      producerRoots: [{ key: NOTES, path: PRODUCER_NOTES }],
      targetRoots: { [NOTES]: '/' }
    })
    expect(result).toEqual({ ok: false, error: { code: 'target-root-unusable', key: NOTES, path: '/' } })
  })

  it('rejects two rebasable roots that declare the same producer path', () => {
    // Longest-match resolution cannot break the tie, so it fails closed rather
    // than picking whichever the manifest happened to list first.
    const result = prepareManagedRootRebase({
      producerPlatform: 'darwin',
      targetPlatform: 'darwin',
      producerRoots: [
        { key: NOTES, path: PRODUCER_NOTES },
        { key: WORKSPACES, path: PRODUCER_NOTES }
      ],
      targetRoots: { [NOTES]: TARGET_NOTES, [WORKSPACES]: '/Users/bob/Agents' }
    })
    expect(result).toEqual({ ok: false, error: { code: 'producer-root-ambiguous', key: NOTES, path: PRODUCER_NOTES } })
  })

  it('detects an ambiguous pair that differs only in case on win32', () => {
    const result = prepareManagedRootRebase({
      producerPlatform: 'win32',
      targetPlatform: 'win32',
      producerRoots: [
        { key: NOTES, path: 'C:\\Data\\Notes' },
        { key: WORKSPACES, path: 'c:\\data\\NOTES' }
      ],
      targetRoots: { [NOTES]: 'D:\\Data\\Notes', [WORKSPACES]: 'D:\\Data\\Agents' }
    })
    expect(result.ok).toBe(false)
  })

  it('keeps a case-differing pair distinct on POSIX', () => {
    const result = prepareManagedRootRebase({
      producerPlatform: 'linux',
      targetPlatform: 'linux',
      producerRoots: [
        { key: NOTES, path: '/data/Notes' },
        { key: WORKSPACES, path: '/data/notes' }
      ],
      targetRoots: { [NOTES]: '/home/bob/Notes', [WORKSPACES]: '/home/bob/Agents' }
    })
    expect(result.ok).toBe(true)
  })
})

describe('classifyManagedPath — rebasing', () => {
  it('rebases a managed path onto the target root (cross-device)', () => {
    expect(classifyManagedPath(table({}), `${PRODUCER_NOTES}/sub/note.md`)).toEqual({
      kind: 'managed',
      rootKey: NOTES,
      suffix: 'sub/note.md',
      rebasedPath: `${TARGET_NOTES}/sub/note.md`
    })
  })

  it('is an identity on the same device', () => {
    const same = table({ targetRoots: { [NOTES]: PRODUCER_NOTES } })
    expect(classifyManagedPath(same, `${PRODUCER_NOTES}/a/b.md`)).toMatchObject({
      kind: 'managed',
      rebasedPath: `${PRODUCER_NOTES}/a/b.md`
    })
  })

  it('rebases the root itself to the target root', () => {
    expect(classifyManagedPath(table({}), PRODUCER_NOTES)).toEqual({
      kind: 'managed',
      rootKey: NOTES,
      suffix: '',
      rebasedPath: TARGET_NOTES
    })
  })

  it('canonicalizes redundant separators instead of propagating them', () => {
    expect(classifyManagedPath(table({}), `${PRODUCER_NOTES}//sub///note.md`)).toMatchObject({
      rebasedPath: `${TARGET_NOTES}/sub/note.md`
    })
  })

  it('picks the LONGEST matching root regardless of manifest order', () => {
    const roots: readonly ManagedRootIdentity[] = [
      { key: NOTES, path: '/p/Data' },
      { key: WORKSPACES, path: '/p/Data/Agents' }
    ]
    const targetRoots = { [NOTES]: '/q/Data', [WORKSPACES]: '/q/Data/Agents' }
    for (const producerRoots of [roots, [...roots].reverse()]) {
      const prepared = table({ producerRoots, targetRoots })
      expect(classifyManagedPath(prepared, '/p/Data/Agents/s1/file.txt')).toMatchObject({
        rootKey: WORKSPACES,
        rebasedPath: '/q/Data/Agents/s1/file.txt'
      })
    }
  })
})

describe('classifyManagedPath — exact boundary matching', () => {
  it('does not treat a sibling with a shared string prefix as contained', () => {
    const prepared = table({
      producerRoots: [{ key: NOTES, path: '/data/root' }],
      targetRoots: { [NOTES]: '/target/root' }
    })
    expect(classifyManagedPath(prepared, '/data/rootExtra/note.md')).toEqual({ kind: 'external' })
    expect(classifyManagedPath(prepared, '/data/root2')).toEqual({ kind: 'external' })
    expect(classifyManagedPath(prepared, '/data/root/note.md')).toMatchObject({ kind: 'managed' })
  })

  it('treats a path above the root as external', () => {
    expect(classifyManagedPath(table({}), '/Users/alice/Library')).toEqual({ kind: 'external' })
  })
})

describe('classifyManagedPath — platform rules', () => {
  it('matches a win32 root case-insensitively, including the drive letter', () => {
    const prepared = table({
      producerPlatform: 'win32',
      producerRoots: [{ key: NOTES, path: 'C:\\Users\\me\\AppData\\Roaming\\CherryStudio\\Data\\Notes' }]
    })
    expect(classifyManagedPath(prepared, 'c:\\users\\ME\\appdata\\roaming\\cherrystudio\\data\\NOTES\\a.md')).toEqual({
      kind: 'managed',
      rootKey: NOTES,
      suffix: 'a.md',
      rebasedPath: `${TARGET_NOTES}/a.md`
    })
  })

  it('accepts forward slashes in a win32 path', () => {
    const prepared = table({ producerPlatform: 'win32', producerRoots: [{ key: NOTES, path: 'C:/Data/Notes' }] })
    expect(classifyManagedPath(prepared, 'C:\\Data\\Notes\\a.md')).toMatchObject({ suffix: 'a.md' })
  })

  it('matches a POSIX root case-SENSITIVELY, downgrading a mismatch to inert', () => {
    // Deliberate: assuming APFS case-insensitivity would let a producer root
    // over-capture. Missing the match only makes the path inert, which is safe.
    expect(classifyManagedPath(table({}), `${PRODUCER_NOTES.toLowerCase()}/a.md`)).toEqual({ kind: 'external' })
  })

  it('rebases a win32 producer path onto a POSIX target', () => {
    const prepared = table({
      producerPlatform: 'win32',
      targetPlatform: 'darwin',
      producerRoots: [{ key: NOTES, path: 'C:\\Data\\Notes' }]
    })
    expect(classifyManagedPath(prepared, 'C:\\Data\\Notes\\sub\\a.md')).toMatchObject({
      rebasedPath: `${TARGET_NOTES}/sub/a.md`
    })
  })

  it('rebases a POSIX producer path onto a win32 target', () => {
    const prepared = table({
      producerPlatform: 'darwin',
      targetPlatform: 'win32',
      targetRoots: { [NOTES]: 'D:\\CherryStudio\\Data\\Notes' }
    })
    expect(classifyManagedPath(prepared, `${PRODUCER_NOTES}/sub/a.md`)).toMatchObject({
      rebasedPath: 'D:\\CherryStudio\\Data\\Notes\\sub\\a.md'
    })
  })

  it('supports a UNC target volume', () => {
    const prepared = table({
      producerPlatform: 'darwin',
      targetPlatform: 'win32',
      targetRoots: { [NOTES]: '\\\\server\\share\\Data\\Notes' }
    })
    expect(classifyManagedPath(prepared, `${PRODUCER_NOTES}/a.md`)).toMatchObject({
      rebasedPath: '\\\\server\\share\\Data\\Notes\\a.md'
    })
  })

  it('treats a UNC candidate outside every root as external, not malformed', () => {
    const prepared = table({ producerPlatform: 'win32', producerRoots: [{ key: NOTES, path: 'C:\\Data\\Notes' }] })
    expect(classifyManagedPath(prepared, '\\\\server\\share\\Notes\\a.md')).toEqual({ kind: 'external' })
  })

  it('does not cross win32 volumes', () => {
    const prepared = table({ producerPlatform: 'win32', producerRoots: [{ key: NOTES, path: 'C:\\Data\\Notes' }] })
    expect(classifyManagedPath(prepared, 'D:\\Data\\Notes\\a.md')).toEqual({ kind: 'external' })
  })
})

describe('classifyManagedPath — malformed and unportable input', () => {
  it.each([
    ['empty', ''],
    ['relative', 'Data/Notes/a.md'],
    ['a bare backslash path', '\\Data\\Notes'],
    ['a drive prefix on POSIX', 'C:\\Data\\Notes\\a.md']
  ])('rejects %s input as not-absolute', (_label, value) => {
    expect(classifyManagedPath(table({}), value)).toEqual({ kind: 'rejected', reason: 'not-absolute' })
  })

  it.each([
    ['drive-relative', 'C:Data\\Notes'],
    ['rooted-relative', '\\Data\\Notes'],
    ['an incomplete UNC', '\\\\server']
  ])('rejects %s win32 input as not-absolute', (_label, value) => {
    const prepared = table({ producerPlatform: 'win32', producerRoots: [{ key: NOTES, path: 'C:\\Data\\Notes' }] })
    expect(classifyManagedPath(prepared, value)).toEqual({ kind: 'rejected', reason: 'not-absolute' })
  })

  it.each([
    ['a parent-dir segment', `${PRODUCER_NOTES}/../../etc/passwd`],
    ['an interior parent-dir segment', `${PRODUCER_NOTES}/sub/../../../root`],
    ['a current-dir segment', `${PRODUCER_NOTES}/./a.md`],
    ['a Windows-reserved device name', `${PRODUCER_NOTES}/CON`],
    ['a Windows-reserved device name with extension', `${PRODUCER_NOTES}/sub/NUL.txt`],
    ['a Windows-reserved character', `${PRODUCER_NOTES}/a:b.md`],
    ['a trailing space segment', `${PRODUCER_NOTES}/trailing /a.md`],
    ['a trailing dot segment', `${PRODUCER_NOTES}/trailing./a.md`]
  ])('fails closed on a suffix with %s', (_label, value) => {
    expect(classifyManagedPath(table({}), value)).toEqual({ kind: 'rejected', reason: 'unportable-suffix' })
  })

  it('fails closed on an over-deep suffix', () => {
    const deep = Array.from({ length: 200 }, (_, i) => `d${i}`).join('/')
    expect(classifyManagedPath(table({}), `${PRODUCER_NOTES}/${deep}`)).toEqual({
      kind: 'rejected',
      reason: 'unportable-suffix'
    })
  })

  it('fails closed on an over-long suffix', () => {
    expect(classifyManagedPath(table({}), `${PRODUCER_NOTES}/${'x'.repeat(2000)}.md`)).toEqual({
      kind: 'rejected',
      reason: 'unportable-suffix'
    })
  })

  it('classifies an unrelated absolute path as inert external', () => {
    expect(classifyManagedPath(table({}), '/etc/passwd')).toEqual({ kind: 'external' })
    expect(classifyManagedPath(table({}), '/Users/alice/Documents/mine.md')).toEqual({ kind: 'external' })
  })

  it('classifies everything as external when no rebasable root was declared', () => {
    const prepared = table({ producerRoots: [], targetRoots: {} })
    expect(classifyManagedPath(prepared, `${PRODUCER_NOTES}/a.md`)).toEqual({ kind: 'external' })
  })
})

describe('isPathContainedIn — the containment proof', () => {
  it('accepts the root itself and its descendants', () => {
    expect(isPathContainedIn('/data/root', '/data/root', 'linux')).toBe(true)
    expect(isPathContainedIn('/data/root', '/data/root/a/b', 'linux')).toBe(true)
  })

  it('rejects a sibling that merely shares a string prefix', () => {
    expect(isPathContainedIn('/data/root', '/data/rootExtra', 'linux')).toBe(false)
    expect(isPathContainedIn('/data/root', '/data/root2/a', 'linux')).toBe(false)
  })

  it('rejects an ancestor, a different subtree, and a volume mismatch', () => {
    expect(isPathContainedIn('/data/root', '/data', 'linux')).toBe(false)
    expect(isPathContainedIn('/data/root', '/other/root/a', 'linux')).toBe(false)
    expect(isPathContainedIn('C:\\data', 'D:\\data\\a', 'win32')).toBe(false)
  })

  it('rejects a candidate carrying dot segments even when it would prefix-match', () => {
    expect(isPathContainedIn('/data/root', '/data/root/../../etc', 'linux')).toBe(false)
    expect(isPathContainedIn('/data/root', '/data/root/./a', 'linux')).toBe(false)
  })

  it('rejects an unusable root', () => {
    expect(isPathContainedIn('/', '/anything', 'linux')).toBe(false)
    expect(isPathContainedIn('relative', 'relative/a', 'linux')).toBe(false)
    expect(isPathContainedIn('/data/../root', '/data/../root/a', 'linux')).toBe(false)
  })

  it('folds case on win32 only', () => {
    expect(isPathContainedIn('C:\\Data', 'c:\\data\\A', 'win32')).toBe(true)
    expect(isPathContainedIn('/Data', '/data/a', 'linux')).toBe(false)
  })

  it('holds for every rebased path the classifier returns', () => {
    const prepared = table({})
    for (const suffix of ['a.md', 'sub/a.md', 'deep/deeper/deepest/a.md', '']) {
      const result = classifyManagedPath(prepared, suffix ? `${PRODUCER_NOTES}/${suffix}` : PRODUCER_NOTES)
      expect(result.kind).toBe('managed')
      if (result.kind !== 'managed') continue
      expect(isPathContainedIn(TARGET_NOTES, result.rebasedPath, 'darwin')).toBe(true)
    }
  })
})
