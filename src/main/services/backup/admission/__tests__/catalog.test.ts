import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AdmissionRejectReason } from '../../errors'
import { type CatalogCeilings, openArchive, validateArchiveShape } from '../catalog'
import { type RawEntrySpec, writeRawZip } from './helpers'

const CEIL: CatalogCeilings = {
  maxArchiveEntries: 20,
  maxEntryUncompressedBytes: 1024,
  maxTotalUncompressedBytes: 4096,
  maxCompressionRatio: 100,
  maxManifestBytes: 512,
  maxPathDepth: 8,
  maxPathLength: 128
}

const MANIFEST: RawEntrySpec = { name: 'manifest.json', data: Buffer.from('{}') }
const DB: RawEntrySpec = { name: 'backup.sqlite', data: Buffer.from('sqlite-bytes') }

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bk-cat-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function reasonOf(
  specs: readonly RawEntrySpec[],
  ceil: CatalogCeilings = CEIL
): Promise<AdmissionRejectReason | 'OK'> {
  const zipPath = path.join(dir, 'a.zip')
  await writeRawZip(zipPath, specs)
  const open = await openArchive(zipPath)
  try {
    validateArchiveShape(open.entries, ceil)
    return 'OK'
  } catch (err) {
    return (err as { reason: AdmissionRejectReason }).reason
  } finally {
    await open.close()
  }
}

describe('validateArchiveShape — valid layouts', () => {
  it('accepts the minimal manifest + db layout', async () => {
    expect(await reasonOf([MANIFEST, DB])).toBe('OK')
  })

  it('classifies resource files and directories under resources/', async () => {
    const zipPath = path.join(dir, 'a.zip')
    await writeRawZip(zipPath, [
      MANIFEST,
      DB,
      { name: 'resources/blob.bin', data: Buffer.from('B') },
      { name: 'resources/kb/' },
      { name: 'resources/kb/a.txt', data: Buffer.from('A') }
    ])
    const open = await openArchive(zipPath)
    try {
      const shape = validateArchiveShape(open.entries, CEIL)
      expect(shape.resourceFiles.map((e) => e.path).sort()).toEqual(['resources/blob.bin', 'resources/kb/a.txt'])
      expect(shape.resourceDirs.map((e) => e.path)).toEqual(['resources/kb'])
    } finally {
      await open.close()
    }
  })
})

describe('validateArchiveShape — hostile names', () => {
  const cases: Array<[string, string]> = [
    ['backslash', 'a\\b'],
    ['absolute', '/etc/passwd'],
    ['drive letter', 'C:/x'],
    ['parent traversal', '../x'],
    ['current-dir segment', 'a/./b'],
    ['empty segment', 'a//b'],
    ['control char', 'ab'],
    ['windows-reserved name', 'resources/con']
  ]
  it.each(cases)('rejects %s as entry-name', async (_label, name) => {
    expect(await reasonOf([MANIFEST, DB, { name, data: Buffer.from('x') }])).toBe('entry-name')
  })
})

describe('validateArchiveShape — collisions', () => {
  it('rejects a duplicate entry name', async () => {
    expect(await reasonOf([MANIFEST, MANIFEST, DB])).toBe('entry-collision')
  })
  it('rejects a case-only collision', async () => {
    expect(
      await reasonOf([
        MANIFEST,
        DB,
        { name: 'resources/A.bin', data: Buffer.from('1') },
        { name: 'resources/a.bin', data: Buffer.from('2') }
      ])
    ).toBe('entry-collision')
  })
  it('rejects an NFC/NFD collision', async () => {
    expect(
      await reasonOf([
        MANIFEST,
        DB,
        { name: 'resources/café.txt', data: Buffer.from('1') }, // NFC é
        { name: 'resources/café.txt', data: Buffer.from('2') } // NFD e + combining accent
      ])
    ).toBe('entry-collision')
  })
  it('rejects a directory entry aliasing a file', async () => {
    expect(
      await reasonOf([MANIFEST, DB, { name: 'resources/x', data: Buffer.from('f') }, { name: 'resources/x/' }])
    ).toBe('entry-collision')
  })
})

describe('validateArchiveShape — symlink / special / encrypted metadata', () => {
  it('rejects a symlink entry (S_IFLNK)', async () => {
    expect(await reasonOf([MANIFEST, DB, { name: 'resources/link', data: Buffer.from('t'), unixMode: 0o120777 }])).toBe(
      'entry-special'
    )
  })
  it('rejects a special-file entry (S_IFIFO)', async () => {
    expect(await reasonOf([MANIFEST, DB, { name: 'resources/fifo', unixMode: 0o010644 }])).toBe('entry-special')
  })
  it('rejects an encrypted entry', async () => {
    expect(await reasonOf([MANIFEST, DB, { name: 'resources/enc', data: Buffer.from('t'), flags: 1 }])).toBe(
      'entry-special'
    )
  })
})

describe('validateArchiveShape — ceilings', () => {
  it('rejects too many entries', async () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ name: `resources/f${i}`, data: Buffer.from('x') }))
    expect(await reasonOf([MANIFEST, DB, ...many], { ...CEIL, maxArchiveEntries: 3 })).toBe('ceiling-entries')
  })
  it('rejects a per-entry byte overflow', async () => {
    expect(
      await reasonOf([
        MANIFEST,
        DB,
        { name: 'resources/big', centralUncompressedSize: 2000, centralCompressedSize: 2000 }
      ])
    ).toBe('ceiling-entry-bytes')
  })
  it('rejects an aggregate byte overflow', async () => {
    expect(
      await reasonOf(
        [
          MANIFEST,
          DB,
          { name: 'resources/a', centralUncompressedSize: 1000, centralCompressedSize: 1000 },
          { name: 'resources/b', centralUncompressedSize: 1000, centralCompressedSize: 1000 }
        ],
        { ...CEIL, maxTotalUncompressedBytes: 1500 }
      )
    ).toBe('ceiling-total-bytes')
  })
  it('rejects an over-ratio entry', async () => {
    expect(
      await reasonOf([MANIFEST, DB, { name: 'resources/z', centralUncompressedSize: 1000, centralCompressedSize: 1 }])
    ).toBe('ceiling-ratio')
  })
  it('rejects a zero-compressed positive entry (infinite ratio)', async () => {
    expect(
      await reasonOf([MANIFEST, DB, { name: 'resources/z', centralUncompressedSize: 1000, centralCompressedSize: 0 }])
    ).toBe('ceiling-ratio')
  })
  it('rejects a manifest larger than the pre-parse cap', async () => {
    expect(
      await reasonOf([{ name: 'manifest.json', centralUncompressedSize: 1000, centralCompressedSize: 1000 }, DB])
    ).toBe('ceiling-manifest-bytes')
  })
  it('accepts a compression ratio exactly at the ceiling (bigint boundary)', async () => {
    // CEIL.maxCompressionRatio === 100; 1000 / 10 === 100 exactly → accepted.
    expect(
      await reasonOf([MANIFEST, DB, { name: 'resources/r', centralUncompressedSize: 1000, centralCompressedSize: 10 }])
    ).toBe('OK')
  })
  it('rejects a compression ratio one over the ceiling (bigint boundary)', async () => {
    expect(
      await reasonOf([MANIFEST, DB, { name: 'resources/r', centralUncompressedSize: 1001, centralCompressedSize: 10 }])
    ).toBe('ceiling-ratio')
  })
})

describe('validateArchiveShape — hardening', () => {
  it('rejects a directory entry that declares nonzero bytes', async () => {
    expect(
      await reasonOf([MANIFEST, DB, { name: 'resources/d/', centralUncompressedSize: 10, centralCompressedSize: 10 }])
    ).toBe('entry-metadata')
  })
  it('rejects a file entry carrying directory unix mode', async () => {
    expect(await reasonOf([MANIFEST, DB, { name: 'resources/f', data: Buffer.from('x'), unixMode: 0o040755 }])).toBe(
      'entry-special'
    )
  })
  it('rejects a directory entry carrying regular-file unix mode', async () => {
    expect(await reasonOf([MANIFEST, DB, { name: 'resources/d/', unixMode: 0o100644 }])).toBe('entry-special')
  })
  it('rejects a file entry that is an ancestor of another entry', async () => {
    expect(
      await reasonOf([
        MANIFEST,
        DB,
        { name: 'resources/a', data: Buffer.from('f') },
        { name: 'resources/a/b', data: Buffer.from('g') }
      ])
    ).toBe('entry-collision')
  })
  it('rejects a non-positive ceiling as a contract error (not an archive rejection)', async () => {
    const open = await openArchive(await writeZip([MANIFEST, DB]))
    try {
      expect(() => validateArchiveShape(open.entries, { ...CEIL, maxCompressionRatio: 0 })).toThrow(RangeError)
    } finally {
      await open.close()
    }
  })
  it('neutralizes control/C1/bidi/separator characters and truncates a huge untrusted name', async () => {
    // C0 (SOH) forces the entry-name rejection; C1 (NEL), a bidi override (RLO),
    // and a line separator must also be neutralized in the rendered detail.
    const unsafe = [0x01, 0x85, 0x202e, 0x2028]
    const control = String.fromCodePoint(...unsafe)
    const hostile = `resources/bad${control}${'A'.repeat(150)}` // unsafe chars + oversized name
    const zipPath = path.join(dir, 'h.zip')
    await writeRawZip(zipPath, [MANIFEST, DB, { name: hostile, data: Buffer.from('x') }])
    const open = await openArchive(zipPath)
    try {
      validateArchiveShape(open.entries, CEIL)
      throw new Error('expected rejection')
    } catch (err) {
      const detail = (err as { detail: string }).detail
      for (const code of unsafe) expect(detail).not.toContain(String.fromCodePoint(code))
      expect(detail.length).toBeLessThan(200)
    } finally {
      await open.close()
    }
  })
})

async function writeZip(specs: readonly RawEntrySpec[]): Promise<string> {
  const zipPath = path.join(dir, `z-${specs.length}.zip`)
  await writeRawZip(zipPath, specs)
  return zipPath
}

describe('validateArchiveShape — layout', () => {
  it('rejects a missing manifest', async () => {
    expect(await reasonOf([DB])).toBe('layout')
  })
  it('rejects a missing db', async () => {
    expect(await reasonOf([MANIFEST])).toBe('layout')
  })
  it('rejects a misplaced root file', async () => {
    expect(await reasonOf([MANIFEST, DB, { name: 'extra.txt', data: Buffer.from('x') }])).toBe('layout')
  })
  it('rejects an undeclared top-level directory', async () => {
    expect(await reasonOf([MANIFEST, DB, { name: 'junk/' }])).toBe('layout')
  })
})

describe('openArchive — handle robustness', () => {
  it('ignores a post-ready error event and stays closeable and idempotent', async () => {
    const open = await openArchive(await writeZip([MANIFEST, DB]))
    // A late library error (after ready) must not close the handle nor throw.
    ;(open.zip as unknown as NodeJS.EventEmitter).emit('error', new Error('late library error'))
    expect(open.entries.length).toBe(2)
    await open.close()
    await open.close() // idempotent — a second close is a genuine no-op
  })
})
