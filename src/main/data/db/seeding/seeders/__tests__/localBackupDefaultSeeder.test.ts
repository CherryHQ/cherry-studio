import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'

const AUTO_SYNC_KEY = 'data.backup.local.auto_sync'
const INTERVAL_KEY = 'data.backup.local.sync_interval'
const MAX_BACKUPS_KEY = 'data.backup.local.max_backups'

const BACKUP_SEEDERS = seeders.filter(({ name }) => name === 'localBackupDefault' || name === 'preference')

describe('LocalBackupDefaultSeeder', () => {
  const dbh = setupTestDatabase()

  const readPreference = async (key: string) => {
    const [row] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
    return row?.value
  }

  const storePreference = async (key: string, value: unknown) => {
    await dbh.db.insert(preferenceTable).values({ scope: 'default', key, value })
  }

  it('enables daily local backups on an installation that never configured one', async () => {
    await storePreference(AUTO_SYNC_KEY, false)
    await storePreference(INTERVAL_KEY, 0)

    new SeedRunner(dbh.db).runAll(BACKUP_SEEDERS)

    expect(await readPreference(AUTO_SYNC_KEY)).toBe(true)
    expect(await readPreference(INTERVAL_KEY)).toBe(1440)
    expect(await readPreference(MAX_BACKUPS_KEY)).toBe(7)
  })

  it('leaves local backups alone once a backup folder was chosen', async () => {
    await storePreference('data.backup.local.dir', 'D:/my-backups')
    await storePreference(AUTO_SYNC_KEY, false)

    new SeedRunner(dbh.db).runAll(BACKUP_SEEDERS)

    expect(await readPreference(AUTO_SYNC_KEY)).toBe(false)
  })

  it('leaves local backups alone when a remote backup is already running', async () => {
    await storePreference('data.backup.webdav.auto_sync', true)
    await storePreference(AUTO_SYNC_KEY, false)

    new SeedRunner(dbh.db).runAll(BACKUP_SEEDERS)

    expect(await readPreference(AUTO_SYNC_KEY)).toBe(false)
  })
})
