import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const WEB_SEARCH_PREFERENCE_UPGRADE = {
  scope: 'default',
  key: 'chat.web_search.client_tools_preferred',
  previousValue: true,
  nextValue: false
} as const

export class WebSearchPreferenceUpgradeSeeder implements ISeeder {
  readonly name = 'webSearchPreferenceUpgrade'
  readonly description = 'Default web tools to model-native capabilities for existing installations'
  readonly version = hashObject(WEB_SEARCH_PREFERENCE_UPGRADE)

  run(db: DbType): void {
    db.update(preferenceTable)
      .set({ value: WEB_SEARCH_PREFERENCE_UPGRADE.nextValue })
      .where(
        and(
          eq(preferenceTable.scope, WEB_SEARCH_PREFERENCE_UPGRADE.scope),
          eq(preferenceTable.key, WEB_SEARCH_PREFERENCE_UPGRADE.key),
          eq(preferenceTable.value, WEB_SEARCH_PREFERENCE_UPGRADE.previousValue)
        )
      )
      .run()
  }
}
