import { preferenceTable } from '@data/db/schemas/preference'
import { DEFAULT_WEB_SEARCH_CUTOFF_LIMIT } from '@shared/data/types/webSearch'
import { and, eq } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const SCOPE = 'default'
const METHOD_KEY = 'chat.web_search.compression.method'
const CUTOFF_LIMIT_KEY = 'chat.web_search.compression.cutoff_limit'
const LEGACY_DEFAULT_METHOD = 'none'
const LEGACY_DEFAULT_CUTOFF_LIMIT = 2000
const CURRENT_DEFAULT_METHOD = 'cutoff'

/**
 * Move existing V2 databases from the old unbounded web-search defaults to
 * the current safe defaults. A non-default value on either key makes the pair
 * user-owned and leaves it untouched.
 *
 * This seeder must run before PreferenceSeeder so a partially populated pair
 * can still be distinguished from a freshly inserted current default.
 */
export class WebSearchCompressionDefaultSeeder implements ISeeder {
  readonly name = 'webSearchCompressionDefault'
  readonly description = 'Upgrade legacy default web-search compression preferences'
  readonly version = hashObject({
    from: { method: LEGACY_DEFAULT_METHOD, cutoffLimit: LEGACY_DEFAULT_CUTOFF_LIMIT },
    to: { method: CURRENT_DEFAULT_METHOD, cutoffLimit: DEFAULT_WEB_SEARCH_CUTOFF_LIMIT },
    strategy: 'upgrade-only-default-shaped-pairs'
  })

  run(db: DbType): void {
    db.transaction((tx) => {
      const [methodPreference] = tx
        .select({ value: preferenceTable.value })
        .from(preferenceTable)
        .where(and(eq(preferenceTable.scope, SCOPE), eq(preferenceTable.key, METHOD_KEY)))
        .limit(1)
        .all()
      const [cutoffLimitPreference] = tx
        .select({ value: preferenceTable.value })
        .from(preferenceTable)
        .where(and(eq(preferenceTable.scope, SCOPE), eq(preferenceTable.key, CUTOFF_LIMIT_KEY)))
        .limit(1)
        .all()

      // An empty table belongs to a fresh install; PreferenceSeeder will add
      // the generated current defaults later in the same seeding pass.
      if (!methodPreference && !cutoffLimitPreference) return

      const methodIsLegacyDefault = methodPreference?.value === LEGACY_DEFAULT_METHOD
      const cutoffLimitIsLegacyDefault = cutoffLimitPreference?.value === LEGACY_DEFAULT_CUTOFF_LIMIT
      const pairIsDefaultShaped =
        (!methodPreference || methodIsLegacyDefault) && (!cutoffLimitPreference || cutoffLimitIsLegacyDefault)

      if (!pairIsDefaultShaped) return

      if (methodIsLegacyDefault) {
        tx.update(preferenceTable)
          .set({ value: CURRENT_DEFAULT_METHOD })
          .where(and(eq(preferenceTable.scope, SCOPE), eq(preferenceTable.key, METHOD_KEY)))
          .run()
      }

      if (cutoffLimitIsLegacyDefault) {
        tx.update(preferenceTable)
          .set({ value: DEFAULT_WEB_SEARCH_CUTOFF_LIMIT })
          .where(and(eq(preferenceTable.scope, SCOPE), eq(preferenceTable.key, CUTOFF_LIMIT_KEY)))
          .run()
      }
    })
  }
}
