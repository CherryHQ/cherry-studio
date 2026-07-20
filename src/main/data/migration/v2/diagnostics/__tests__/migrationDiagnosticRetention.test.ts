import { describe, expect, it } from 'vitest'

import { createMigrationDiagnosticRetentionPlan } from '../migrationDiagnosticRetention'
import type { MigrationDiagnosticEvent, MigrationDiagnosticsAttempt } from '../migrationDiagnosticsSchemas'

const AT = '2026-07-19T10:00:00.000Z'

function event(
  attemptId: string,
  sequence: number,
  overrides: Partial<MigrationDiagnosticEvent> = {}
): MigrationDiagnosticEvent {
  return {
    sequence,
    at: AT,
    attemptId,
    scope: 'engine',
    phase: 'execute',
    state: 'started',
    code: 'unknown',
    ...overrides
  }
}

function failedAttempt(id: string, events: readonly MigrationDiagnosticEvent[]): MigrationDiagnosticsAttempt {
  return {
    id,
    trigger: 'initial',
    startedAt: AT,
    outcome: 'failed',
    endedAt: AT,
    events: [...events]
  }
}

describe('createMigrationDiagnosticRetentionPlan', () => {
  it('protects each terminal and the latest event from the highest available causal rank', () => {
    const firstId = 'first'
    const secondId = 'second'
    const attempts: MigrationDiagnosticsAttempt[] = [
      failedAttempt(firstId, [
        event(firstId, 1),
        event(firstId, 2, { state: 'warning', code: 'source_parse' }),
        event(firstId, 3, {
          payloadProfile: {
            target: 'message',
            rowCountBucket: '1',
            profiledByteLengthBucket: '1-256',
            maxProfiledRowByteLengthBucket: '1-256',
            traversal: 'complete',
            slots: []
          }
        }),
        event(firstId, 4, {
          scope: 'migrator',
          phase: 'prepare',
          state: 'warning',
          code: 'missing_required_field',
          category: 'source',
          migratorId: 'mcp_server',
          semanticEvidence: {
            kind: 'missing_required_field',
            fieldRole: 'source_id',
            affectedCountBucket: '1'
          }
        }),
        event(firstId, 5, { state: 'failed', code: 'sqlite_corrupt' }),
        event(firstId, 6, { phase: 'finalize', state: 'failed' })
      ]),
      failedAttempt(secondId, [
        event(secondId, 7),
        event(secondId, 8, { phase: 'finalize', state: 'failed', code: 'disk_full' })
      ])
    ]

    const plan = createMigrationDiagnosticRetentionPlan(attempts)

    expect([...plan.protectedSequences].sort((left, right) => left - right)).toEqual([4, 6, 8])
    expect(plan.removableSequences).toEqual([1, 7, 2, 3, 5])
  })

  it('does not invent a causal representative when an attempt has only ordinary lifecycle events', () => {
    const attemptId = 'ordinary-only'
    const plan = createMigrationDiagnosticRetentionPlan([
      failedAttempt(attemptId, [
        event(attemptId, 1),
        event(attemptId, 2, { state: 'warning' }),
        event(attemptId, 3, { phase: 'finalize', state: 'failed' })
      ])
    ])

    expect([...plan.protectedSequences]).toEqual([3])
    expect(plan.removableSequences).toEqual([1, 2])
  })

  it('protects the causal representative of an in-progress attempt without inventing a terminal', () => {
    const attemptId = 'in-progress'
    const attempt: MigrationDiagnosticsAttempt = {
      id: attemptId,
      trigger: 'initial',
      startedAt: AT,
      outcome: 'in_progress',
      events: [event(attemptId, 1), event(attemptId, 2, { state: 'unavailable', code: 'path_unavailable' })]
    }

    const plan = createMigrationDiagnosticRetentionPlan([attempt])

    expect([...plan.protectedSequences]).toEqual([2])
    expect(plan.removableSequences).toEqual([1])
  })

  it('protects a causal representative and terminal for each of five attempts near the event limit', () => {
    let sequence = 0
    const expectedProtected: number[] = []
    const attempts = Array.from({ length: 5 }, (_, attemptIndex) => {
      const id = `attempt-${attemptIndex + 1}`
      const events = Array.from({ length: 37 }, () => event(id, ++sequence))
      const cause = event(id, ++sequence, { state: 'unavailable', code: 'path_unavailable' })
      const terminal = event(id, ++sequence, { phase: 'finalize', state: 'failed' })
      expectedProtected.push(cause.sequence, terminal.sequence)
      return failedAttempt(id, [...events, cause, terminal])
    })

    const plan = createMigrationDiagnosticRetentionPlan(attempts)

    expect(sequence).toBe(195)
    expect([...plan.protectedSequences].sort((left, right) => left - right)).toEqual(expectedProtected)
    expect(plan.removableSequences).toHaveLength(185)
    expect(plan.removableSequences.every((candidate) => !plan.protectedSequences.has(candidate))).toBe(true)
  })
})
