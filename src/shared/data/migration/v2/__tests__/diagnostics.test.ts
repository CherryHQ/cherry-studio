import { describe, expect, it } from 'vitest'

import { migrationRendererExportFailureReportSchema } from '../diagnostics'

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
