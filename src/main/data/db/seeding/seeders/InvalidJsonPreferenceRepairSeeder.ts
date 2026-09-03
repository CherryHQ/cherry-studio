import { preferenceTable } from '@data/db/schemas/preference'
import { loggerService } from '@logger'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'
import { UniqueModelIdSchema } from '@shared/data/types/model'
import { and, eq, sql } from 'drizzle-orm'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const logger = loggerService.withContext('InvalidJsonPreferenceRepairSeeder')

const MODEL_ID_PREFERENCE_KEYS = new Set([
  'chat.context_settings.compress.model_id',
  'chat.default_model_id',
  'feature.openclaw.selected_model_id',
  'feature.paintings.default_model_id',
  'feature.quick_assistant.model_id',
  'feature.translate.model_id'
])

interface RawPreferenceRow {
  key: string
  scope: string
  value: string
}

interface PreferenceRepairLog {
  action: 'encoded legacy model id' | 'reset to default' | 'encoded raw value'
  key: string
  scope: string
}

const defaultPreferences: Record<string, unknown> = DefaultPreferences.default

export class InvalidJsonPreferenceRepairSeeder implements ISeeder {
  readonly name = 'invalidJsonPreferenceRepair'
  readonly description = 'Repair invalid JSON preference values'
  readonly version = hashObject({ defaults: DefaultPreferences, invalidJsonRepairVersion: 1 })

  run(db: DbType): void {
    const repairs: PreferenceRepairLog[] = []

    db.transaction((tx) => {
      const invalidPreferences = tx.all<RawPreferenceRow>(sql`
        SELECT scope, key, value
        FROM ${preferenceTable}
        WHERE value IS NOT NULL AND json_valid(value) = 0
      `)

      for (const preference of invalidPreferences) {
        const hasDefault = preference.scope === 'default' && Object.hasOwn(defaultPreferences, preference.key)
        const isLegacyModelId =
          MODEL_ID_PREFERENCE_KEYS.has(preference.key) && UniqueModelIdSchema.safeParse(preference.value).success
        const repairedValue = isLegacyModelId
          ? preference.value
          : hasDefault
            ? defaultPreferences[preference.key]
            : preference.value

        tx.update(preferenceTable)
          .set({ value: repairedValue })
          .where(and(eq(preferenceTable.scope, preference.scope), eq(preferenceTable.key, preference.key)))
          .run()
        repairs.push({
          action: isLegacyModelId ? 'encoded legacy model id' : hasDefault ? 'reset to default' : 'encoded raw value',
          key: preference.key,
          scope: preference.scope
        })
      }
    })

    for (const repair of repairs) {
      logger.warn('Repaired invalid JSON preference value', repair)
    }
  }
}
