import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ZipArchive } from 'archiver'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MIGRATION_DATABASE_OBJECT_DEFINITIONS } from '../migrationDatabaseDiagnosticsSchemas'
import { MigrationDiagnosticBundleBuilder } from '../MigrationDiagnosticBundleBuilder'
import type { MigrationDiagnosticsSnapshot } from '../migrationDiagnosticsSchemas'

let testDir = ''

const snapshot: MigrationDiagnosticsSnapshot = {
  formatVersion: 1,
  app: { version: '2.0.0', platform: 'linux', arch: 'x64' },
  state: 'completed',
  current: {
    trigger: 'manual_retry',
    status: 'completed',
    startedAt: '2026-07-21T08:00:00.000Z',
    endedAt: '2026-07-21T08:01:00.000Z',
    lastLocation: { scope: 'engine', phase: 'finalize' }
  }
}

const database = {
  file: {
    status: 'readable' as const,
    sizeBucket: '4096-1m' as const,
    sqliteHeader: 'valid' as const,
    walPresent: false,
    shmPresent: false
  },
  sqlite: {
    status: 'available' as const,
    quickCheck: 'ok' as const,
    foreignKeyViolationCountBucket: '1' as const,
    objects: MIGRATION_DATABASE_OBJECT_DEFINITIONS.map(({ role, table }) => ({
      role,
      tableName: table,
      status: 'present' as const
    }))
  }
}

function destination(name = 'diagnostics.zip'): string {
  return path.join(testDir, name)
}

function tempResidue(): string[] {
  return readdirSync(testDir).filter((name) => name.includes('.tmp-'))
}

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), 'cs-migration-diagnostic-zip-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(testDir, { recursive: true, force: true })
})

describe('MigrationDiagnosticBundleBuilder real ZIP publication', () => {
  it('keeps an existing destination unchanged when archive finalization fails', async () => {
    writeFileSync(destination(), 'original')
    vi.spyOn(ZipArchive.prototype, 'finalize').mockRejectedValueOnce(new Error('archive canary'))

    await expect(
      new MigrationDiagnosticBundleBuilder().save({
        destination: destination(),
        snapshot,
        collectDatabaseDiagnostics: async () => database
      })
    ).resolves.toEqual({ status: 'failed', code: 'bundle_save_failed' })

    expect(readFileSync(destination(), 'utf8')).toBe('original')
    expect(tempResidue()).toEqual([])
  })

  it('does not publish or leave temporary output when the atomic stream cannot open', async () => {
    const missingParentDestination = path.join(testDir, 'missing', 'diagnostics.zip')

    await expect(
      new MigrationDiagnosticBundleBuilder().save({
        destination: missingParentDestination,
        snapshot,
        collectDatabaseDiagnostics: async () => database
      })
    ).resolves.toEqual({ status: 'failed', code: 'bundle_save_failed' })

    expect(existsSync(missingParentDestination)).toBe(false)
    expect(tempResidue()).toEqual([])
  })
})
