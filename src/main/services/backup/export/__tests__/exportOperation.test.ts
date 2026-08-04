import { mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createExportOperation, sweepStaleExportOperations } from '../exportOperation'

describe('backup export operation ownership', () => {
  let root: string
  let stagingParent: string
  let destinationParent: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'backup-export-operation-'))
    stagingParent = path.join(root, 'staging')
    destinationParent = path.join(root, 'destination')
    await Promise.all([mkdir(stagingParent), mkdir(destinationParent)])
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('removes its private staging after an ordinary pre-commit failure', async () => {
    const outPath = path.join(destinationParent, 'backup.cherrybackup')
    const operation = await createExportOperation(stagingParent, outPath)

    await expect(operation.cleanup()).resolves.toBe(true)
    await expect(readdir(stagingParent)).resolves.toEqual([])
  })

  it('recovers matching destination temp debt without touching the committed archive', async () => {
    const outPath = path.join(destinationParent, 'backup.cherrybackup')
    await writeFile(outPath, 'committed archive', { flag: 'wx' })
    const operation = await createExportOperation(stagingParent, outPath)
    const tempDir = path.join(destinationParent, '.cherrybackup-tmp-owned')
    await mkdir(tempDir)
    await operation.publishObserver.onTempCreated(tempDir)

    await expect(operation.cleanup()).resolves.toBe(false)
    await expect(sweepStaleExportOperations(stagingParent)).resolves.toBe(1)

    await expect(readFile(outPath, 'utf8')).resolves.toBe('committed archive')
    await expect(readdir(stagingParent)).resolves.toEqual([])
    await expect(readdir(destinationParent)).resolves.toEqual(['backup.cherrybackup'])
  })

  it('discovers a destination marker when a crash preceded the staging-marker update', async () => {
    const outPath = path.join(destinationParent, 'backup.cherrybackup')
    const operation = await createExportOperation(stagingParent, outPath)
    const tempDir = path.join(destinationParent, '.cherrybackup-tmp-handshake')
    await mkdir(tempDir)
    await operation.publishObserver.onTempCreated(tempDir)

    const [stagingName] = await readdir(stagingParent)
    const stagingMarkerPath = path.join(stagingParent, stagingName, '.backup-export-owner.json')
    const stagingMarker = JSON.parse(await readFile(stagingMarkerPath, 'utf8')) as Record<string, unknown>
    delete stagingMarker.publishTemp
    await writeFile(stagingMarkerPath, `${JSON.stringify(stagingMarker)}\n`)

    await expect(sweepStaleExportOperations(stagingParent)).resolves.toBe(1)
    await expect(readdir(stagingParent)).resolves.toEqual([])
    await expect(readdir(destinationParent)).resolves.toEqual([])
  })

  it('preserves a destination temp whose inode no longer matches the recorded owner', async () => {
    const outPath = path.join(destinationParent, 'backup.cherrybackup')
    const operation = await createExportOperation(stagingParent, outPath)
    const tempDir = path.join(destinationParent, '.cherrybackup-tmp-replaced')
    await mkdir(tempDir)
    await operation.publishObserver.onTempCreated(tempDir)

    const displaced = path.join(destinationParent, 'original-temp')
    await rename(tempDir, displaced)
    await mkdir(tempDir)

    await expect(sweepStaleExportOperations(stagingParent)).resolves.toBe(0)
    await expect(readdir(stagingParent)).resolves.toHaveLength(1)
    await expect(readdir(destinationParent)).resolves.toEqual(
      expect.arrayContaining(['.cherrybackup-tmp-replaced', 'original-temp'])
    )
  })

  it('ignores unmarked and symlinked export-looking paths', async () => {
    const foreign = path.join(stagingParent, 'export-foreign')
    const link = path.join(stagingParent, 'export-link')
    await mkdir(foreign)
    await writeFile(path.join(foreign, 'keep.txt'), 'foreign')
    await symlink(foreign, link)

    await expect(sweepStaleExportOperations(stagingParent)).resolves.toBe(0)
    await expect(readFile(path.join(foreign, 'keep.txt'), 'utf8')).resolves.toBe('foreign')
  })
})
