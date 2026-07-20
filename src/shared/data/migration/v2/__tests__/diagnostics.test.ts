import { describe, expect, expectTypeOf, it } from 'vitest'

import { migrationRendererExportFailurePayloadSchema, migrationRendererExportFailureReportSchema } from '../diagnostics'
import type { MigrationDiagnosticSaveResult } from '../types'

const legalRendererOperations = {
  redux: ['read', 'parse'],
  dexie: ['open', 'read', 'serialize', 'write'],
  local_storage: ['read', 'serialize', 'write'],
  unknown: ['unknown']
} as const

const legalReports = Object.entries(legalRendererOperations).flatMap(([sourceRole, operationRoles]) =>
  operationRoles.map((operationRole) => ({ sourceRole, operationRole }))
)

describe('migrationRendererExportFailureReportSchema', () => {
  it.each(legalReports)('accepts the fixed $sourceRole/$operationRole combination', (report) => {
    expect(migrationRendererExportFailureReportSchema.parse(report)).toEqual(report)
  })

  it.each([
    { sourceRole: 'redux', operationRole: 'open' },
    { sourceRole: 'dexie', operationRole: 'parse' },
    { sourceRole: 'local_storage', operationRole: 'open' },
    { sourceRole: 'unknown', operationRole: 'read' }
  ])('rejects the cross-source $sourceRole/$operationRole combination', (report) => {
    expect(migrationRendererExportFailureReportSchema.safeParse(report).success).toBe(false)
  })

  it('rejects extra fields and free-form source or operation roles', () => {
    expect(
      migrationRendererExportFailureReportSchema.safeParse({
        sourceRole: 'redux',
        operationRole: 'read',
        message: 'private renderer error'
      }).success
    ).toBe(false)
    expect(
      migrationRendererExportFailureReportSchema.safeParse({ sourceRole: 'private-source', operationRole: 'read' })
        .success
    ).toBe(false)
    expect(
      migrationRendererExportFailureReportSchema.safeParse({ sourceRole: 'redux', operationRole: 'private-operation' })
        .success
    ).toBe(false)
  })
})

describe('migrationRendererExportFailurePayloadSchema', () => {
  it('keeps the user-facing message separate from the diagnostic report', () => {
    const payload = {
      message: 'Failed to parse the legacy Redux export',
      report: { sourceRole: 'redux', operationRole: 'parse' }
    } as const

    expect(migrationRendererExportFailurePayloadSchema.parse(payload)).toEqual(payload)
  })

  it.each(['rawError', 'stack', 'path', 'sql'])('rejects the private %s field', (field) => {
    expect(
      migrationRendererExportFailurePayloadSchema.safeParse({
        message: 'Visible error',
        report: { sourceRole: 'redux', operationRole: 'read' },
        [field]: 'privacy-canary'
      }).success
    ).toBe(false)
  })

  it('bounds the UI-only message', () => {
    expect(
      migrationRendererExportFailurePayloadSchema.safeParse({
        message: '',
        report: { sourceRole: 'unknown', operationRole: 'unknown' }
      }).success
    ).toBe(false)
    expect(
      migrationRendererExportFailurePayloadSchema.safeParse({
        message: 'x'.repeat(4_097),
        report: { sourceRole: 'unknown', operationRole: 'unknown' }
      }).success
    ).toBe(false)
  })
})

describe('MigrationDiagnosticSaveResult', () => {
  it('exposes one bundle failure instead of archive/publication internals', () => {
    type Expected =
      | { status: 'canceled' }
      | { status: 'saved' }
      | {
          status: 'failed'
          code: 'dialog_failed' | 'snapshot_failed' | 'bundle_save_failed' | 'save_in_progress'
        }

    expectTypeOf<MigrationDiagnosticSaveResult>().toEqualTypeOf<Expected>()
  })
})
