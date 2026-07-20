import { describe, expect, it } from 'vitest'

import { migrationDiagnosticBundleEventSchema } from '../migrationDiagnosticBundleSchemas'
import {
  MIGRATION_DIAGNOSTIC_MIGRATOR_IDS,
  MIGRATION_DIAGNOSTICS_SESSION_VERSION,
  MIGRATION_ERROR_CODES,
  migrationDiagnosticEventInputSchema,
  migrationDiagnosticEventSchema,
  migrationDiagnosticsAttemptSchema,
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

const validEventInput = {
  scope: validEvent.scope,
  phase: validEvent.phase,
  state: validEvent.state,
  code: validEvent.code
} as const

const rendererEvidenceCases = [
  { kind: 'renderer_export_failure', sourceRole: 'redux', operationRole: 'read' },
  { kind: 'renderer_export_failure', sourceRole: 'redux', operationRole: 'parse' },
  { kind: 'renderer_export_failure', sourceRole: 'dexie', operationRole: 'open' },
  { kind: 'renderer_export_failure', sourceRole: 'dexie', operationRole: 'read' },
  { kind: 'renderer_export_failure', sourceRole: 'dexie', operationRole: 'serialize' },
  { kind: 'renderer_export_failure', sourceRole: 'dexie', operationRole: 'write' },
  { kind: 'renderer_export_failure', sourceRole: 'local_storage', operationRole: 'read' },
  { kind: 'renderer_export_failure', sourceRole: 'local_storage', operationRole: 'serialize' },
  { kind: 'renderer_export_failure', sourceRole: 'local_storage', operationRole: 'write' },
  { kind: 'renderer_export_failure', sourceRole: 'unknown', operationRole: 'unknown' }
] as const

const rendererExportEvent = {
  ...validEvent,
  scope: 'renderer_export',
  phase: 'finalize',
  state: 'failed',
  code: 'source_parse',
  category: 'source'
} as const

const missingRequiredFieldEvent = {
  ...validEvent,
  scope: 'migrator',
  phase: 'prepare',
  state: 'warning',
  code: 'missing_required_field',
  category: 'source',
  migratorId: 'mcp_server'
} as const

const invalidIdentifierEvent = {
  ...validEvent,
  scope: 'migrator',
  phase: 'execute',
  state: 'failed',
  code: 'invalid_identifier',
  category: 'source',
  migratorId: 'provider_model'
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

  it('allows only production migrator IDs in producer input and fixed unknown in persisted events', () => {
    for (const migratorId of MIGRATION_DIAGNOSTIC_MIGRATOR_IDS) {
      expect(migrationDiagnosticEventInputSchema.safeParse({ ...validEventInput, migratorId }).success).toBe(true)
      expect(migrationDiagnosticEventSchema.safeParse({ ...validEvent, migratorId }).success).toBe(true)
    }
    expect(migrationDiagnosticEventInputSchema.safeParse({ ...validEventInput, migratorId: 'unknown' }).success).toBe(
      false
    )
    expect(
      migrationDiagnosticEventInputSchema.safeParse({ ...validEventInput, migratorId: 'private-user-value' }).success
    ).toBe(false)
    expect(migrationDiagnosticEventSchema.safeParse({ ...validEvent, migratorId: 'unknown' }).success).toBe(true)
    expect(migrationDiagnosticEventSchema.safeParse({ ...validEvent, migratorId: 'private-user-value' }).success).toBe(
      false
    )
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
      'missing_required_field',
      'invalid_identifier',
      'process_timeout',
      'renderer_process_gone',
      'renderer_unresponsive',
      'archive_write',
      'upgrade_path_blocked'
    ])
  })

  it.each(rendererEvidenceCases)(
    'accepts the fixed renderer $sourceRole/$operationRole evidence with source classification',
    (semanticEvidence) => {
      expect(migrationDiagnosticEventSchema.safeParse({ ...rendererExportEvent, semanticEvidence }).success).toBe(true)
    }
  )

  it.each([
    { code: 'permission_denied', category: 'filesystem' },
    { code: 'unknown', category: 'unknown' }
  ] as const)(
    'retains the renderer failure classification $code/$category outside semantic evidence',
    (classification) => {
      const semanticEvidence = rendererEvidenceCases.at(-1)

      expect(
        migrationDiagnosticEventSchema.safeParse({ ...rendererExportEvent, ...classification, semanticEvidence })
          .success
      ).toBe(true)
      expect(semanticEvidence).not.toHaveProperty('failureClass')
    }
  )

  it.each(['1', '2-10', '11+'] as const)(
    'accepts the fixed missing-source-ID evidence with affected count bucket %s',
    (affectedCountBucket) => {
      expect(
        migrationDiagnosticEventSchema.safeParse({
          ...missingRequiredFieldEvent,
          semanticEvidence: {
            kind: 'missing_required_field',
            fieldRole: 'source_id',
            affectedCountBucket
          }
        }).success
      ).toBe(true)
    }
  )

  it.each([
    { identifierRole: 'provider_id', rule: 'empty' },
    { identifierRole: 'provider_id', rule: 'contains_separator' },
    { identifierRole: 'model_id', rule: 'empty' },
    { identifierRole: 'model_id', rule: 'contains_reserved_route_character' }
  ] as const)('accepts the fixed $identifierRole/$rule evidence without a count', (violation) => {
    const semanticEvidence = { kind: 'invalid_identifier', ...violation } as const

    expect(migrationDiagnosticEventSchema.safeParse({ ...invalidIdentifierEvent, semanticEvidence }).success).toBe(true)
    expect(semanticEvidence).not.toHaveProperty('affectedCountBucket')
  })

  it.each([
    { ...rendererExportEvent, phase: 'execute', semanticEvidence: rendererEvidenceCases[0] },
    { ...rendererExportEvent, state: 'warning', semanticEvidence: rendererEvidenceCases[0] },
    { ...rendererExportEvent, scope: 'migrator', semanticEvidence: rendererEvidenceCases[0] },
    {
      ...missingRequiredFieldEvent,
      phase: 'execute',
      semanticEvidence: { kind: 'missing_required_field', fieldRole: 'source_id', affectedCountBucket: '1' }
    },
    {
      ...missingRequiredFieldEvent,
      state: 'failed',
      semanticEvidence: { kind: 'missing_required_field', fieldRole: 'source_id', affectedCountBucket: '1' }
    },
    {
      ...missingRequiredFieldEvent,
      code: 'unknown',
      semanticEvidence: { kind: 'missing_required_field', fieldRole: 'source_id', affectedCountBucket: '1' }
    },
    {
      ...missingRequiredFieldEvent,
      category: 'unknown',
      semanticEvidence: { kind: 'missing_required_field', fieldRole: 'source_id', affectedCountBucket: '1' }
    },
    {
      ...missingRequiredFieldEvent,
      migratorId: 'provider_model',
      semanticEvidence: { kind: 'missing_required_field', fieldRole: 'source_id', affectedCountBucket: '1' }
    },
    {
      ...invalidIdentifierEvent,
      phase: 'prepare',
      semanticEvidence: { kind: 'invalid_identifier', identifierRole: 'provider_id', rule: 'empty' }
    },
    {
      ...invalidIdentifierEvent,
      state: 'warning',
      semanticEvidence: { kind: 'invalid_identifier', identifierRole: 'provider_id', rule: 'empty' }
    },
    {
      ...invalidIdentifierEvent,
      code: 'unknown',
      semanticEvidence: { kind: 'invalid_identifier', identifierRole: 'provider_id', rule: 'empty' }
    },
    {
      ...invalidIdentifierEvent,
      category: 'unknown',
      semanticEvidence: { kind: 'invalid_identifier', identifierRole: 'provider_id', rule: 'empty' }
    },
    {
      ...invalidIdentifierEvent,
      migratorId: 'mcp_server',
      semanticEvidence: { kind: 'invalid_identifier', identifierRole: 'provider_id', rule: 'empty' }
    }
  ])('rejects semantic evidence on an incorrectly bound event', (candidate) => {
    expect(migrationDiagnosticEventSchema.safeParse(candidate).success).toBe(false)
  })

  it.each([rendererExportEvent, missingRequiredFieldEvent, invalidIdentifierEvent])(
    'requires semantic evidence on its fixed evidence event',
    (candidate) => {
      expect(migrationDiagnosticEventSchema.safeParse(candidate).success).toBe(false)
    }
  )

  it.each([
    {
      ...rendererExportEvent,
      semanticEvidence: { kind: 'renderer_export_failure', sourceRole: 'redux', operationRole: 'open' }
    },
    {
      ...missingRequiredFieldEvent,
      semanticEvidence: { kind: 'missing_required_field', fieldRole: 'source_id', affectedCountBucket: '0' }
    },
    {
      ...invalidIdentifierEvent,
      semanticEvidence: {
        kind: 'invalid_identifier',
        identifierRole: 'provider_id',
        rule: 'contains_reserved_route_character'
      }
    },
    {
      ...invalidIdentifierEvent,
      semanticEvidence: {
        kind: 'invalid_identifier',
        identifierRole: 'model_id',
        rule: 'empty',
        affectedCountBucket: '1'
      }
    }
  ])('rejects invalid or expanded semantic evidence', (candidate) => {
    expect(migrationDiagnosticEventSchema.safeParse(candidate).success).toBe(false)
  })

  it('rejects a duplicate renderer failure classification inside semantic evidence', () => {
    expect(
      migrationDiagnosticEventSchema.safeParse({
        ...rendererExportEvent,
        semanticEvidence: {
          ...rendererEvidenceCases[0],
          failureClass: 'source_parse'
        }
      }).success
    ).toBe(false)
  })

  it.each([
    'current',
    'boot_config',
    'legacy_exact',
    'legacy_fuzzy_eligible',
    'legacy_fuzzy_blocked',
    'default',
    'unknown'
  ] as const)('accepts the fixed %s directory-selection role', (directorySelectionRole) => {
    expect(
      migrationDiagnosticEventSchema.safeParse({
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
          directorySelectionRole,
          versionLog: { state: 'missing' }
        }
      }).success
    ).toBe(true)
  })

  it.each([
    {
      reason: 'no_version_log',
      currentVersion: '2.0.0',
      previousVersion: null,
      requiredVersion: '1.9.12',
      gatewayVersion: null,
      directorySelectionRole: 'legacy_exact',
      versionLog: { state: 'missing' }
    },
    {
      reason: 'v1_too_old',
      currentVersion: '2.0.0',
      previousVersion: '1.8.0',
      requiredVersion: '1.9.12',
      gatewayVersion: null,
      directorySelectionRole: 'boot_config',
      versionLog: {
        state: 'parsed',
        validRecordCountBucket: '2+',
        invalidRecordCountBucket: '1'
      }
    },
    {
      reason: 'v2_gateway_skipped',
      currentVersion: '2.1.0',
      previousVersion: '1.9.12',
      requiredVersion: null,
      gatewayVersion: '2.0.0',
      directorySelectionRole: 'legacy_fuzzy_eligible',
      versionLog: { state: 'read_failed' }
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
        directorySelectionRole: 'current',
        versionLog: { state: 'missing' }
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
        directorySelectionRole: 'default',
        versionLog: {
          state: 'parsed',
          validRecordCountBucket: '1',
          invalidRecordCountBucket: '0'
        }
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
        directorySelectionRole: 'legacy_fuzzy_blocked',
        versionLog: { state: 'missing' },
        path: '/Users/private/version.log'
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
        directorySelectionRole: 'private-path-role',
        versionLog: { state: 'missing' }
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
        currentVersion: '2.0.0',
        previousVersion: '1.8.0',
        requiredVersion: '1.9.12',
        gatewayVersion: null,
        directorySelectionRole: 'unknown',
        versionLog: {
          state: 'parsed',
          validRecordCountBucket: '3',
          invalidRecordCountBucket: 'unknown'
        }
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
        directorySelectionRole: 'unknown',
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
        currentVersion: '2.0.0',
        previousVersion: '1.8.0',
        requiredVersion: '1.9.12',
        gatewayVersion: null,
        directorySelectionRole: 'unknown',
        versionLog: { state: 'parsed', validRecordCountBucket: '1' }
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
  version: 2,
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
  it('accepts the strict version-2 session contract', () => {
    expect(MIGRATION_DIAGNOSTICS_SESSION_VERSION).toBe(2)
    expect(migrationDiagnosticsSessionSchema.parse(validSession)).toEqual(validSession)
  })

  it('accepts warning only as a nonterminal event state', () => {
    expect(
      migrationDiagnosticsAttemptSchema.safeParse({
        ...validSession.attempts[0],
        events: [
          {
            ...missingRequiredFieldEvent,
            at: '2026-07-19T10:01:30.000Z',
            semanticEvidence: {
              kind: 'missing_required_field',
              fieldRole: 'source_id',
              affectedCountBucket: '1'
            }
          },
          terminalEvent
        ]
      }).success
    ).toBe(true)
    expect(
      migrationDiagnosticsAttemptSchema.safeParse({
        ...validSession.attempts[0],
        events: [
          {
            ...missingRequiredFieldEvent,
            sequence: 2,
            at: '2026-07-19T10:02:00.000Z',
            semanticEvidence: {
              kind: 'missing_required_field',
              fieldRole: 'source_id',
              affectedCountBucket: '1'
            }
          }
        ]
      }).success
    ).toBe(false)
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
