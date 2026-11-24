import { artifactService } from '@data/services/ArtifactService'

import type { DbType, ISeeder } from '../../types'

/** Indexes the Agent and Assistant outputs made before the `artifact` index existed, once per install. */
export class PastOutputsBackfillSeeder implements ISeeder {
  readonly name = 'artifact-past-outputs'
  readonly version = '1'
  readonly description = 'Index outputs reported or generated before the artifact index existed'

  run(db: DbType): void {
    artifactService.backfillPastOutputsTx(db)
  }
}
