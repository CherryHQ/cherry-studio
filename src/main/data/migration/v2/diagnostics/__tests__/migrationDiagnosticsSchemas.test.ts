import { describe, expect, it } from 'vitest'

import { migrationDiagnosticBundleEventSchema } from '../migrationDiagnosticBundleSchemas'
import {
  MIGRATION_ERROR_CODES,
  migrationDiagnosticEventSchema,
  migrationDiagnosticsSessionSchema,
  PAYLOAD_PROFILE_SLOTS,
  PAYLOAD_PROFILE_TARGETS,
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

  it('accepts only bounded error classification metadata', () => {
    expect(
      migrationDiagnosticEventSchema.parse({
        ...validEvent,
        category: 'database_write',
        causeDepth: 4
      })
    ).toEqual({
      ...validEvent,
      category: 'database_write',
      causeDepth: 4
    })
    expect(
      migrationDiagnosticEventSchema.safeParse({ ...validEvent, category: 'dynamic-category', causeDepth: 0 }).success
    ).toBe(false)
    expect(
      migrationDiagnosticEventSchema.safeParse({ ...validEvent, category: 'database_write', causeDepth: 5 }).success
    ).toBe(false)
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
      'process_timeout',
      'renderer_process_gone',
      'renderer_unresponsive',
      'archive_write',
      'upgrade_path_blocked'
    ])
  })

  it.each([
    {
      reason: 'no_version_log',
      currentVersion: '2.0.0',
      previousVersion: null,
      requiredVersion: '1.9.12',
      gatewayVersion: null,
      versionLog: 'missing'
    },
    {
      reason: 'v1_too_old',
      currentVersion: '2.0.0',
      previousVersion: '1.8.0',
      requiredVersion: '1.9.12',
      gatewayVersion: null,
      versionLog: 'present'
    },
    {
      reason: 'v2_gateway_skipped',
      currentVersion: '2.1.0',
      previousVersion: '1.9.12',
      requiredVersion: null,
      gatewayVersion: '2.0.0',
      versionLog: 'present'
    }
  ] as const)('accepts the fixed $reason upgrade-path block context in journal and bundle events', (versionGate) => {
    const marker = {
      ...validEvent,
      scope: 'gate',
      phase: 'validate',
      state: 'unavailable',
      code: 'upgrade_path_blocked',
      versionGate
    } as const

    expect(migrationDiagnosticEventSchema.parse(marker)).toEqual(marker)
    const { attemptId, ...bundleMarker } = marker
    expect(attemptId).toBe(validEvent.attemptId)
    expect(migrationDiagnosticBundleEventSchema.parse(bundleMarker)).toEqual(bundleMarker)
  })

  it.each([
    {
      ...validEvent,
      scope: 'gate',
      phase: 'validate',
      state: 'unavailable',
      code: 'upgrade_path_blocked'
    },
    {
      ...validEvent,
      versionGate: {
        reason: 'no_version_log',
        currentVersion: '2.0.0',
        previousVersion: null,
        requiredVersion: '1.9.12',
        gatewayVersion: null,
        versionLog: 'missing'
      }
    },
    {
      ...validEvent,
      scope: 'gate',
      phase: 'validate',
      state: 'unavailable',
      code: 'upgrade_path_blocked',
      versionGate: {
        reason: 'v1_too_old',
        currentVersion: '2.0.0-beta.1',
        previousVersion: '1.8.0',
        requiredVersion: '1.9.12',
        gatewayVersion: null,
        versionLog: 'present'
      }
    },
    {
      ...validEvent,
      scope: 'gate',
      phase: 'validate',
      state: 'unavailable',
      code: 'upgrade_path_blocked',
      versionGate: {
        reason: 'no_version_log',
        currentVersion: '2.0.0',
        previousVersion: null,
        requiredVersion: '1.9.12',
        gatewayVersion: null,
        versionLog: 'missing',
        path: '/Users/private/version.log'
      }
    }
  ])('rejects malformed or misplaced upgrade-path block context', (candidate) => {
    expect(migrationDiagnosticEventSchema.safeParse(candidate).success).toBe(false)
  })

  it.each(['renderer_process_gone', 'renderer_unresponsive'] as const)(
    'accepts the fixed %s process marker in journal and strict bundle schemas without raw details',
    (code) => {
      const marker = {
        ...validEvent,
        scope: 'gate',
        phase: 'finalize',
        category: 'process',
        code
      } as const
      expect(migrationDiagnosticEventSchema.parse(marker)).toEqual(marker)

      const { attemptId, ...bundleMarker } = marker
      expect(attemptId).toBe(validEvent.attemptId)
      expect(bundleMarker).not.toHaveProperty('attemptId')
      expect(migrationDiagnosticBundleEventSchema.parse(bundleMarker)).toEqual(bundleMarker)
      expect(
        migrationDiagnosticBundleEventSchema.safeParse({
          ...bundleMarker,
          details: { reason: 'crashed', path: '/Users/private', message: 'secret' }
        }).success
      ).toBe(false)
    }
  )

  it('uses fixed real insert fields for payload profiles', () => {
    expect(PAYLOAD_PROFILE_TARGETS).toContain('knowledge_vector_rebuild')
    expect(PAYLOAD_PROFILE_SLOTS).toEqual(
      expect.arrayContaining([
        'data',
        'searchableText',
        'endpointConfigs',
        'apiKeys',
        'providerSettings',
        'rootPath',
        'externalPath',
        'logoKey',
        'group',
        'value',
        'emoji',
        'jobInputTemplate',
        'vectorBlob'
      ])
    )
    expect(PAYLOAD_PROFILE_SLOTS).not.toEqual(
      expect.arrayContaining(['apiHost', 'apiKey', 'config', 'logo', 'negativePrompt', 'title'])
    )
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
