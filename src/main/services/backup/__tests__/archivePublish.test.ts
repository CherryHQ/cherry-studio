import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ProducerCeilings, publishArchive, publishArchiveWithCeilings, publishSeams } from '../archivePublish'
import {
  BackupCancelledError,
  CeilingExceededError,
  DiskFullError,
  HardLinkUnsupportedError,
  ManifestPayloadMismatchError,
  NonRegularSourceError,
  OutputPathExistsError
} from '../errors'
import { durability } from '../fsyncBatch'
import { hashStreamHooks } from '../hashing'
import type { BackupManifest } from '../manifest'
import { BackupManifestSchema } from '../manifest'

const BASE_CEILINGS: ProducerCeilings = {
  maxArchiveEntries: 100_000,
  maxEntryUncompressedBytes: 8 * 1024 ** 3,
  maxTotalUncompressedBytes: 32 * 1024 ** 3,
  maxManifestBytes: 1 * 1024 ** 2,
  maxPathDepth: 64,
  maxPathLength: 1024
}

const DB_CONTENT = 'DBDAT'
const DB_SIZE = DB_CONTENT.length
const DB_HASH = createHash('sha256').update(DB_CONTENT).digest('hex')

let dir: string
let dbCopyPath: string
let resourcesDir: string
let outPath: string

function liteManifest(): BackupManifest {
  return {
    backupFormatVersion: 2,
    createdAt: '2026-07-27T00:00:00.000Z',
    producer: { appVersion: '2.0.0', platform: 'darwin', managedRoots: [] },
    migrationChain: [{ folderMillis: 1_700_000_000_000, hash: 'a' }],
    db: { hash: DB_HASH, sizeBytes: DB_SIZE },
    resourceRequirements: [],
    degradations: [],
    preset: 'lite'
  }
}

function fullManifest(withPayload: boolean): BackupManifest {
  const base = liteManifest()
  return {
    ...base,
    preset: 'full',
    resourcePayloads: withPayload
      ? [
          {
            kind: 'file-blob',
            resourceType: 'file',
            archivePath: 'resources/blob.bin',
            livePath: 'Data/Files/blob.bin',
            hash: 'b'.repeat(64),
            sizeBytes: 3
          }
        ]
      : []
  }
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bk-pub-'))
  dbCopyPath = path.join(dir, 'backup-src.sqlite')
  await writeFile(dbCopyPath, DB_CONTENT)
  resourcesDir = path.join(dir, 'resources-src')
  await mkdir(resourcesDir, { recursive: true })
  await writeFile(path.join(resourcesDir, 'blob.bin'), 'RES')
  outPath = path.join(dir, 'out.cherrybackup')
})
afterEach(async () => {
  vi.restoreAllMocks()
  hashStreamHooks.onChunk = () => {}
  await rm(dir, { recursive: true, force: true })
})

async function ownedTempRemains(): Promise<boolean> {
  const names = await readdir(dir)
  return names.some((n) => n.startsWith('.cherrybackup-tmp-'))
}

describe('publishArchive — valid publication', () => {
  it('writes an owner-only (0600) archive containing manifest + db + resources', async () => {
    await publishArchive({ outPath, manifest: fullManifest(true), dbCopyPath, resourcesDir })

    expect((await stat(outPath)).mode & 0o777).toBe(0o600)
    const zip = new StreamZip.async({ file: outPath })
    try {
      expect(Object.keys(await zip.entries()).sort()).toEqual(['backup.sqlite', 'manifest.json', 'resources/blob.bin'])
      const parsed = BackupManifestSchema.safeParse(JSON.parse((await zip.entryData('manifest.json')).toString('utf8')))
      expect(parsed.success).toBe(true)
      expect((await zip.entryData('backup.sqlite')).toString('utf8')).toBe(DB_CONTENT)
    } finally {
      await zip.close()
    }
    expect(await ownedTempRemains()).toBe(false)
  })

  it('publishes a lite archive with no resources dir', async () => {
    await publishArchive({ outPath, manifest: liteManifest(), dbCopyPath })
    const zip = new StreamZip.async({ file: outPath })
    try {
      expect(Object.keys(await zip.entries()).sort()).toEqual(['backup.sqlite', 'manifest.json'])
    } finally {
      await zip.close()
    }
  })

  it('leaves foreign files in the destination directory untouched', async () => {
    await writeFile(path.join(dir, 'unrelated.txt'), 'KEEP')
    await writeFile(path.join(dir, '.out.cherrybackup.deadbeef.tmp'), 'FOREIGN-LOOKS-LIKE-TEMP')
    await publishArchive({ outPath, manifest: liteManifest(), dbCopyPath })
    expect(await readFile(path.join(dir, 'unrelated.txt'), 'utf8')).toBe('KEEP')
    expect(await readFile(path.join(dir, '.out.cherrybackup.deadbeef.tmp'), 'utf8')).toBe('FOREIGN-LOOKS-LIKE-TEMP')
  })
})

describe('publishArchive — DB payload verification', () => {
  it('rejects when the DB size does not match the manifest', async () => {
    const m = liteManifest()
    m.db.sizeBytes = 999
    await expect(publishArchive({ outPath, manifest: m, dbCopyPath })).rejects.toBeInstanceOf(
      ManifestPayloadMismatchError
    )
    expect(existsSync(outPath)).toBe(false)
  })

  it('rejects when the DB SHA-256 does not match the manifest', async () => {
    const m = liteManifest()
    m.db.hash = 'a'.repeat(64)
    await expect(publishArchive({ outPath, manifest: m, dbCopyPath })).rejects.toBeInstanceOf(
      ManifestPayloadMismatchError
    )
    expect(existsSync(outPath)).toBe(false)
  })

  it('rejects when dbCopyPath is not a regular file', async () => {
    const asDir = path.join(dir, 'notafile')
    await mkdir(asDir)
    await expect(publishArchive({ outPath, manifest: liteManifest(), dbCopyPath: asDir })).rejects.toBeInstanceOf(
      ManifestPayloadMismatchError
    )
  })
})

describe('publishArchive — resource-presence shape', () => {
  it('rejects a Lite manifest paired with a resources dir', async () => {
    await expect(publishArchive({ outPath, manifest: liteManifest(), dbCopyPath, resourcesDir })).rejects.toThrow(
      /Lite archive/
    )
    expect(existsSync(outPath)).toBe(false)
  })

  it('rejects Full with declared payloads but no resources dir', async () => {
    await expect(publishArchive({ outPath, manifest: fullManifest(true), dbCopyPath })).rejects.toThrow(
      /resource-presence mismatch/
    )
  })

  it('rejects Full with a resources dir but an empty payload inventory', async () => {
    await expect(publishArchive({ outPath, manifest: fullManifest(false), dbCopyPath, resourcesDir })).rejects.toThrow(
      /resource-presence mismatch/
    )
  })

  it('accepts Full with an empty inventory and no resources dir', async () => {
    await publishArchive({ outPath, manifest: fullManifest(false), dbCopyPath })
    expect(existsSync(outPath)).toBe(true)
  })
})

describe('publishArchive — manifest contract', () => {
  it('rejects a structurally invalid manifest before touching the filesystem', async () => {
    const bad = { ...liteManifest(), backupFormatVersion: 1 } as unknown as BackupManifest
    await expect(publishArchive({ outPath, manifest: bad, dbCopyPath })).rejects.toThrow(/strict validation/)
    expect(existsSync(outPath)).toBe(false)
  })

  it('enforces the maxManifestBytes pre-parse cap (serialized once)', async () => {
    const huge = liteManifest()
    huge.degradations = [{ kind: 'k', reason: 'x'.repeat(1_200_000) }]
    await expect(publishArchive({ outPath, manifest: huge, dbCopyPath })).rejects.toBeInstanceOf(CeilingExceededError)
    expect(existsSync(outPath)).toBe(false)
  })
})

describe('publishArchive — no-clobber', () => {
  it('never overwrites a pre-existing destination and leaves it byte-for-byte intact', async () => {
    await writeFile(outPath, 'PRIOR-GOOD-BACKUP')
    await expect(publishArchive({ outPath, manifest: liteManifest(), dbCopyPath })).rejects.toBeInstanceOf(
      OutputPathExistsError
    )
    expect(await readFile(outPath, 'utf8')).toBe('PRIOR-GOOD-BACKUP')
    expect(await ownedTempRemains()).toBe(false)
  })

  it('maps a publish-time EEXIST (link) to OutputPathExistsError', async () => {
    vi.spyOn(publishSeams, 'hardLink').mockRejectedValue(Object.assign(new Error('exists'), { code: 'EEXIST' }))
    await expect(publishArchive({ outPath, manifest: liteManifest(), dbCopyPath })).rejects.toBeInstanceOf(
      OutputPathExistsError
    )
    expect(existsSync(outPath)).toBe(false)
    expect(await ownedTempRemains()).toBe(false)
  })
})

describe('publishArchive — atomic contract (no copy fallback)', () => {
  it('fails closed with HardLinkUnsupportedError when the volume cannot hard-link (no partial output)', async () => {
    for (const code of ['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV']) {
      vi.spyOn(publishSeams, 'hardLink').mockRejectedValue(Object.assign(new Error('nope'), { code }))
      await expect(publishArchive({ outPath, manifest: liteManifest(), dbCopyPath })).rejects.toBeInstanceOf(
        HardLinkUnsupportedError
      )
      expect(existsSync(outPath)).toBe(false)
      expect(await ownedTempRemains()).toBe(false)
      vi.restoreAllMocks()
    }
  })
})

describe('publishArchive — cancellation & failure cleanup', () => {
  it('honors a pre-aborted signal and leaves no output or temp', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(
      publishArchive({ outPath, manifest: liteManifest(), dbCopyPath, signal: ac.signal })
    ).rejects.toBeInstanceOf(BackupCancelledError)
    expect(existsSync(outPath)).toBe(false)
    expect(await ownedTempRemains()).toBe(false)
  })

  it('re-checks cancellation immediately before the commit point', async () => {
    const ac = new AbortController()
    vi.spyOn(durability, 'fsyncFile').mockImplementation(async () => {
      ac.abort()
    })
    await expect(
      publishArchive({ outPath, manifest: liteManifest(), dbCopyPath, signal: ac.signal })
    ).rejects.toBeInstanceOf(BackupCancelledError)
    expect(existsSync(outPath)).toBe(false)
    expect(await ownedTempRemains()).toBe(false)
  })

  it('maps a mid-publish ENOSPC to DiskFullError and cleans temp', async () => {
    vi.spyOn(publishSeams, 'hardLink').mockRejectedValue(Object.assign(new Error('no space'), { code: 'ENOSPC' }))
    await expect(publishArchive({ outPath, manifest: liteManifest(), dbCopyPath })).rejects.toBeInstanceOf(
      DiskFullError
    )
    expect(existsSync(outPath)).toBe(false)
    expect(await ownedTempRemains()).toBe(false)
  })
})

describe('publishArchive — untrusted staged resource tree is scanned', () => {
  async function expectFailBeforeAnyWrite(promise: Promise<unknown>): Promise<void> {
    await expect(promise).rejects.toThrow()
    expect(existsSync(outPath)).toBe(false)
    expect(await ownedTempRemains()).toBe(false)
    expect(await readFile(dbCopyPath, 'utf8')).toBe(DB_CONTENT) // foreign DB source untouched
  }

  it('rejects a SYMLINKED resources root before any temp/output', async () => {
    const realTree = path.join(dir, 'real-tree')
    await mkdir(realTree, { recursive: true })
    await writeFile(path.join(realTree, 'blob.bin'), 'RES')
    const linkTree = path.join(dir, 'link-tree')
    await symlink(realTree, linkTree)
    await expectFailBeforeAnyWrite(
      publishArchive({ outPath, manifest: fullManifest(true), dbCopyPath, resourcesDir: linkTree })
    )
  })

  it('rejects a symlink NESTED inside the resources tree', async () => {
    await symlink(dbCopyPath, path.join(resourcesDir, 'evil-link')) // points outside the tree
    await expect(
      publishArchive({ outPath, manifest: fullManifest(true), dbCopyPath, resourcesDir })
    ).rejects.toBeInstanceOf(NonRegularSourceError)
    expect(existsSync(outPath)).toBe(false)
    expect(await ownedTempRemains()).toBe(false)
  })

  it('rejects an unportable (Windows-reserved) name in the resources tree', async () => {
    await writeFile(path.join(resourcesDir, 'con'), 'x')
    await expect(publishArchive({ outPath, manifest: fullManifest(true), dbCopyPath, resourcesDir })).rejects.toThrow(
      /not portable/
    )
    expect(existsSync(outPath)).toBe(false)
  })
})

describe('publishArchive — archive-wide ceilings', () => {
  it('rejects the DB against the per-entry byte ceiling', async () => {
    const ceilings = { ...BASE_CEILINGS, maxEntryUncompressedBytes: DB_SIZE - 1 }
    await expect(
      publishArchiveWithCeilings({ outPath, manifest: liteManifest(), dbCopyPath }, ceilings)
    ).rejects.toBeInstanceOf(CeilingExceededError)
    expect(existsSync(outPath)).toBe(false)
    expect(await ownedTempRemains()).toBe(false)
  })

  it('reserves the 2 fixed entries when applying maxArchiveEntries (over rejects, exact-at passes)', async () => {
    // resourcesDir has 1 file (blob.bin). Over: max=2 → resource budget 0 → reject.
    await expect(
      publishArchiveWithCeilings(
        { outPath, manifest: fullManifest(true), dbCopyPath, resourcesDir },
        { ...BASE_CEILINGS, maxArchiveEntries: 2 }
      )
    ).rejects.toBeInstanceOf(CeilingExceededError)
    expect(existsSync(outPath)).toBe(false)

    // Exact-at: max=3 → budget 1 → the single resource entry fits (1 + 2 fixed = 3).
    await publishArchiveWithCeilings(
      { outPath, manifest: fullManifest(true), dbCopyPath, resourcesDir },
      { ...BASE_CEILINGS, maxArchiveEntries: 3 }
    )
    expect(existsSync(outPath)).toBe(true)
  })

  it('rejects when manifest + db + aggregate resource bytes exceed maxTotalUncompressedBytes', async () => {
    // The manifest alone is hundreds of bytes; a 10-byte total budget is exceeded.
    await expect(
      publishArchiveWithCeilings(
        { outPath, manifest: fullManifest(true), dbCopyPath, resourcesDir },
        { ...BASE_CEILINGS, maxTotalUncompressedBytes: 10 }
      )
    ).rejects.toBeInstanceOf(CeilingExceededError)
    expect(existsSync(outPath)).toBe(false)
    expect(await ownedTempRemains()).toBe(false)
  })
})

describe('publishArchive — cancellable DB verification', () => {
  it('aborts mid-hash of a large DB before any temp/output (per-chunk check)', async () => {
    const big = 'q'.repeat(512 * 1024) // multiple 64 KiB chunks
    await writeFile(dbCopyPath, big)
    const m = liteManifest()
    m.db.sizeBytes = big.length // size check passes; the hash is cancelled before it is compared
    const ac = new AbortController()
    let chunks = 0
    hashStreamHooks.onChunk = () => {
      chunks++
      if (chunks === 1) ac.abort()
    }
    await expect(publishArchive({ outPath, manifest: m, dbCopyPath, signal: ac.signal })).rejects.toBeInstanceOf(
      BackupCancelledError
    )
    expect(chunks).toBeGreaterThanOrEqual(1)
    expect(existsSync(outPath)).toBe(false)
    expect(await ownedTempRemains()).toBe(false)
  })
})
