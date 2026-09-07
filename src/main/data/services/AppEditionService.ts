import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import type { DbOrTx } from '@data/db/types'
import { getPackageEdition } from '@main/utils/appEdition'
import type { AppEdition } from '@shared/types/appEdition'
import { eq } from 'drizzle-orm'

const MIGRATION_EDITION_KEY = 'appEdition:v1Migration'

export class AppEditionService {
  private cachedEdition: AppEdition | undefined

  getEdition(): AppEdition {
    this.cachedEdition ??=
      getPackageEdition() === 'global' || this.getMigrationOrigin(application.get('DbService').getDb()) === true
        ? 'global'
        : 'cn'
    return this.cachedEdition
  }

  getMigrationOrigin(db: DbOrTx): boolean | undefined {
    const row = db.select().from(appStateTable).where(eq(appStateTable.key, MIGRATION_EDITION_KEY)).get()
    return row?.value as boolean | undefined
  }

  recordMigrationOrigin(db: DbOrTx, migratedFromV1: boolean): void {
    const insert = db.insert(appStateTable).values({ key: MIGRATION_EDITION_KEY, value: migratedFromV1 })
    if (migratedFromV1) {
      insert.onConflictDoUpdate({ target: appStateTable.key, set: { value: true, updatedAt: Date.now() } }).run()
    } else {
      // A retry or skip must not revoke an already established migration identity.
      insert.onConflictDoNothing().run()
    }
  }
}

export const appEditionService = new AppEditionService()
