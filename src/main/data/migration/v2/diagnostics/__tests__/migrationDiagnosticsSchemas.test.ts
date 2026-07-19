import { describe, expect, it } from 'vitest'

import {
  MIGRATION_ERROR_CODES,
  migrationDiagnosticEventSchema,
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
