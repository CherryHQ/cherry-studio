import { preferenceTable } from '@data/db/schemas/preference'
import { and, eq } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const WEB_SEARCH_PREFERENCE_UPGRADE = {
  scope: 'default',
  legacyKey: 'chat.web_search.client_tools_preferred',
  nextKey: 'chat.web_search.model_tools_preferred'
} as const

export class WebSearchPreferenceUpgradeSeeder implements ISeeder {
  readonly name = 'webSearchPreferenceUpgrade'
  readonly description = 'Align the web-tool preference value with model-native priority'
  readonly version = hashObject(WEB_SEARCH_PREFERENCE_UPGRADE)

  run(db: DbType): void {
    const legacyPreference = db
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(
        and(
          eq(preferenceTable.scope, WEB_SEARCH_PREFERENCE_UPGRADE.scope),
          eq(preferenceTable.key, WEB_SEARCH_PREFERENCE_UPGRADE.legacyKey)
        )
      )
      .get()
    if (!legacyPreference) return

    db.transaction((tx) => {
      tx.insert(preferenceTable)
        .values({
          scope: WEB_SEARCH_PREFERENCE_UPGRADE.scope,
          key: WEB_SEARCH_PREFERENCE_UPGRADE.nextKey,
          value: !legacyPreference.value
        })
        .onConflictDoUpdate({
          target: [preferenceTable.scope, preferenceTable.key],
          set: { value: !legacyPreference.value }
        })
        .run()
      tx.delete(preferenceTable)
        .where(
          and(
            eq(preferenceTable.scope, WEB_SEARCH_PREFERENCE_UPGRADE.scope),
            eq(preferenceTable.key, WEB_SEARCH_PREFERENCE_UPGRADE.legacyKey)
          )
        )
        .run()
    })
  }
}
