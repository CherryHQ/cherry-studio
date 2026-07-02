import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { BaseService } from '@main/core/lifecycle'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as DbServiceModule from '../DbService'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

// The production seeders read external data files; they are covered by their own
// tests. This test exercises DbService's connection lifecycle (open / migrate /
// close / isolation), so seed with an empty set.
vi.mock('../seeding', () => ({ seeders: [] }))

// Imported after the mock is registered so DbService's `@application` resolves to the mock.
const { application } = await import('@application')

let dir: string
let currentDbPath: string

async function makeRealDbService(): Promise<DbServiceModule.DbService> {
  const actual = await vi.importActual<typeof DbServiceModule>('../DbService')
  return new actual.DbService()
}

beforeEach(() => {
  BaseService.resetInstances()
  dir = mkdtempSync(path.join(os.tmpdir(), 'dbservice-'))
  currentDbPath = path.join(dir, 'a.sqlite')
  vi.mocked(application.getPath).mockImplementation((key: string) => {
    if (key === 'app.database.file') return currentDbPath
    if (key === 'app.database.migrations') return resolveMigrationsPath()
    return `/mock/${key}`
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('DbService profile activation (real DB)', () => {
  it('is closed before activation, open after, closed after deactivation', async () => {
    const svc = await makeRealDbService()
    expect(() => svc.getDb()).toThrow(/not active/)

    svc.onProfileActivate({ profileId: 'p1' })
    const db = svc.getDb()
    db.run(sql`CREATE TABLE _marker (x INTEGER)`)
    db.run(sql`INSERT INTO _marker (x) VALUES (42)`)
    const row = db.get(sql`SELECT x FROM _marker`) as { x: number } | undefined
    expect(row?.x).toBe(42)
    // withWriteTx runs synchronously and returns its value while a profile is bound.
    expect(svc.withWriteTx(() => 'ok')).toBe('ok')

    svc.onProfileDeactivate()
    expect(() => svc.getDb()).toThrow(/not active/)
    expect(() => svc.withWriteTx(() => undefined)).toThrow(/not active/)
  })

  it('isolates data between profiles — repointing the path opens a fresh DB', async () => {
    const svc = await makeRealDbService()
    svc.onProfileActivate({ profileId: 'p1' })
    svc.getDb().run(sql`CREATE TABLE _marker (x INTEGER)`)
    svc.getDb().run(sql`INSERT INTO _marker (x) VALUES (1)`)
    svc.onProfileDeactivate()

    // Switch to a different profile's database file.
    currentDbPath = path.join(dir, 'b.sqlite')
    svc.onProfileActivate({ profileId: 'p2' })
    // The marker table created in p1's DB does not exist in p2's DB.
    expect(() => svc.getDb().get(sql`SELECT x FROM _marker`)).toThrow()
    svc.onProfileDeactivate()
  })
})
