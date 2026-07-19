import { describe, expect, it } from 'vitest'

import {
  MIGRATION_ERROR_CODES,
  migrationDiagnosticEventSchema,
  migrationDiagnosticsSessionSchema,
  payloadLengthProfileSchema
} from '../migrationDiagnosticsSchemas'

const validEvent = {
  sequence: 1,
  at: '2026-07-19T10:00:00.000Z',
  attemptId: 'attempt-1',
  scope: 'migrator',
  phase: 'execute',
  state: 'failed',
  code: 'sqlite_too_big'
} as const

describe('migrationDiagnosticEventSchema', () => {
  it('accepts only the fixed event fields', () => {
    expect(migrationDiagnosticEventSchema.parse(validEvent)).toEqual(validEvent)
  })

  it.each(['rawError', 'message', 'stack', 'unknownKey'])('rejects the arbitrary %s field', (field) => {
    expect(
      migrationDiagnosticEventSchema.safeParse({
        ...validEvent,
        [field]: 'sk-user-message'
      }).success
    ).toBe(false)
  })

  it('rejects invalid field ranges and non-fixed enum values', () => {
    expect(migrationDiagnosticEventSchema.safeParse({ ...validEvent, sequence: -1 }).success).toBe(false)
    expect(migrationDiagnosticEventSchema.safeParse({ ...validEvent, attemptId: 'x'.repeat(65) }).success).toBe(false)
    expect(migrationDiagnosticEventSchema.safeParse({ ...validEvent, at: 'today' }).success).toBe(false)
    expect(migrationDiagnosticEventSchema.safeParse({ ...validEvent, scope: 'dynamic-scope' }).success).toBe(false)
  })

  it('allows an empty migrator ID but still enforces its maximum length', () => {
    expect(migrationDiagnosticEventSchema.safeParse({ ...validEvent, migratorId: '' }).success).toBe(true)
    expect(migrationDiagnosticEventSchema.safeParse({ ...validEvent, migratorId: 'x'.repeat(65) }).success).toBe(false)
  })

  it('exposes the fixed error-code allowlist', () => {
    expect(MIGRATION_ERROR_CODES).toEqual([
      'unknown',
      'path_unavailable',
      'permission_denied',
      'disk_full',
      'sqlite_corrupt',
      'sqlite_not_database',
      'sqlite_too_big',
      'sqlite_constraint',
      'sqlite_schema',
      'source_parse',
      'worker_timeout',
      'archive_write'
    ])
  })

  it('rejects unknown keys in nested payload profiles and slot variants', () => {
    const payloadProfile = {
      target: 'message',
      rowCountBucket: '1',
      profiledByteLengthBucket: '1-256',
      maxProfiledRowByteLengthBucket: '1-256',
      traversal: 'complete',
      slots: [{ slot: 'content', kind: 'empty', leaked: 'secret' }]
    }

    expect(migrationDiagnosticEventSchema.safeParse({ ...validEvent, payloadProfile }).success).toBe(false)
    expect(payloadLengthProfileSchema.safeParse({ ...payloadProfile, slots: [], leaked: 'secret' }).success).toBe(false)
  })
})

const terminalEvent = {
  sequence: 2,
  at: '2026-07-19T10:02:00.000Z',
  attemptId: 'attempt-1',
  scope: 'gate',
  phase: 'finalize',
  state: 'failed',
  code: 'unknown'
} as const

const validSession = {
  version: 1,
  sessionId: 'session-1',
  appVersion: '2.0.0',
  platform: 'darwin',
  arch: 'arm64',
  startedAt: '2026-07-19T10:00:00.000Z',
  state: 'failed',
  attempts: [
    {
      id: 'attempt-1',
      trigger: 'initial',
      startedAt: '2026-07-19T10:01:00.000Z',
      outcome: 'failed',
      endedAt: '2026-07-19T10:02:00.000Z',
      events: [terminalEvent]
    }
  ]
} as const

describe('migrationDiagnosticsSessionSchema', () => {
  it('accepts the strict version-1 session contract', () => {
    expect(migrationDiagnosticsSessionSchema.parse(validSession)).toEqual(validSession)
  })

  it.each([
    { ...validSession, rawError: 'secret' },
    { ...validSession, attempts: [{ ...validSession.attempts[0], path: '/Users/alice' }] },
    {
      ...validSession,
      attempts: [{ ...validSession.attempts[0], events: [{ ...terminalEvent, message: 'user message' }] }]
    }
  ])('rejects unknown fields at every object level', (candidate) => {
    expect(migrationDiagnosticsSessionSchema.safeParse(candidate).success).toBe(false)
  })

  it('rejects events whose attempt ID does not match their parent', () => {
    const candidate = {
      ...validSession,
      attempts: [
        {
          ...validSession.attempts[0],
          events: [{ ...terminalEvent, attemptId: 'other-attempt' }]
        }
      ]
    }

    expect(migrationDiagnosticsSessionSchema.safeParse(candidate).success).toBe(false)
  })

  it('requires endedAt only for terminal outcomes', () => {
    const inProgressWithEnd = {
      ...validSession,
      state: 'active',
      attempts: [
        {
          id: 'attempt-1',
          trigger: 'initial',
          startedAt: '2026-07-19T10:01:00.000Z',
          outcome: 'in_progress',
          endedAt: '2026-07-19T10:02:00.000Z',
          events: []
        }
      ]
    }
    const terminalWithoutEnd = {
      ...validSession,
      attempts: [{ ...validSession.attempts[0], endedAt: undefined }]
    }

    expect(migrationDiagnosticsSessionSchema.safeParse(inProgressWithEnd).success).toBe(false)
    expect(migrationDiagnosticsSessionSchema.safeParse(terminalWithoutEnd).success).toBe(false)
  })

  it('requires terminal session states to agree with the newest terminal attempt', () => {
    const inProgressAttempt = {
      id: 'attempt-1',
      trigger: 'initial',
      startedAt: '2026-07-19T10:01:00.000Z',
      outcome: 'in_progress',
      events: []
    }
    const completedAttempt = {
      ...validSession.attempts[0],
      outcome: 'completed',
      events: [{ ...terminalEvent, state: 'completed' }]
    }

    expect(
      migrationDiagnosticsSessionSchema.safeParse({
        ...validSession,
        state: 'completed',
        attempts: [inProgressAttempt]
      }).success
    ).toBe(false)
    expect(
      migrationDiagnosticsSessionSchema.safeParse({ ...validSession, state: 'failed', attempts: [inProgressAttempt] })
        .success
    ).toBe(false)
    expect(migrationDiagnosticsSessionSchema.safeParse({ ...validSession, state: 'completed' }).success).toBe(false)
    expect(
      migrationDiagnosticsSessionSchema.safeParse({ ...validSession, state: 'failed', attempts: [completedAttempt] })
        .success
    ).toBe(false)
    expect(
      migrationDiagnosticsSessionSchema.safeParse({ ...validSession, state: 'active', attempts: [inProgressAttempt] })
        .success
    ).toBe(true)
  })

  it('rejects an end time before the attempt or its terminal event', () => {
    const candidate = {
      ...validSession,
      attempts: [
        {
          ...validSession.attempts[0],
          endedAt: '2026-07-19T10:00:30.000Z'
        }
      ]
    }

    expect(migrationDiagnosticsSessionSchema.safeParse(candidate).success).toBe(false)
  })

  it('requires every finished attempt to end with its matching terminal event', () => {
    const noTerminalEvent = {
      ...validSession,
      attempts: [{ ...validSession.attempts[0], events: [] }]
    }
    const mismatchedTerminalEvent = {
      ...validSession,
      attempts: [
        {
          ...validSession.attempts[0],
          events: [{ ...terminalEvent, state: 'completed' }]
        }
      ]
    }

    expect(migrationDiagnosticsSessionSchema.safeParse(noTerminalEvent).success).toBe(false)
    expect(migrationDiagnosticsSessionSchema.safeParse(mismatchedTerminalEvent).success).toBe(false)
  })
})
