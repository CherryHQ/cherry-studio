import { appStateTable } from '@data/db/schemas/appState'
import { preferenceTable } from '@data/db/schemas/preference'
import { and, eq, inArray } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'
import { SEED_BOOTSTRAP_COMPLETED_KEY } from '../SeedRunner'

const EXISTING_V2_COMPATIBILITY_DEFAULTS = [
  { scope: 'default', key: 'chat.input.paste_long_text_as_file', value: true },
  { scope: 'default', key: 'chat.input.paste_long_text_threshold', value: 1500 }
] as const

export class LongTextPastePreferenceUpgradeSeeder implements ISeeder {
  readonly name = 'longTextPastePreferenceUpgrade'
  readonly description = 'Preserve long-text file paste behavior for existing v2 installations'
  readonly version = hashObject(EXISTING_V2_COMPATIBILITY_DEFAULTS)

  run(db: DbType): void {
    const existingInstall = db
      .select({ key: appStateTable.key })
      .from(appStateTable)
      .where(eq(appStateTable.key, SEED_BOOTSTRAP_COMPLETED_KEY))
      .get()
    if (!existingInstall) return

    const keys = EXISTING_V2_COMPATIBILITY_DEFAULTS.map(({ key }) => key)
    const existingKeys = new Set(
      db
        .select({ key: preferenceTable.key })
        .from(preferenceTable)
        .where(and(eq(preferenceTable.scope, 'default'), inArray(preferenceTable.key, keys)))
        .all()
        .map(({ key }) => key)
    )
    const missingPreferences = EXISTING_V2_COMPATIBILITY_DEFAULTS.filter(({ key }) => !existingKeys.has(key))

    if (missingPreferences.length > 0) {
      db.insert(preferenceTable).values(missingPreferences).run()
    }
  }
}
