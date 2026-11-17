import { application } from '@application'
import type { DbType } from '@data/db/types'

import { readMigrationV2Status } from './migrationStatus'

export function isMigratedFromV1(db: Pick<DbType, 'select'> = application.get('DbService').getDb()): boolean {
  const status = readMigrationV2Status(db)
  return status?.status === 'completed' && status.migratedFromV1 === true
}
