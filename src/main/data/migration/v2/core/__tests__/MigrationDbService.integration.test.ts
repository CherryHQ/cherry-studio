import { existsSync, lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MigrationDbService } from '../MigrationDbService'
import type { MigrationPaths } from '../MigrationPaths'

function createPaths(root: string): MigrationPaths {
  return {
    userData: root,
    cherryHome: root,
    databaseFile: join(root, 'cherrystudio.sqlite'),
    knowledgeBaseDir: join(root, 'Data', 'KnowledgeBase'),
    filesDataDir: join(root, 'Data', 'Files'),
    versionLogFile: join(root, 'version.log'),
    legacyAgentDbFile: join(root, 'Data', 'agents.db'),
    agentWorkspacesDir: join(root, 'Data', 'Agents'),
    customMiniAppsFile: join(root, 'Data', 'Files', 'custom-minapps.json'),
    diagnosticsJournalFile: join(root, 'migration-diagnostics-v1.json'),
    legacyConfigFile: join(root, 'config.json'),
    migrationsFolder: join(process.cwd(), 'migrations', 'sqlite-drizzle')
  }
}

function expectRegular(file: string): void {
  expect(existsSync(file)).toBe(true)
  const stats = lstatSync(file)
  expect(stats.isFile()).toBe(true)
  expect(stats.isSymbolicLink()).toBe(false)
}

describe('MigrationDbService diagnostics lease integration', () => {
  let fixtureDir: string
  let service: MigrationDbService | undefined

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'migration-db-lease-'))
  })

  afterEach(() => {
    service?.close()
    service = undefined
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  it('defers close until the callback lease settles and fixes database/WAL/SHM identities', async () => {
    const paths = createPaths(fixtureDir)
    service = MigrationDbService.create(paths)
    service.getDb().run(sql`CREATE INDEX diagnostics_lease_marker_idx ON preference(key)`)
    const walFile = `${paths.databaseFile}-wal`
    const shmFile = `${paths.databaseFile}-shm`
    expectRegular(walFile)
    expectRegular(shmFile)

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const enteredLease = new Promise<void>((resolve) => {
      entered = resolve
    })

    const leased = service.withDiagnosticsLease(async (lease) => {
      expect(lease.databaseFile).toBe(paths.databaseFile)
      expect(lease.identity).toEqual({
        database: expect.objectContaining({ device: expect.any(String), inode: expect.any(String) }),
        wal: expect.objectContaining({ device: expect.any(String), inode: expect.any(String) }),
        shm: expect.objectContaining({ device: expect.any(String), inode: expect.any(String) })
      })
      entered()
      await gate
      expectRegular(walFile)
      expectRegular(shmFile)
      return 'diagnosed'
    })

    await enteredLease
    service.close()
    service.close()
    expectRegular(walFile)
    expectRegular(shmFile)
    await expect(service.withDiagnosticsLease(async () => 'unexpected')).resolves.toEqual({ kind: 'unavailable' })

    release()
    await expect(leased).resolves.toEqual({ kind: 'leased', value: 'diagnosed' })
    expect(existsSync(walFile)).toBe(false)
    expect(existsSync(shmFile)).toBe(false)
  })

  it('releases a lease and performs a pending close when the callback throws', async () => {
    const paths = createPaths(fixtureDir)
    service = MigrationDbService.create(paths)

    const failure = new Error('callback failed')
    await expect(
      service.withDiagnosticsLease(async () => {
        service?.close()
        throw failure
      })
    ).rejects.toBe(failure)

    await expect(service.withDiagnosticsLease(async () => 'unexpected')).resolves.toEqual({ kind: 'unavailable' })
  })
})
