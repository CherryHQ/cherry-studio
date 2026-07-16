import type { AggregateBoundary } from '@main/data/db/backup/contributorTypes'
import type { ConflictStrategy } from '@main/data/db/backup/domains'

import { MergeStrategyNotImplementedError } from './errors'
import type { MergeAction } from './types'

/** Resolve a conflict strategy without allowing an implicit UI default to erase domain policy. */
export class ConflictResolver {
  resolve(aggregate: AggregateBoundary, userStrategy?: ConflictStrategy): MergeAction {
    const identityClass = aggregate.identityClass ?? 'uuid-entity'
    const effective =
      userStrategy ?? aggregate.conflictDefault ?? (identityClass === 'uuid-entity' ? 'SKIP' : 'FIELD_MERGE')

    switch (effective) {
      case 'SKIP':
        return 'skip'
      case 'FIELD_MERGE':
        return 'field-merge'
      case 'OVERWRITE':
      case 'RENAME':
        throw new MergeStrategyNotImplementedError(effective)
    }
  }
}
