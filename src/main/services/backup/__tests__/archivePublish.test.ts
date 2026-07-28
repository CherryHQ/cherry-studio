import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { publishArchive, publishArchiveWithCeilings, publishSeams } from '../archivePublish'
import { HardLinkUnsupportedError, OutputPathExistsError } from '../errors'
import { sha256File } from '../hashing'
import type { BackupManifest } from '../manifest'

const chain = [{ folderMillis: 1, hash: 'migration' }]
let work: string
let dbPath: string
let manifest: BackupManifest

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'backup-publish-'))
  dbPath = path.join(work, 'db.sqlite')
  await writeFile(dbPath, 'portable database')
  manifest = {
    backupFormatVersion: 2,
    preset: 'lite',
    createdAt: '2026-07-28T00:00:00.000Z',
    producer: { platform: 'darwin', managedRoots: [] },
    migrationChain: chain,
    db: { hash: await sha256File(dbPath), sizeBytes: statSync(dbPath).size }
  }
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(work, { recursive: true, force: true })
})

describe('publishArchive', () => {
  it('publishes an owner-only archive with exactly manifest and database entries', async () => {
    const outPath = path.join(work, 'backup.cherrybackup')
    await publishArchive({ outPath, manifest, dbCopyPath: dbPath })
    expect(statSync(outPath).mode & 0o777).toBe(0o600)
    const zip = new StreamZip.async({ file: outPath })
    try {
      expect(Object.keys(await zip.entries()).sort()).toEqual(['backup.sqlite', 'manifest.json'])
    } finally {
      await zip.close()
    }
  })

  it('never overwrites a pre-existing destination', async () => {
    const outPath = path.join(work, 'backup.cherrybackup')
    await writeFile(outPath, 'existing')
    await expect(publishArchive({ outPath, manifest, dbCopyPath: dbPath })).rejects.toBeInstanceOf(
      OutputPathExistsError
    )
    expect(readFileSync(outPath, 'utf8')).toBe('existing')
  })

  it('fails closed when atomic hard-link publication is unavailable', async () => {
    vi.spyOn(publishSeams, 'hardLink').mockRejectedValue(Object.assign(new Error('no links'), { code: 'EXDEV' }))
    const outPath = path.join(work, 'backup.cherrybackup')
    await expect(publishArchive({ outPath, manifest, dbCopyPath: dbPath })).rejects.toBeInstanceOf(
      HardLinkUnsupportedError
    )
    expect(existsSync(outPath)).toBe(false)
  })

  it('enforces the DB and aggregate byte ceilings before creating output', async () => {
    const outPath = path.join(work, 'backup.cherrybackup')
    await expect(
      publishArchiveWithCeilings(
        { outPath, manifest, dbCopyPath: dbPath },
        { maxArchiveEntries: 2, maxEntryUncompressedBytes: 1, maxTotalUncompressedBytes: 1000, maxManifestBytes: 1000 }
      )
    ).rejects.toMatchObject({ name: 'CeilingExceededError' })
    expect(existsSync(outPath)).toBe(false)
  })
})
