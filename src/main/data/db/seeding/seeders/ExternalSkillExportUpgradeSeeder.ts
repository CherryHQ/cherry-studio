import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const EXPORT_PREFERENCE = { scope: 'default', key: 'agent.skills.external_export.enabled', value: true } as const

export class ExternalSkillExportUpgradeSeeder implements ISeeder {
  readonly name = 'externalSkillExportUpgrade'
  readonly description = 'Preserve external skill exports for existing installations'
  readonly version = hashObject(EXPORT_PREFERENCE)

  run(db: DbType): void {
    db.transaction((tx) => {
      if (!tx.select({ key: preferenceTable.key }).from(preferenceTable).limit(1).get()) return
      const existing = tx
        .select({ key: preferenceTable.key })
        .from(preferenceTable)
        .where(and(eq(preferenceTable.scope, EXPORT_PREFERENCE.scope), eq(preferenceTable.key, EXPORT_PREFERENCE.key)))
        .get()
      if (existing) return

      const now = Date.now()
      tx.insert(preferenceTable)
        .values({ ...EXPORT_PREFERENCE, createdAt: now, updatedAt: now })
        .run()
    })
  }
}
