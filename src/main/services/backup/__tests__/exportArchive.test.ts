import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { snapshotTo } from '@data/db/restore/snapshot'
import { fileEntryTable } from '@data/db/schemas/file'
import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { admitArchive } from '../admission/admitArchive'
import { exportArchive } from '../exportArchive'

const migrationsFolder = resolveMigrationsPath()

describe('exportArchive', () => {
  const dbh = setupTestDatabase()
  let work: string
  let userData: string

  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'backup-export-'))
    userData = path.join(work, 'userData')
    mkdirSync(path.join(userData, 'backup-temp'), { recursive: true })
    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      switch (key) {
        case 'app.database.file':
          return dbh.sqlite.name
        case 'feature.backup.temp':
          return path.join(userData, 'backup-temp')
        case 'feature.notes.data':
          return path.join(userData, 'Data', 'Notes')
        case 'feature.agents.system_workspaces':
          return path.join(userData, 'Data', 'Agents', 'system')
        default:
          throw new Error(`unexpected path key: ${key}`)
      }
    })
    ;(application.get('DbService').createSnapshot as unknown as Mock).mockImplementation((target: string) => {
      snapshotTo(dbh.sqlite, target)
    })
  })

  afterEach(() => {
    ;(application.get('DbService').createSnapshot as unknown as Mock).mockReset()
    vi.restoreAllMocks()
    rmSync(work, { recursive: true, force: true })
  })

  it('exports a portable Lite database that hostile admission accepts', async () => {
    const outPath = path.join(work, 'backup.cherrybackup')
    const result = await exportArchive({ outPath })
    expect(result.manifest.preset).toBe('lite')
    const admitted = await admitArchive({
      archivePath: outPath,
      stagingParent: path.join(userData, 'backup-temp'),
      migrationsFolder
    })
    await admitted.cleanup()
  })

  it('persists external-file sanitation as a closed aggregate through archive admission', async () => {
    dbh.db
      .insert(fileEntryTable)
      .values({
        id: '11111111-2222-4333-8444-555555555555',
        origin: 'external',
        name: 'private',
        ext: 'txt',
        size: null,
        externalPath: '/source/private/sentinel.txt'
      })
      .run()

    const outPath = path.join(work, 'degraded.cherrybackup')
    const exported = await exportArchive({ outPath })
    const admitted = await admitArchive({
      archivePath: outPath,
      stagingParent: path.join(userData, 'backup-temp'),
      migrationsFolder
    })

    expect(exported.manifest.degradations).toEqual([{ code: 'external-file-dropped', count: 1 }])
    expect(admitted.manifest.degradations).toEqual([{ code: 'external-file-dropped', count: 1 }])
    expect(JSON.stringify(admitted.manifest.degradations)).not.toContain('/source/private')
    await admitted.cleanup()
  })
})
