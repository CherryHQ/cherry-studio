import { preferenceTable } from '@data/db/schemas/preference'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { and, eq } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const OBSOLETE_DEFAULT_PREFERENCE_KEYS = ['app.settings.open_target'] as const
const SIDEBAR_VISIBLE_KEY = 'ui.sidebar.icons.visible'
const SIDEBAR_LIBRARY_ICON = 'library'
const SIDEBAR_STORE_ICON = 'store'

function ensureLibrarySidebarIcon(value: unknown): unknown {
  if (!Array.isArray(value) || value.includes(SIDEBAR_LIBRARY_ICON)) {
    return value
  }

  const storeIndex = value.indexOf(SIDEBAR_STORE_ICON)
  if (storeIndex === -1) {
    return [...value, SIDEBAR_LIBRARY_ICON]
  }

  return [...value.slice(0, storeIndex + 1), SIDEBAR_LIBRARY_ICON, ...value.slice(storeIndex + 1)]
}

export class PreferenceSeeder implements ISeeder {
  readonly name = 'preference'
  readonly description = 'Insert default preference values'
  readonly version: string

  constructor() {
    this.version = hashObject(DefaultPreferences)
  }

  async run(db: DbType): Promise<void> {
    for (const obsoleteKey of OBSOLETE_DEFAULT_PREFERENCE_KEYS) {
      await db
        .delete(preferenceTable)
        .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, obsoleteKey)))
    }

    const preferences = await db.select().from(preferenceTable)

    // Convert existing preferences to a Map for quick lookup
    const existingPrefs = new Map(preferences.map((p) => [`${p.scope}.${p.key}`, p]))
    const visibleSidebarPref = existingPrefs.get(`default.${SIDEBAR_VISIBLE_KEY}`)
    const visibleSidebarValue = ensureLibrarySidebarIcon(visibleSidebarPref?.value)
    if (visibleSidebarPref && visibleSidebarValue !== visibleSidebarPref.value) {
      await db
        .update(preferenceTable)
        .set({ value: visibleSidebarValue })
        .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, SIDEBAR_VISIBLE_KEY)))
    }

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
