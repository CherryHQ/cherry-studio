import { preferenceTable } from '@data/db/schemas/preference'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { and, eq } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const OBSOLETE_DEFAULT_PREFERENCE_KEYS = ['app.settings.open_target'] as const
const DEFAULT_SCOPE = 'default'
const SIDEBAR_VISIBLE_KEY = 'ui.sidebar.icons.visible'
const SIDEBAR_INVISIBLE_KEY = 'ui.sidebar.icons.invisible'
const AGENTS_SIDEBAR_ICON = 'agents'
const PREFERENCE_SEED_PATCHES = ['sidebar-agents-visible-v1'] as const

function addAgentsSidebarIcon(visible: unknown, invisible: unknown): unknown {
  if (!Array.isArray(visible) || visible.includes(AGENTS_SIDEBAR_ICON)) {
    return visible
  }

  if (Array.isArray(invisible) && invisible.includes(AGENTS_SIDEBAR_ICON)) {
    return visible
  }

  const nextVisible = [...visible]
  const assistantsIndex = nextVisible.indexOf('assistants')
  nextVisible.splice(assistantsIndex === -1 ? nextVisible.length : assistantsIndex + 1, 0, AGENTS_SIDEBAR_ICON)
  return nextVisible
}

export class PreferenceSeeder implements ISeeder {
  readonly name = 'preference'
  readonly description = 'Insert default preference values'
  readonly version: string

  constructor() {
    this.version = hashObject({ DefaultPreferences, patches: PREFERENCE_SEED_PATCHES })
  }

  async run(db: DbType): Promise<void> {
    for (const obsoleteKey of OBSOLETE_DEFAULT_PREFERENCE_KEYS) {
      await db
        .delete(preferenceTable)
        .where(and(eq(preferenceTable.scope, DEFAULT_SCOPE), eq(preferenceTable.key, obsoleteKey)))
    }

    const preferences = await db.select().from(preferenceTable)

    // Convert existing preferences to a Map for quick lookup
    const existingPrefs = new Map(preferences.map((p) => [`${p.scope}.${p.key}`, p]))
    const visiblePref = existingPrefs.get(`${DEFAULT_SCOPE}.${SIDEBAR_VISIBLE_KEY}`)

    if (visiblePref) {
      const invisiblePref = existingPrefs.get(`${DEFAULT_SCOPE}.${SIDEBAR_INVISIBLE_KEY}`)
      const nextVisible = addAgentsSidebarIcon(visiblePref.value, invisiblePref?.value)

      if (nextVisible !== visiblePref.value) {
        await db
          .update(preferenceTable)
          .set({ value: nextVisible })
          .where(and(eq(preferenceTable.scope, DEFAULT_SCOPE), eq(preferenceTable.key, SIDEBAR_VISIBLE_KEY)))
      }
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
