import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'

import { readAppliedChain } from '../appliedChain'
import { hashDbFile } from '../hashDbFile'
import { readRestoreJournal, writeRestoreJournal } from '../restoreJournal'
import { runRestorePromotion } from '../restorePromotion'
import { snapshotTo } from '../snapshot'

describe('restore promotion before Chromium readiness', () => {
  const dbh = setupTestDatabase()
  let userData: string

  afterEach(() => {
    vi.mocked(application.getPath).mockReset()
    rmSync(userData, { recursive: true, force: true })
  })

  it('replaces Local Storage and the database before a queued ready callback can open the profile', async () => {
    userData = mkdtempSync(join(tmpdir(), 'cs-restore-preboot-'))
    const liveDatabase = join(userData, 'Data', 'cherrystudio.sqlite')
    const restoreDir = join(userData, 'restore-staging', 'restore-preboot')
    const workDatabase = join(restoreDir, 'work.sqlite')
    const liveStorage = join(userData, 'Local Storage')
    const stagedStorage = join(restoreDir, 'Local Storage')
    const paths = {
      'app.userdata': userData,
      'app.database.file': liveDatabase,
      'app.database.migrations': resolveMigrationsPath(),
      'feature.backup.restore.file': join(userData, 'Data', 'restore-journal.json'),
      'feature.backup.restore.staging': join(userData, 'restore-staging')
    }
    vi.mocked(application.getPath).mockImplementation((key, filename) => {
      const base = paths[key as keyof typeof paths]
      if (!base) throw new Error(`Unexpected restore path: ${key}`)
      return filename ? join(base, filename) : base
    })

    dbh.db.insert(appStateTable).values({ key: 'restore-marker', value: 'old' }).run()
    snapshotTo(dbh.sqlite, liveDatabase)
    dbh.db.update(appStateTable).set({ value: 'new' }).where(eq(appStateTable.key, 'restore-marker')).run()
    snapshotTo(dbh.sqlite, workDatabase)
    mkdirSync(liveStorage, { recursive: true })
    mkdirSync(stagedStorage, { recursive: true })
    writeFileSync(join(liveStorage, 'marker'), 'old')
    writeFileSync(join(stagedStorage, 'marker'), 'new')
    writeRestoreJournal({
      version: 1,
      restoreId: 'restore-preboot',
      createdAt: new Date().toISOString(),
      state: 'staged',
      db: {
        promote: 'restore-staging/restore-preboot/work.sqlite',
        aside: 'restore-staging/restore-preboot/aside.sqlite',
        fingerprint: await hashDbFile(liveDatabase),
        chain: readAppliedChain(dbh.sqlite)
      },
      fileResources: [
        {
          kind: 'overwrite',
          stagingPath: 'restore-staging/restore-preboot/Local Storage',
          livePath: 'Local Storage',
          asidePath: 'restore-staging/restore-preboot/aside/Local Storage'
        }
      ]
    })

    const storageAtReady = new Promise<string>((resolve) => {
      setImmediate(() => resolve(readFileSync(join(liveStorage, 'marker'), 'utf8')))
    })

    await runRestorePromotion()

    expect(await storageAtReady).toBe('new')
    expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'completed' } })
    const restored = new Database(liveDatabase, { readonly: true, fileMustExist: true })
    try {
      expect(restored.prepare('SELECT value FROM app_state WHERE key = ?').get('restore-marker')).toEqual({
        value: JSON.stringify('new')
      })
    } finally {
      restored.close()
    }
  })
})
