import { describe, expect, it } from 'vitest'

import { assertMigrationExportWriteSucceeded, MigrationExportWriteError } from '../MigrationExportWriteError'

describe('assertMigrationExportWriteSucceeded', () => {
  it('throws a typed renderer error without losing Main failure details', () => {
    const failure = {
      code: 'export_file_write_failed' as const,
      origin: 'main' as const,
      operation: 'write_export_file' as const,
      targetPath: '/tmp/migration_temp/topics.json',
      error: { name: 'Error', message: 'permission denied', code: 'EACCES' }
    }

    expect(() => assertMigrationExportWriteSucceeded({ ok: false, failure })).toThrowError(MigrationExportWriteError)

    try {
      assertMigrationExportWriteSucceeded({ ok: false, failure })
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationExportWriteError)
      expect((error as MigrationExportWriteError).failure).toBe(failure)
    }
  })

  it('accepts a successful Main write result', () => {
    expect(() => assertMigrationExportWriteSucceeded({ ok: true })).not.toThrow()
  })
})
