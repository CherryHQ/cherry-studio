import { application } from '@application'

import { readMigrationV2Status } from './migrationStatus'

export function isMigratedFromV1(): boolean {
  const status = readMigrationV2Status(application.get('DbService').getDb())
  return status?.status === 'completed' && status.migratedFromV1 === true
}
