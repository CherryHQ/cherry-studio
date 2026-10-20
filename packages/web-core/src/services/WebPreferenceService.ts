import { eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import type { PreferenceDefaultScopeType, PreferenceKeyType } from '@shared/data/preference/preferenceTypes'

import type { WebDbService } from '../database/WebDbService'

/**
 * Read side of the desktop `PreferenceService`: the account's stored preferences over the
 * defaults, loaded once when the database opens. Boot-config keys have no store in the browser.
 */
export class WebPreferenceService {
  readonly #values: Partial<PreferenceDefaultScopeType> = {}

  constructor(db: WebDbService) {
    const rows = db.getDb().select().from(preferenceTable).where(eq(preferenceTable.scope, 'default')).all()
    for (const row of rows) {
      if (row.key in DefaultPreferences.default) this.#values[row.key as PreferenceKeyType] = row.value as never
    }
  }

  get<K extends PreferenceKeyType>(key: K): PreferenceDefaultScopeType[K] {
    return this.#values[key] ?? DefaultPreferences.default[key]
  }
}
