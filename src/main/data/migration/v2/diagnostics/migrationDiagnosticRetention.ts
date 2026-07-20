import type { MigrationDiagnosticEvent, MigrationDiagnosticsAttempt } from './migrationDiagnosticsSchemas'

export interface MigrationDiagnosticRetentionPlan {
  readonly protectedSequences: ReadonlySet<number>
  readonly removableSequences: readonly number[]
}

function causalRank(event: MigrationDiagnosticEvent): 0 | 1 | 2 {
  if (event.semanticEvidence !== undefined || event.payloadProfile !== undefined || event.versionGate !== undefined) {
    return 2
  }
  if (
    (event.state === 'failed' || event.state === 'unavailable' || event.state === 'warning') &&
    event.code !== 'unknown'
  ) {
    return 1
  }
  return 0
}

export function createMigrationDiagnosticRetentionPlan(
  attempts: readonly MigrationDiagnosticsAttempt[]
): MigrationDiagnosticRetentionPlan {
  const protectedSequences = new Set<number>()

  for (const attempt of attempts) {
    if (attempt.outcome !== 'in_progress') {
      const terminal = attempt.events.at(-1)
      if (terminal?.state === attempt.outcome) {
        protectedSequences.add(terminal.sequence)
      }
    }

    let representative: MigrationDiagnosticEvent | undefined
    let representativeRank: 0 | 1 | 2 = 0
    for (const event of attempt.events) {
      const rank = causalRank(event)
      if (
        rank > representativeRank ||
        (rank === representativeRank && rank > 0 && event.sequence > (representative?.sequence ?? -1))
      ) {
        representative = event
        representativeRank = rank
      }
    }
    if (representative !== undefined) {
      protectedSequences.add(representative.sequence)
    }
  }

  const removable = attempts
    .flatMap((attempt) => attempt.events)
    .filter((event) => !protectedSequences.has(event.sequence))
    .map((event) => ({ sequence: event.sequence, rank: causalRank(event) }))
    .sort((left, right) => {
      const leftGroup = left.rank === 0 ? 0 : 1
      const rightGroup = right.rank === 0 ? 0 : 1
      return leftGroup - rightGroup || left.sequence - right.sequence
    })
    .map(({ sequence }) => sequence)

  return { protectedSequences, removableSequences: removable }
}
