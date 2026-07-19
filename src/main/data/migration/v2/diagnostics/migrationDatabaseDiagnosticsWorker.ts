import { closeSync, constants as fsConstants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'

import Database from 'better-sqlite3'

import type {
  MigrationDatabaseColumnCountBucket,
  MigrationDatabaseCountBucket,
  MigrationDatabaseDiagnosticResult,
  MigrationDatabaseDiagnosticStep,
  MigrationDatabaseDiagnosticsWorkerInput,
  MigrationDatabaseDiagnosticsWorkerMessage,
  MigrationDatabaseExpectedObjectId,
  MigrationDatabaseFailureCode,
  MigrationDatabaseL0Data,
  MigrationDatabaseL0Step,
  MigrationDatabaseL1Data,
  MigrationDatabaseL1Step,
  MigrationDatabaseL2Data,
  MigrationDatabaseL2Step,
  MigrationDatabaseUnknownObjectKind,
  MigrationDatabaseWorkerPolicy
} from './migrationDatabaseDiagnosticsSchemas'

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary')
const SQLITE_HEADER_BYTES = SQLITE_HEADER.byteLength
const MAX_SCHEMA_ROWS_SCANNED = 2_048
const QUICK_CHECK_RESULT_LIMIT = 20
const HOUR_MS = 60 * 60 * 1_000
const DAY_MS = 24 * HOUR_MS
const WORKER_POLICY_VERSION = 1
const WORKER_MAX_MESSAGE_BYTES = 65_536
const WORKER_MAX_SCHEMA_OBJECTS = 160
const WORKER_MAX_FOREIGN_KEY_ROWS = 256
const WORKER_MAX_FOREIGN_KEY_GROUPS = 64
const SAFE_OBJECT_NAME = /^[A-Za-z0-9_]+$/

interface SqliteSchemaRow {
  readonly type?: unknown
  readonly name?: unknown
}

interface CountRow {
  readonly count?: unknown
}

interface ForeignKeyRow {
  readonly table?: unknown
  readonly parent?: unknown
}

function getOwnString(value: unknown, property: string): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, property)
  return descriptor && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : undefined
}

function getOwnNumber(value: unknown, property: string): number | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, property)
  return descriptor &&
    'value' in descriptor &&
    typeof descriptor.value === 'number' &&
    Number.isFinite(descriptor.value)
    ? descriptor.value
    : undefined
}

function hasOwnProperty(value: object, property: string): boolean {
  return Object.getOwnPropertyDescriptor(value, property) !== undefined
}

function getOwnValue(value: unknown, property: string): unknown {
  if (value === null || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, property)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function hasOnlyKeys(value: object, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isPositiveInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
}

function validateWorkerInput(value: unknown): MigrationDatabaseDiagnosticsWorkerInput | undefined {
  try {
    if (value === null || typeof value !== 'object' || !hasOnlyKeys(value, ['databaseFile', 'policy'])) {
      return undefined
    }
    const databaseFile = getOwnString(value, 'databaseFile')
    const rawPolicy = getOwnValue(value, 'policy')
    if (
      databaseFile === undefined ||
      databaseFile.length === 0 ||
      databaseFile.length > 32_768 ||
      rawPolicy === null ||
      typeof rawPolicy !== 'object' ||
      !hasOnlyKeys(rawPolicy, [
        'version',
        'expectedSchemaVersion',
        'maxMessageBytes',
        'maxSchemaObjects',
        'maxForeignKeyRows',
        'maxForeignKeyGroups',
        'expectedObjects'
      ])
    ) {
      return undefined
    }

    const version = getOwnNumber(rawPolicy, 'version')
    const expectedSchemaVersion = getOwnNumber(rawPolicy, 'expectedSchemaVersion')
    const maxMessageBytes = getOwnNumber(rawPolicy, 'maxMessageBytes')
    const maxSchemaObjects = getOwnNumber(rawPolicy, 'maxSchemaObjects')
    const maxForeignKeyRows = getOwnNumber(rawPolicy, 'maxForeignKeyRows')
    const maxForeignKeyGroups = getOwnNumber(rawPolicy, 'maxForeignKeyGroups')
    const rawExpectedObjects = getOwnValue(rawPolicy, 'expectedObjects')
    if (
      version !== WORKER_POLICY_VERSION ||
      expectedSchemaVersion !== WORKER_POLICY_VERSION ||
      !isPositiveInteger(maxMessageBytes) ||
      !isPositiveInteger(maxSchemaObjects) ||
      !isPositiveInteger(maxForeignKeyRows) ||
      !isPositiveInteger(maxForeignKeyGroups) ||
      !Array.isArray(rawExpectedObjects)
    ) {
      return undefined
    }

    const clampedMaxMessageBytes = Math.min(maxMessageBytes, WORKER_MAX_MESSAGE_BYTES)
    const clampedMaxSchemaObjects = Math.min(maxSchemaObjects, WORKER_MAX_SCHEMA_OBJECTS)
    const clampedMaxForeignKeyRows = Math.min(maxForeignKeyRows, WORKER_MAX_FOREIGN_KEY_ROWS)
    const clampedMaxForeignKeyGroups = Math.min(maxForeignKeyGroups, WORKER_MAX_FOREIGN_KEY_GROUPS)
    if (rawExpectedObjects.length === 0 || rawExpectedObjects.length > clampedMaxSchemaObjects) return undefined

    const ids = new Set<string>()
    const names = new Set<string>()
    const expectedObjects: MigrationDatabaseWorkerPolicy['expectedObjects'] = []
    for (const rawObject of rawExpectedObjects) {
      if (
        rawObject === null ||
        typeof rawObject !== 'object' ||
        !hasOnlyKeys(rawObject, ['id', 'name', 'kind', 'columnCount'])
      ) {
        return undefined
      }
      const id = getOwnString(rawObject, 'id')
      const explicitName = getOwnString(rawObject, 'name')
      const kind = getOwnString(rawObject, 'kind')
      const columnCount = getOwnNumber(rawObject, 'columnCount')
      const hasExplicitName = hasOwnProperty(rawObject, 'name')
      const hasColumnCount = hasOwnProperty(rawObject, 'columnCount')
      if (
        id === undefined ||
        id.length === 0 ||
        id.length > 128 ||
        !SAFE_OBJECT_NAME.test(id) ||
        (hasExplicitName && explicitName === undefined) ||
        (explicitName !== undefined &&
          (explicitName.length === 0 || explicitName.length > 128 || !SAFE_OBJECT_NAME.test(explicitName))) ||
        (hasColumnCount && columnCount === undefined) ||
        (kind !== 'table' && kind !== 'index' && kind !== 'trigger' && kind !== 'view') ||
        ((kind === 'table' || kind === 'view') &&
          (columnCount === undefined || !Number.isSafeInteger(columnCount) || columnCount < 0 || columnCount > 512)) ||
        ((kind === 'index' || kind === 'trigger') && columnCount !== undefined)
      ) {
        return undefined
      }
      const schemaName = explicitName ?? id
      if (ids.has(id) || names.has(schemaName)) return undefined
      ids.add(id)
      names.add(schemaName)
      expectedObjects.push({
        id: id as MigrationDatabaseExpectedObjectId,
        ...(explicitName === undefined ? {} : { name: explicitName }),
        kind,
        ...(columnCount === undefined ? {} : { columnCount })
      })
    }

    return {
      databaseFile,
      policy: {
        version: WORKER_POLICY_VERSION,
        expectedSchemaVersion: WORKER_POLICY_VERSION,
        maxMessageBytes: clampedMaxMessageBytes as MigrationDatabaseWorkerPolicy['maxMessageBytes'],
        maxSchemaObjects: clampedMaxSchemaObjects as MigrationDatabaseWorkerPolicy['maxSchemaObjects'],
        maxForeignKeyRows: clampedMaxForeignKeyRows as MigrationDatabaseWorkerPolicy['maxForeignKeyRows'],
        maxForeignKeyGroups: clampedMaxForeignKeyGroups as MigrationDatabaseWorkerPolicy['maxForeignKeyGroups'],
        expectedObjects
      }
    }
  } catch {
    return undefined
  }
}

function getErrorCode(error: unknown): string | undefined {
  return getOwnString(error, 'code')
}

function mapErrorCode(error: unknown, fallback: MigrationDatabaseFailureCode): MigrationDatabaseFailureCode {
  const code = getErrorCode(error)
  if (code === 'EACCES' || code === 'EPERM' || code === 'SQLITE_READONLY') return 'permission_denied'
  if (code === 'SQLITE_NOTADB') return 'not_database'
  if (code === 'SQLITE_CANTOPEN' || code === 'ENOENT') return 'open_failed'
  return fallback
}

function bucketCount(count: number): MigrationDatabaseCountBucket {
  if (count <= 0) return '0'
  if (count === 1) return '1'
  if (count <= 5) return '2_to_5'
  if (count <= 20) return '6_to_20'
  if (count <= 100) return '21_to_100'
  if (count <= 256) return '101_to_256'
  return '257_plus'
}

function bucketColumnCount(count: number | undefined): MigrationDatabaseColumnCountBucket {
  if (count === undefined) return 'unavailable'
  if (count <= 0) return '0'
  if (count <= 5) return '1_to_5'
  if (count <= 10) return '6_to_10'
  if (count <= 20) return '11_to_20'
  if (count <= 40) return '21_to_40'
  return '41_plus'
}

function bucketInteger(value: unknown): MigrationDatabaseL1Data['metadata']['userVersionBucket'] {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  if (number === 0) return '0'
  if (number <= 10) return '1_to_10'
  if (number <= 100) return '11_to_100'
  if (number <= 1_000) return '101_to_1000'
  return '1001_plus'
}

function bucketSize(size: number): MigrationDatabaseL0Data['sizeBucket'] {
  if (size <= 0) return 'empty'
  if (size < 4 * 1_024) return 'under_4_kib'
  if (size < 1_024 * 1_024) return '4_kib_to_1_mib'
  if (size < 16 * 1_024 * 1_024) return '1_mib_to_16_mib'
  if (size < 128 * 1_024 * 1_024) return '16_mib_to_128_mib'
  if (size < 1_024 * 1_024 * 1_024) return '128_mib_to_1_gib'
  return 'over_1_gib'
}

function bucketMtime(mtimeMs: number, nowMs: number): MigrationDatabaseL0Data['mtimeAgeBucket'] {
  if (!Number.isFinite(mtimeMs)) return 'unavailable'
  const ageMs = nowMs - mtimeMs
  if (ageMs < 0) return 'future'
  if (ageMs < HOUR_MS) return 'under_1_hour'
  if (ageMs < DAY_MS) return '1_to_24_hours'
  if (ageMs <= 7 * DAY_MS) return '1_to_7_days'
  if (ageMs <= 30 * DAY_MS) return '8_to_30_days'
  if (ageMs <= 365 * DAY_MS) return '31_to_365_days'
  return 'over_365_days'
}

function inspectFile(databaseFile: string): MigrationDatabaseL0Step {
  let stats
  try {
    stats = lstatSync(databaseFile)
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') {
      return {
        level: 'l0',
        status: 'success',
        data: {
          exists: false,
          fileKind: 'missing',
          sizeBucket: 'unavailable',
          mtimeAgeBucket: 'unavailable',
          header: 'unavailable'
        }
      }
    }
    return { level: 'l0', status: 'failed', code: mapErrorCode(error, 'read_failed') }
  }

  if (!stats.isFile()) {
    return {
      level: 'l0',
      status: 'success',
      data: {
        exists: true,
        fileKind: 'not_regular',
        sizeBucket: 'unavailable',
        mtimeAgeBucket: bucketMtime(stats.mtimeMs, Date.now()),
        header: 'unavailable'
      }
    }
  }

  const data: MigrationDatabaseL0Data = {
    exists: true,
    fileKind: 'regular',
    sizeBucket: bucketSize(stats.size),
    mtimeAgeBucket: bucketMtime(stats.mtimeMs, Date.now()),
    header: stats.size < SQLITE_HEADER_BYTES ? 'insufficient' : 'unavailable'
  }
  if (stats.size < SQLITE_HEADER_BYTES) return { level: 'l0', status: 'success', data }

  let descriptor: number | undefined
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0
    descriptor = openSync(databaseFile, fsConstants.O_RDONLY | noFollow)
    if (!fstatSync(descriptor).isFile()) {
      return {
        level: 'l0',
        status: 'success',
        data: { ...data, fileKind: 'not_regular', sizeBucket: 'unavailable', header: 'unavailable' }
      }
    }
    const header = Buffer.alloc(SQLITE_HEADER_BYTES)
    const bytesRead = readSync(descriptor, header, 0, SQLITE_HEADER_BYTES, 0)
    data.header = bytesRead < SQLITE_HEADER_BYTES ? 'insufficient' : header.equals(SQLITE_HEADER) ? 'valid' : 'invalid'
    return { level: 'l0', status: 'success', data }
  } catch (error) {
    return { level: 'l0', status: 'failed', code: mapErrorCode(error, 'read_failed'), data }
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        // The bounded header read is already complete; close is best-effort here.
      }
    }
  }
}

function blockedDatabaseCode(l0: MigrationDatabaseL0Step): MigrationDatabaseFailureCode | undefined {
  if (l0.status === 'failed') return l0.code
  if (l0.status === 'timed_out') return 'worker_timeout'
  if (l0.data.fileKind === 'missing') return 'open_failed'
  if (l0.data.fileKind !== 'regular') return 'not_regular_file'
  if (l0.data.header !== 'valid') return 'not_database'
  return undefined
}

function pageSizeValue(value: unknown): MigrationDatabaseL1Data['metadata']['pageSize'] {
  const normalized = String(typeof value === 'number' ? Math.floor(value) : '')
  return ['512', '1024', '2048', '4096', '8192', '16384', '32768', '65536'].includes(normalized)
    ? (normalized as MigrationDatabaseL1Data['metadata']['pageSize'])
    : 'other'
}

function encodingValue(value: unknown): MigrationDatabaseL1Data['metadata']['encoding'] {
  if (typeof value !== 'string') return 'other'
  const normalized = value.toLowerCase().replaceAll('-', '')
  if (normalized === 'utf8') return 'utf8'
  if (normalized === 'utf16le') return 'utf16le'
  if (normalized === 'utf16be') return 'utf16be'
  return 'other'
}

function normalizeObjectKind(value: unknown): MigrationDatabaseUnknownObjectKind {
  if (value === 'table' || value === 'index' || value === 'trigger' || value === 'view') return value
  return 'other'
}

function inspectStructure(
  database: Database.Database,
  policy: MigrationDatabaseWorkerPolicy,
  expectedObjectsByName: ReadonlyMap<string, MigrationDatabaseExpectedObjectId>
): MigrationDatabaseL1Step {
  try {
    const queryOnly = Number(database.pragma('query_only', { simple: true })) === 1
    if (!queryOnly) return { level: 'l1', status: 'failed', code: 'query_failed' }

    const findObject = database.prepare('SELECT type FROM sqlite_schema WHERE name = ? LIMIT 1')
    const countColumns = database.prepare('SELECT count(*) AS count FROM pragma_table_xinfo(?)')
    const objects: MigrationDatabaseL1Data['objects'] = policy.expectedObjects.map((expected) => {
      const schemaName = 'name' in expected ? expected.name : expected.id
      const row = findObject.get(schemaName) as SqliteSchemaRow | undefined
      const actualKind = getOwnString(row, 'type')
      const hasColumns = 'columnCount' in expected
      const columnCount =
        actualKind === expected.kind && hasColumns
          ? getOwnNumber(countColumns.get(schemaName) as CountRow | undefined, 'count')
          : undefined
      const status =
        actualKind === undefined
          ? 'missing'
          : actualKind !== expected.kind
            ? 'type_mismatch'
            : hasColumns && columnCount !== expected.columnCount
              ? 'column_mismatch'
              : 'ok'
      return {
        id: expected.id,
        kind: expected.kind,
        status,
        columnCountBucket: bucketColumnCount(columnCount)
      }
    })

    const unknownCounts = new Map<MigrationDatabaseUnknownObjectKind, number>()
    let scanned = 0
    let truncated = false
    const schemaRows = database
      .prepare("SELECT type, name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
      .iterate() as Iterable<SqliteSchemaRow>
    for (const row of schemaRows) {
      scanned += 1
      if (scanned > MAX_SCHEMA_ROWS_SCANNED) {
        truncated = true
        break
      }
      const name = getOwnString(row, 'name')
      if (name !== undefined && expectedObjectsByName.has(name)) continue
      const kind = normalizeObjectKind(getOwnString(row, 'type'))
      unknownCounts.set(kind, (unknownCounts.get(kind) ?? 0) + 1)
    }

    const unknownObjects = Array.from(unknownCounts.entries(), ([kind, count]) => ({
      kind,
      countBucket: bucketCount(count)
    }))
    const data: MigrationDatabaseL1Data = {
      metadata: {
        pageSize: pageSizeValue(database.pragma('page_size', { simple: true })),
        encoding: encodingValue(database.pragma('encoding', { simple: true })),
        userVersionBucket: bucketInteger(database.pragma('user_version', { simple: true })),
        schemaVersionBucket: bucketInteger(database.pragma('schema_version', { simple: true })),
        applicationId: Number(database.pragma('application_id', { simple: true })) === 0 ? 'unset' : 'set',
        queryOnly: true
      },
      objects,
      unknownObjects
    }
    return { level: 'l1', status: truncated ? 'truncated' : 'success', data }
  } catch (error) {
    return { level: 'l1', status: 'failed', code: mapErrorCode(error, 'query_failed') }
  }
}

function quickCheckCategory(value: string): MigrationDatabaseL2Data['quickCheck']['categories'][number] {
  const normalized = value.toLowerCase()
  if (normalized.includes('btree')) return 'btree'
  if (normalized.includes('freelist')) return 'freelist'
  if (normalized.includes('page')) return 'page'
  if (normalized.includes('index')) return 'index'
  if (normalized.includes('utf') || normalized.includes('encoding')) return 'encoding'
  if (normalized.includes('constraint') || normalized.includes('not null') || normalized.includes('unique')) {
    return 'constraint'
  }
  return 'unknown'
}

function knownObjectId(
  value: unknown,
  expectedObjectsByName: ReadonlyMap<string, MigrationDatabaseExpectedObjectId>
): MigrationDatabaseExpectedObjectId | 'unknown' {
  return typeof value === 'string' ? (expectedObjectsByName.get(value) ?? 'unknown') : 'unknown'
}

function inspectIntegrity(
  database: Database.Database,
  policy: MigrationDatabaseWorkerPolicy,
  expectedObjectsByName: ReadonlyMap<string, MigrationDatabaseExpectedObjectId>
): MigrationDatabaseL2Step {
  try {
    const quickCategories = new Set<MigrationDatabaseL2Data['quickCheck']['categories'][number]>()
    let quickIssueCount = 0
    const quickRows = database.prepare(`PRAGMA quick_check(${QUICK_CHECK_RESULT_LIMIT})`).iterate() as Iterable<unknown>
    for (const row of quickRows) {
      const value = getOwnString(row, 'quick_check')
      if (value === 'ok' && quickIssueCount === 0) continue
      quickIssueCount += 1
      quickCategories.add(value === undefined ? 'unknown' : quickCheckCategory(value))
    }
    const quickTruncated = quickIssueCount >= QUICK_CHECK_RESULT_LIMIT

    const foreignKeyGroups = new Map<
      string,
      {
        childObjectId: MigrationDatabaseExpectedObjectId | 'unknown'
        parentObjectId: MigrationDatabaseExpectedObjectId | 'unknown'
        count: number
      }
    >()
    let foreignKeyRowsScanned = 0
    let foreignKeysTruncated = false
    const foreignKeyRows = database.prepare('PRAGMA foreign_key_check').iterate() as Iterable<ForeignKeyRow>
    for (const row of foreignKeyRows) {
      if (foreignKeyRowsScanned >= policy.maxForeignKeyRows) {
        foreignKeysTruncated = true
        foreignKeyRowsScanned += 1
        break
      }
      foreignKeyRowsScanned += 1
      const childObjectId = knownObjectId(getOwnString(row, 'table'), expectedObjectsByName)
      const parentObjectId = knownObjectId(getOwnString(row, 'parent'), expectedObjectsByName)
      const key = `${childObjectId}\0${parentObjectId}`
      const current = foreignKeyGroups.get(key)
      if (current) current.count += 1
      else if (foreignKeyGroups.size < policy.maxForeignKeyGroups) {
        foreignKeyGroups.set(key, { childObjectId, parentObjectId, count: 1 })
      } else {
        foreignKeysTruncated = true
      }
    }

    const data: MigrationDatabaseL2Data = {
      quickCheck: {
        outcome: quickIssueCount === 0 ? 'ok' : 'issues',
        issueCountBucket: bucketCount(quickIssueCount),
        categories: Array.from(quickCategories),
        truncated: quickTruncated
      },
      foreignKeys: {
        outcome: foreignKeyRowsScanned === 0 ? 'ok' : 'violations',
        scannedCountBucket: bucketCount(foreignKeyRowsScanned),
        violations: Array.from(foreignKeyGroups.values(), (group) => ({
          childObjectId: group.childObjectId,
          parentObjectId: group.parentObjectId,
          countBucket: bucketCount(group.count)
        })),
        truncated: foreignKeysTruncated
      }
    }
    return {
      level: 'l2',
      status: quickTruncated || foreignKeysTruncated ? 'truncated' : 'success',
      data
    }
  } catch (error) {
    return { level: 'l2', status: 'failed', code: mapErrorCode(error, 'query_failed') }
  }
}

function failedStep<TLevel extends 'l0' | 'l1' | 'l2'>(
  level: TLevel,
  code: MigrationDatabaseFailureCode
): Extract<MigrationDatabaseDiagnosticStep, { level: TLevel }> {
  return { level, status: 'failed', code } as Extract<MigrationDatabaseDiagnosticStep, { level: TLevel }>
}

function messageBytes(message: MigrationDatabaseDiagnosticsWorkerMessage): number {
  return Buffer.byteLength(JSON.stringify(message), 'utf8')
}

function postMessage(message: MigrationDatabaseDiagnosticsWorkerMessage, maxMessageBytes: number): void {
  if (!parentPort) throw new Error('Migration database diagnostics worker requires a parent port')
  if (messageBytes(message) > maxMessageBytes) {
    throw new Error('Migration database diagnostics worker message exceeded its fixed budget')
  }
  parentPort.postMessage(message)
}

function postStep(step: MigrationDatabaseDiagnosticStep, maxMessageBytes: number): void {
  postMessage({ type: 'step', step }, maxMessageBytes)
}

function runDiagnostics(): void {
  const input = validateWorkerInput(workerData)
  let database: Database.Database | undefined
  let l0: MigrationDatabaseL0Step
  let l1: MigrationDatabaseL1Step
  let l2: MigrationDatabaseL2Step

  if (input === undefined) {
    l0 = failedStep('l0', 'invalid_input')
    l1 = failedStep('l1', 'invalid_input')
    l2 = failedStep('l2', 'invalid_input')
    postStep(l0, WORKER_MAX_MESSAGE_BYTES)
    postStep(l1, WORKER_MAX_MESSAGE_BYTES)
    postStep(l2, WORKER_MAX_MESSAGE_BYTES)
    postMessage(
      {
        type: 'result',
        result: {
          version: WORKER_POLICY_VERSION,
          expectedSchemaVersion: WORKER_POLICY_VERSION,
          l0,
          l1,
          l2
        }
      },
      WORKER_MAX_MESSAGE_BYTES
    )
    return
  } else {
    const { policy } = input
    const expectedObjectsByName = new Map<string, MigrationDatabaseExpectedObjectId>(
      policy.expectedObjects.map((object) => ['name' in object ? (object.name ?? object.id) : object.id, object.id])
    )
    l0 = inspectFile(input.databaseFile)
    postStep(l0, policy.maxMessageBytes)
    const blockedCode = blockedDatabaseCode(l0)
    if (blockedCode !== undefined) {
      l1 = failedStep('l1', blockedCode)
      l2 = failedStep('l2', blockedCode)
      postStep(l1, policy.maxMessageBytes)
      postStep(l2, policy.maxMessageBytes)
    } else {
      try {
        database = new Database(input.databaseFile, { readonly: true, fileMustExist: true })
        database.pragma('query_only = ON')
        l1 = inspectStructure(database, policy, expectedObjectsByName)
        postStep(l1, policy.maxMessageBytes)
        l2 = inspectIntegrity(database, policy, expectedObjectsByName)
        postStep(l2, policy.maxMessageBytes)
      } catch (error) {
        const code = mapErrorCode(error, 'open_failed')
        l1 = failedStep('l1', code)
        l2 = failedStep('l2', code)
        postStep(l1, policy.maxMessageBytes)
        postStep(l2, policy.maxMessageBytes)
      } finally {
        if (database?.open) database.close()
      }
    }

    const result: MigrationDatabaseDiagnosticResult = {
      version: policy.version,
      expectedSchemaVersion: policy.expectedSchemaVersion,
      l0,
      l1,
      l2
    }
    postMessage({ type: 'result', result }, policy.maxMessageBytes)
  }
}

if (!isMainThread) {
  try {
    runDiagnostics()
  } catch {
    // Never emit the caught Error. A clean exit without a final message is a
    // fixed worker_no_result at the host boundary and preserves prior steps.
  }
}
