import { describe, expect, it } from 'vitest'

import {
  getMigrationDiagnosticNoticeParts,
  type MigrationDiagnosticNoticePart,
  type MigrationDiagnosticSavedResult
} from '../diagnostics'

describe('getMigrationDiagnosticNoticeParts', () => {
  it.each<[MigrationDiagnosticSavedResult, readonly MigrationDiagnosticNoticePart[]]>([
    [{ status: 'saved', logs: 'included', size: 'standard' }, ['logs_included', 'not_uploaded']],
    [{ status: 'saved', logs: 'not_included', size: 'standard' }, ['logs_not_included', 'not_uploaded']],
    [{ status: 'saved', logs: 'included', size: 'large' }, ['logs_included', 'large', 'not_uploaded']],
    [{ status: 'saved', logs: 'not_included', size: 'large' }, ['logs_not_included', 'large', 'not_uploaded']]
  ])('returns the ordered notice parts for %o', (result, expected) => {
    expect(getMigrationDiagnosticNoticeParts(result)).toEqual(expected)
  })
})
