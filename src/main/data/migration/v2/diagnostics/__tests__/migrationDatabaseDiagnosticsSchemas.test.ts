import { describe, expect, it } from 'vitest'

import {
  EXPECTED_MIGRATION_DATABASE_OBJECTS,
  type MigrationDatabaseColumnCountBucket,
  migrationDatabaseDiagnosticResultSchema,
  migrationDatabaseL0DataSchema,
  migrationDatabaseL0StepSchema,
  type MigrationDatabaseL1Data,
  migrationDatabaseL1DataSchema,
  type MigrationDatabaseL2Data,
  migrationDatabaseL2StepSchema
} from '../migrationDatabaseDiagnosticsSchemas'

function bucketColumnCount(count: number | undefined): MigrationDatabaseColumnCountBucket {
  if (count === undefined) return 'unavailable'
  if (count === 0) return '0'
  if (count <= 5) return '1_to_5'
  if (count <= 10) return '6_to_10'
  if (count <= 20) return '11_to_20'
  if (count <= 40) return '21_to_40'
  return '41_plus'
}

function makeL1Data(): MigrationDatabaseL1Data {
  return {
    metadata: {
      pageSize: '4096',
      encoding: 'utf8',
      userVersionBucket: '0',
      schemaVersionBucket: '1_to_10',
      applicationId: 'unset',
      queryOnly: true
    },
    objects: EXPECTED_MIGRATION_DATABASE_OBJECTS.map((object) => ({
      id: object.id,
      kind: object.kind,
      status: 'ok' as const,
      columnCountBucket: bucketColumnCount('columnCount' in object ? object.columnCount : undefined)
    })),
    unknownObjects: []
  }
}

function makeL2Data(): MigrationDatabaseL2Data {
  return {
    quickCheck: {
      outcome: 'ok',
      issueCountBucket: '0',
      categories: [],
      truncated: false
    },
    foreignKeys: {
      outcome: 'ok',
      scannedCountBucket: '0',
      violations: [],
      truncated: false
    }
  }
}

describe('migration database diagnostic semantic schemas', () => {
  it.each([
    {
      name: 'a missing file that claims to be regular',
      value: {
        exists: false,
        fileKind: 'regular',
        sizeBucket: 'empty',
        mtimeAgeBucket: 'unavailable',
        header: 'insufficient',
        writeMode: 'unavailable',
        walSidecars: 'none'
      }
    },
    {
      name: 'a missing file with a visible header',
      value: {
        exists: false,
        fileKind: 'missing',
        sizeBucket: 'unavailable',
        mtimeAgeBucket: 'unavailable',
        header: 'valid',
        writeMode: 'unavailable',
        walSidecars: 'none'
      }
    },
    {
      name: 'a non-regular file with a byte size',
      value: {
        exists: true,
        fileKind: 'not_regular',
        sizeBucket: '4_kib_to_1_mib',
        mtimeAgeBucket: 'under_1_hour',
        header: 'unavailable',
        writeMode: 'unavailable',
        walSidecars: 'none'
      }
    }
  ])('rejects contradictory L0 data: $name', ({ value }) => {
    expect(migrationDatabaseL0DataSchema.safeParse(value).success).toBe(false)
  })

  it('rejects a WAL write mode when the SQLite header is not valid', () => {
    expect(
      migrationDatabaseL0DataSchema.safeParse({
        exists: true,
        fileKind: 'regular',
        sizeBucket: '4_kib_to_1_mib',
        mtimeAgeBucket: 'under_1_hour',
        header: 'invalid',
        writeMode: 'wal',
        walSidecars: 'complete'
      }).success
    ).toBe(false)
  })

  it.each([
    { level: 'l0', status: 'timed_out', code: 'worker_timeout' },
    { level: 'l0', status: 'failed', code: 'worker_error' }
  ])('rejects host-only terminal state from a worker diagnostic layer: $status/$code', (step) => {
    expect(migrationDatabaseL0StepSchema.safeParse(step).success).toBe(false)
  })

  it('rejects L0 states that the worker cannot produce', () => {
    const validData = {
      exists: true,
      fileKind: 'regular' as const,
      sizeBucket: '4_kib_to_1_mib' as const,
      mtimeAgeBucket: 'under_1_hour' as const,
      header: 'valid' as const,
      writeMode: 'rollback' as const,
      walSidecars: 'none' as const
    }

    expect(migrationDatabaseL0StepSchema.safeParse({ level: 'l0', status: 'truncated', data: validData }).success).toBe(
      false
    )
    expect(
      migrationDatabaseL0DataSchema.safeParse({ ...validData, sizeBucket: 'empty', header: 'valid' }).success
    ).toBe(false)
    expect(migrationDatabaseL0DataSchema.safeParse({ ...validData, writeMode: 'unavailable' }).success).toBe(false)
  })

  it('accepts the complete fixed L1 expected-object set', () => {
    expect(migrationDatabaseL1DataSchema.safeParse(makeL1Data()).success).toBe(true)
  })

  it('rejects an ok L1 table whose column bucket disagrees with the fixed protocol definition', () => {
    const data = makeL1Data()
    const tableIndex = data.objects.findIndex((object) => object.id === 'agent')
    data.objects[tableIndex] = { ...data.objects[tableIndex], columnCountBucket: '1_to_5' }

    expect(migrationDatabaseL1DataSchema.safeParse(data).success).toBe(false)
  })

  it.each([
    {
      name: 'an incomplete expected-object set',
      mutate: (data: MigrationDatabaseL1Data) => data.objects.pop()
    },
    {
      name: 'a duplicate expected-object ID',
      mutate: (data: MigrationDatabaseL1Data) => {
        data.objects[data.objects.length - 1] = { ...data.objects[0] }
      }
    },
    {
      name: 'the wrong fixed kind for an expected object',
      mutate: (data: MigrationDatabaseL1Data) => {
        data.objects[0] = { ...data.objects[0], kind: 'table' }
      }
    },
    {
      name: 'an impossible column mismatch for an index',
      mutate: (data: MigrationDatabaseL1Data) => {
        data.objects[0] = { ...data.objects[0], status: 'column_mismatch', columnCountBucket: '1_to_5' }
      }
    },
    {
      name: 'a duplicate unknown-object kind',
      mutate: (data: MigrationDatabaseL1Data) => {
        data.unknownObjects = [
          { kind: 'table', countBucket: '1' },
          { kind: 'table', countBucket: '2_to_5' }
        ]
      }
    },
    {
      name: 'a zero-count unknown-object summary',
      mutate: (data: MigrationDatabaseL1Data) => {
        data.unknownObjects = [{ kind: 'other', countBucket: '0' }]
      }
    }
  ])('rejects contradictory L1 data: $name', ({ mutate }) => {
    const data = makeL1Data()
    mutate(data)
    expect(migrationDatabaseL1DataSchema.safeParse(data).success).toBe(false)
  })

  it('rejects an unknown-object kind outside the fixed vocabulary', () => {
    const data = makeL1Data() as unknown as Record<string, unknown>
    data.unknownObjects = [{ kind: 'private_table_name', countBucket: '1' }]
    expect(migrationDatabaseL1DataSchema.safeParse(data).success).toBe(false)
  })

  it.each([
    {
      name: 'quick-check ok with a nonzero issue count',
      mutate: (data: MigrationDatabaseL2Data) => {
        data.quickCheck.issueCountBucket = '1'
      }
    },
    {
      name: 'quick-check issues without a category',
      mutate: (data: MigrationDatabaseL2Data) => {
        data.quickCheck.outcome = 'issues'
        data.quickCheck.issueCountBucket = '1'
      }
    },
    {
      name: 'foreign-key ok with a scanned violation',
      mutate: (data: MigrationDatabaseL2Data) => {
        data.foreignKeys.scannedCountBucket = '1'
      }
    },
    {
      name: 'foreign-key violations with a zero scanned count',
      mutate: (data: MigrationDatabaseL2Data) => {
        data.foreignKeys.outcome = 'violations'
        data.foreignKeys.violations = [
          { childObjectId: 'assistant_knowledge_base', parentObjectId: 'assistant', countBucket: '1' }
        ]
      }
    },
    {
      name: 'a duplicate foreign-key object pair',
      mutate: (data: MigrationDatabaseL2Data) => {
        data.foreignKeys.outcome = 'violations'
        data.foreignKeys.scannedCountBucket = '2_to_5'
        data.foreignKeys.violations = [
          { childObjectId: 'assistant_knowledge_base', parentObjectId: 'assistant', countBucket: '1' },
          { childObjectId: 'assistant_knowledge_base', parentObjectId: 'assistant', countBucket: '1' }
        ]
      }
    },
    {
      name: 'a zero-count foreign-key group',
      mutate: (data: MigrationDatabaseL2Data) => {
        data.foreignKeys.outcome = 'violations'
        data.foreignKeys.scannedCountBucket = '1'
        data.foreignKeys.violations = [
          { childObjectId: 'assistant_knowledge_base', parentObjectId: 'assistant', countBucket: '0' }
        ]
      }
    }
  ])('rejects contradictory L2 data: $name', ({ mutate }) => {
    const data = makeL2Data()
    mutate(data)
    expect(migrationDatabaseL2StepSchema.safeParse({ level: 'l2', status: 'success', data }).success).toBe(false)
  })

  it('requires L2 step status to agree with nested truncation', () => {
    const truncatedData = makeL2Data()
    truncatedData.foreignKeys.truncated = true
    expect(
      migrationDatabaseL2StepSchema.safeParse({ level: 'l2', status: 'success', data: truncatedData }).success
    ).toBe(false)
    expect(
      migrationDatabaseL2StepSchema.safeParse({ level: 'l2', status: 'truncated', data: makeL2Data() }).success
    ).toBe(false)
  })

  it('rejects L2 count and truncation states beyond the worker hard limits', () => {
    const quickOverflow = makeL2Data()
    quickOverflow.quickCheck = {
      outcome: 'issues',
      issueCountBucket: '21_to_100',
      categories: ['unknown'],
      truncated: true
    }
    expect(
      migrationDatabaseL2StepSchema.safeParse({ level: 'l2', status: 'truncated', data: quickOverflow }).success
    ).toBe(false)

    const foreignKeyOverflow = makeL2Data()
    foreignKeyOverflow.foreignKeys = {
      outcome: 'violations',
      scannedCountBucket: '257_plus',
      violations: [{ childObjectId: 'unknown', parentObjectId: 'unknown', countBucket: '257_plus' }],
      truncated: true
    }
    expect(
      migrationDatabaseL2StepSchema.safeParse({ level: 'l2', status: 'truncated', data: foreignKeyOverflow }).success
    ).toBe(false)

    const impossibleTruncation = makeL2Data()
    impossibleTruncation.foreignKeys = {
      outcome: 'violations',
      scannedCountBucket: '1',
      violations: [{ childObjectId: 'unknown', parentObjectId: 'unknown', countBucket: '1' }],
      truncated: true
    }
    expect(
      migrationDatabaseL2StepSchema.safeParse({ level: 'l2', status: 'truncated', data: impossibleTruncation }).success
    ).toBe(false)
  })

  it('rejects terminal partial results whose diagnostic layers are not a prefix', () => {
    expect(
      migrationDatabaseDiagnosticResultSchema.safeParse({
        version: 1,
        expectedSchemaVersion: 1,
        completion: { status: 'failed', code: 'worker_error' },
        l1: { level: 'l1', status: 'failed', code: 'query_failed' }
      }).success
    ).toBe(false)
  })
})
