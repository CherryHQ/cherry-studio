import { preferenceTable } from '@data/db/schemas/preference'
import { and, eq, inArray } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const EXISTING_V2_COMPATIBILITY_DEFAULTS = [
  { scope: 'default', key: 'chat.input.paste_long_text_as_file', value: true },
  { scope: 'default', key: 'chat.input.paste_long_text_threshold', value: 1500 }
] as const
const EXISTING_V2_PREFERENCE_KEY = 'app.language'

export class LongTextPastePreferenceUpgradeSeeder implements ISeeder {
  readonly name = 'longTextPastePreferenceUpgrade'
  readonly description = 'Preserve long-text file paste behavior for existing v2 installations'
  readonly version = hashObject(EXISTING_V2_COMPATIBILITY_DEFAULTS)

  run(db: DbType): void {
    const existingV2Preference = db
      .select({ key: preferenceTable.key })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, EXISTING_V2_PREFERENCE_KEY)))
      .limit(1)
      .get()
    if (!existingV2Preference) return

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
