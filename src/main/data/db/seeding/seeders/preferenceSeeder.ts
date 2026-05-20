import { preferenceTable } from '@data/db/schemas/preference'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { SidebarIcon } from '@shared/data/preference/preferenceTypes'
import { and, eq } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const OBSOLETE_DEFAULT_PREFERENCE_KEYS = ['app.settings.open_target'] as const
const DEFAULT_SCOPE = 'default'
const SIDEBAR_VISIBLE_KEY = 'ui.sidebar.icons.visible'
const SIDEBAR_INVISIBLE_KEY = 'ui.sidebar.icons.invisible'

type PreferenceRow = typeof preferenceTable.$inferSelect

function preferenceMapKey(scope: string, key: string): string {
  return `${scope}.${key}`
}

function isSidebarIconArray(value: unknown): value is SidebarIcon[] {
  return Array.isArray(value)
}

function addAgentsToVisibleSidebarIcons(visible: SidebarIcon[], invisible: SidebarIcon[]): SidebarIcon[] {
  if (visible.includes('agents') || invisible.includes('agents')) {
    return visible
  }

  const nextVisible = [...visible]
  const assistantsIndex = nextVisible.indexOf('assistants')
  nextVisible.splice(assistantsIndex === -1 ? nextVisible.length : assistantsIndex + 1, 0, 'agents')
  return nextVisible
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
    const existingPrefs = new Map(preferences.map((p) => [preferenceMapKey(p.scope, p.key), p]))

    // Collect all new preferences to insert
    const newPreferences: Array<{
      scope: string
      key: string
      value: unknown
    }> = []

    await this.backfillSidebarIconPreferences(db, existingPrefs)

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

  private async backfillSidebarIconPreferences(db: DbType, existingPrefs: Map<string, PreferenceRow>): Promise<void> {
    const visiblePref = existingPrefs.get(preferenceMapKey(DEFAULT_SCOPE, SIDEBAR_VISIBLE_KEY))
    const invisiblePref = existingPrefs.get(preferenceMapKey(DEFAULT_SCOPE, SIDEBAR_INVISIBLE_KEY))

    const visibleIcons = isSidebarIconArray(visiblePref?.value) ? visiblePref.value : undefined
    const invisibleIcons = isSidebarIconArray(invisiblePref?.value) ? invisiblePref.value : []
    const nextVisibleIcons = visibleIcons ? addAgentsToVisibleSidebarIcons(visibleIcons, invisibleIcons) : visibleIcons

    if (visiblePref && nextVisibleIcons && nextVisibleIcons !== visibleIcons) {
      await db
        .update(preferenceTable)
        .set({ value: nextVisibleIcons })
        .where(and(eq(preferenceTable.scope, DEFAULT_SCOPE), eq(preferenceTable.key, SIDEBAR_VISIBLE_KEY)))

      visiblePref.value = nextVisibleIcons
    }
  }
}
