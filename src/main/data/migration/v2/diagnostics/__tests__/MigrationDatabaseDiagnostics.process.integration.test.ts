import { spawn } from 'node:child_process'

import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../migrationDatabaseDiagnosticsChild?modulePath', () => ({ default: '/unused/child.js' }))

import { MigrationDatabaseDiagnostics } from '../MigrationDatabaseDiagnostics'

describe('MigrationDatabaseDiagnostics process containment', () => {
  const dbh = setupTestDatabase()

  it('SIGKILLs a native SQLite hang and keeps the main-process file evidence', async () => {
    const fixture = `${process.cwd()}/src/main/data/migration/v2/diagnostics/__tests__/fixtures/nativeSqliteHangChild.mjs`
    let childKilled = false
    const diagnostics = new MigrationDatabaseDiagnostics({
      timeoutMs: 50,
      createChild: (_modulePath, options) => {
        const child = spawn(process.execPath, [fixture], {
          ...options,
          env: options.env
        })
        child.once('exit', (_code, signal) => {
          childKilled = signal === 'SIGKILL'
        })
        return child
      }
    })

    const result = await diagnostics.inspect(dbh.sqlite.name)

    expect(result).toMatchObject({
      file: { status: 'readable', sqliteHeader: 'valid' },
      sqlite: { status: 'unavailable', reason: 'timeout' }
    })
    await vi.waitFor(() => expect(childKilled).toBe(true))
  })
})
