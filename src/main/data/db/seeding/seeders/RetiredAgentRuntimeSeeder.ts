import { queueRetiredAgentRuntimeMigration } from '@data/services/retiredAgentRuntimeMigration'

import type { DbType, ISeeder } from '../../types'

export class RetiredAgentRuntimeSeeder implements ISeeder {
  readonly name = 'retiredAgentRuntime'
  readonly version = '1'
  readonly description = 'Migrate retired DSH agents to Pi and queue native history conversion'

  run(db: DbType): void {
    queueRetiredAgentRuntimeMigration(db)
  }
}
