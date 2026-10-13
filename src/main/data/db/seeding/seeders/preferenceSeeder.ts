import { preferenceTable } from '@data/db/schemas/preference'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { SupportedPlatform } from '@shared/types/command'
import { type CommandId, getCommandDefaultShortcutPreference, REGISTERED_KEYBINDINGS } from '@shared/utils/command'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const SHORTCUT_PLATFORM_DEFAULTS_REVISION = 1

const shortcutCommandByPreferenceKey = new Map<string, CommandId>(
  REGISTERED_KEYBINDINGS.map((rule) => [rule.preferenceKey, rule.command])
)

export class PreferenceSeeder implements ISeeder {
  readonly name = 'preference'
  readonly description = 'Insert default preference values'
  readonly version: string
  private readonly platform: SupportedPlatform

  constructor(platform: SupportedPlatform = process.platform as SupportedPlatform) {
    this.platform = platform
    this.version = hashObject({
      ...DefaultPreferences,
      shortcutPlatformDefaults: SHORTCUT_PLATFORM_DEFAULTS_REVISION
    })
  }

  run(db: DbType): void {
    const preferences = db.select().from(preferenceTable).all()

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

        const command = shortcutCommandByPreferenceKey.get(key)
        const resolved = command ? getCommandDefaultShortcutPreference(command, this.platform) : undefined
        // Keep every schema field; overlay only the resolved platform binding and enabled flag.
        const seededValue = resolved && typeof value === 'object' && value !== null ? { ...value, ...resolved } : value

        // Add to new preferences array
        newPreferences.push({
          scope,
          key,
          value: seededValue
        })
      }
    }

    // If there are new preferences to insert, do it
    if (newPreferences.length > 0) {
      db.insert(preferenceTable).values(newPreferences).run()
    }
  }
}
