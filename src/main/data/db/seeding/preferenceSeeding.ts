import { preferenceTable } from '@data/db/schemas/preference'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'

import type { DbType, ISeed } from '../types'

class PreferenceSeed implements ISeed {
  async migrate(db: DbType): Promise<void> {
    const preferences = await db.select().from(preferenceTable)

    // Convert existing preferences to a Map for quick lookup
    const existingPrefs = new Map(preferences.map((p) => [`${p.scope}.${p.key}`, p]))

    // Collect all new preferences to insert
    const newPreferences: Array<{
      scope: string
      key: string
      value: unknown
    }> = []

    // Process each scope in defaultPreferences
    for (const [scope, scopeData] of Object.entries(DefaultPreferences)) {
      // Process each key-value pair in the scope
      for (const [key, value] of Object.entries(scopeData)) {
        const prefKey = `${scope}.${key}`

        // Skip if this preference already exists
        if (existingPrefs.has(prefKey)) {
          continue
        }

        // Add to new preferences array
        newPreferences.push({
          scope,
          key,
          value
        })
      }
    }

    // If there are new preferences to insert, do it in a transaction
    if (newPreferences.length > 0) {
      await db.insert(preferenceTable).values(newPreferences)
    }
  }
}

export default PreferenceSeed
