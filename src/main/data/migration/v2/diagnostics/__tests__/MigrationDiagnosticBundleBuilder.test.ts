import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MIGRATION_DATABASE_OBJECT_DEFINITIONS } from '../migrationDatabaseDiagnosticsSchemas'
import {
  MIGRATION_DIAGNOSTIC_BUNDLE_ENTRIES,
  MIGRATION_DIAGNOSTIC_BUNDLE_LIMIT_BYTES,
  MigrationDiagnosticBundleBuilder
} from '../MigrationDiagnosticBundleBuilder'
import { migrationDiagnosticBundleDocumentSchema } from '../migrationDiagnosticBundleSchemas'
import type { MigrationDiagnosticsSnapshot } from '../migrationDiagnosticsSchemas'

const PRIVACY_CANARIES = [
  'PRIVATE_PATH_CANARY',
  'RAW_ERROR_CANARY',
  'STACK_CANARY',
  'SQL_CANARY',
  'TOKEN_CANARY',
  'RECORD_ID_CANARY'
] as const

let testDir = ''

function destination(name = 'diagnostics.zip'): string {
  return path.join(testDir, name)
}

function failedSnapshot(): MigrationDiagnosticsSnapshot {
  return {
    formatVersion: 1,
    app: { version: '2.0.0', platform: 'darwin', arch: 'arm64' },
    state: 'failed',
    current: {
      trigger: 'initial',
      status: 'failed',
      startedAt: '2026-07-21T08:00:00.000Z',
      endedAt: '2026-07-21T08:01:00.000Z',
      lastLocation: { scope: 'migrator', phase: 'execute', migratorId: 'chat' },
      failure: {
        kind: 'migration_write_failed',
        scope: 'migrator',
        phase: 'execute',
        migratorId: 'chat',
        errorCode: 'sqlite_too_big',
        evidence: {
          kind: 'failed_write',
          truncated: false,
          values: [
            {
              role: 'json_value',
              kind: 'json',
              byteLength: 262_145,
              byteLengthBucket: '262145+'
            }
          ]
        }
      }
    }
  }
}

function databaseDiagnostics() {
  return {
    file: {
      status: 'readable' as const,
      sizeBucket: '1m-100m' as const,
      sqliteHeader: 'valid' as const,
      walPresent: true,
      shmPresent: true
    },
    sqlite: {
      status: 'available' as const,
      quickCheck: 'ok' as const,
      foreignKeyViolationCountBucket: '0' as const,
      objects: MIGRATION_DATABASE_OBJECT_DEFINITIONS.map(({ role, table }) => ({
        role,
        tableName: table,
        status: 'present' as const
      }))
    }
  }
}

async function readArchive(file: string): Promise<Map<string, Buffer>> {
  const zip = new StreamZip.async({ file })
  try {
    const entries = await zip.entries()
    const result = new Map<string, Buffer>()
    for (const name of Object.keys(entries)) result.set(name, await zip.entryData(name))
    return result
  } finally {
    await zip.close()
  }
}

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), 'cs-migration-diagnostic-bundle-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(testDir, { recursive: true, force: true })
})

describe('MigrationDiagnosticBundleBuilder two-entry contract', () => {
  it('writes exactly one strict JSON document followed by the support README', async () => {
    const result = await new MigrationDiagnosticBundleBuilder({
      clock: () => new Date('2026-07-21T08:02:00.000Z')
    }).save({
      destination: destination(),
      snapshot: failedSnapshot(),
      collectDatabaseDiagnostics: async () => databaseDiagnostics()
    })

    expect(result).toMatchObject({ status: 'saved' })
    const entries = await readArchive(destination())
    expect([...entries.keys()]).toEqual([...MIGRATION_DIAGNOSTIC_BUNDLE_ENTRIES])

    const json = entries.get('migration-diagnostics.json')?.toString('utf8') ?? ''
    expect(json).toContain('\n  "formatVersion"')
    expect(json.endsWith('\n')).toBe(true)

    const document = migrationDiagnosticBundleDocumentSchema.parse(JSON.parse(json))
    expect(document).toMatchObject({
      formatVersion: 1,
      generatedAt: '2026-07-21T08:02:00.000Z',
      state: 'failed',
      current: { status: 'failed', failure: { errorCode: 'sqlite_too_big' } },
      database: { sqlite: { status: 'available', quickCheck: 'ok' } }
    })
    expect(document).not.toHaveProperty('manifest')
    expect(document).not.toHaveProperty('events')

    const readme = entries.get('README.txt')?.toString('utf8') ?? ''
    expect(readme).toMatch(/raw errors.*stacks.*SQL.*credentials.*paths.*user content/is)
    expect(readme).toMatch(/manually attach/is)
    expect(readme).toMatch(/not automatically upload/is)
    expect(readme).toMatch(/database diagnostics.*unavailable.*child/is)
    expect(readme).toContain('Cherry Studio 迁移诊断')
    expect(readme).toMatch(/此 ZIP 包含.*migration-diagnostics\.json.*README\.txt/is)
    expect(readme).toMatch(
      /不包含数据库文件.*应用日志.*业务数据.*原始错误.*堆栈.*SQL.*凭据.*路径.*记录标识符.*令牌.*用户内容/is
    )
    expect(readme).toMatch(/数据库诊断.*不可用.*子进程/is)
    expect(readme).toMatch(/手动附加.*不会自动上传/is)

    const uncompressedBytes = [...entries.values()].reduce((sum, entry) => sum + entry.byteLength, 0)
    expect(uncompressedBytes).toBeLessThanOrEqual(MIGRATION_DIAGNOSTIC_BUNDLE_LIMIT_BYTES)
    expect(result).toEqual({ status: 'saved', uncompressedBytes })
  })

  it('fails closed on a strict snapshot violation before collecting database facts or creating a file', async () => {
    const collectDatabaseDiagnostics = vi.fn(async () => databaseDiagnostics())
    const snapshot = { ...failedSnapshot(), rawError: 'RAW_ERROR_CANARY' } as never

    await expect(
      new MigrationDiagnosticBundleBuilder().save({
        destination: destination(),
        snapshot,
        collectDatabaseDiagnostics
      })
    ).resolves.toEqual({ status: 'failed', code: 'bundle_save_failed' })

    expect(collectDatabaseDiagnostics).not.toHaveBeenCalled()
    expect(existsSync(destination())).toBe(false)
  })

  it('never serializes rejected fields, collector errors, or test-only causes', async () => {
    const snapshot = failedSnapshot()
    const failure = snapshot.current?.status === 'failed' ? snapshot.current.failure : {}
    Object.defineProperty(failure, 'testOnlyCause', {
      value: new Error(PRIVACY_CANARIES.join(' ')),
      enumerable: false
    })

    const result = await new MigrationDiagnosticBundleBuilder().save({
      destination: destination(),
      snapshot,
      collectDatabaseDiagnostics: async () => {
        throw new Error(PRIVACY_CANARIES.join(' '))
      }
    })

    expect(result.status).toBe('saved')
    const entries = await readArchive(destination())
    const serialized = Buffer.concat([...entries.values()]).toString('utf8')
    for (const canary of PRIVACY_CANARIES) expect(serialized).not.toContain(canary)
    const document = migrationDiagnosticBundleDocumentSchema.parse(
      JSON.parse(entries.get('migration-diagnostics.json')?.toString('utf8') ?? '')
    )
    expect(document.database.sqlite).toEqual({ status: 'unavailable', reason: 'not_attempted' })
  })
})
