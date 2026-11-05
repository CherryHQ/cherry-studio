import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { copyMigrationPrefix, resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { app, dialog } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { applyMigrations } from '@data/db/applyMigrations'
import { readAppliedChain } from '@data/db/restore/appliedChain'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { BaseService } from '@main/core/lifecycle'

vi.unmock('@main/data/db/DbService')
import { DbService } from '../DbService'

const aheadMessage =
  'Database migration chain is ahead of this build. Open this profile with an up-to-date Cherry Studio build.'
const forkMessage =
  'Database migration chain does not match this build. Open this profile with the Cherry Studio build that last used it, or contact support.'

describe('database migration compatibility', () => {
  let dir: string
  let file: string
  let service: DbService | undefined
  let ready: () => void
  let readyPromise: Promise<void>

  beforeEach(() => {
    BaseService.resetInstances()
    dir = mkdtempSync(join(tmpdir(), 'schema-drift-'))
    file = join(dir, 'db.sqlite')
    vi.spyOn(application, 'getPath').mockImplementation((key) =>
      key === 'app.database.file' ? file : resolveMigrationsPath()
    )
    readyPromise = new Promise((resolve) => {
      ready = resolve
    })
    app.whenReady = vi.fn(() => readyPromise)
    vi.mocked(dialog.showMessageBox).mockReset().mockResolvedValue({ response: 0, checkboxChecked: false })
    mockMainLoggerService.error.mockClear()
    mockMainLoggerService.warn.mockClear()
    mockMainLoggerService.info.mockClear()
  })
  afterEach(async () => {
    if (service) await service._doDestroy()
    service = undefined
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  function migrate(folder = resolveMigrationsPath()): void {
    const sqlite = new Database(file)
    applyMigrations(drizzle({ client: sqlite, casing: 'snake_case' }), folder)
    sqlite.close()
  }
  function start(): void {
    service = new DbService()
    ;(service as unknown as { migrateDb(): void }).migrateDb()
  }
  function chain() {
    const sqlite = new Database(file)
    const result = readAppliedChain(sqlite)
    sqlite.close()
    return result
  }
  function append(): void {
    const folder = join(dir, 'bundle')
    cpSync(resolveMigrationsPath(), folder, { recursive: true })
    const journalPath = join(folder, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    journal.entries.push({
      idx: journal.entries.length,
      version: '6',
      when: 2000000000034,
      tag: '9999_ahead',
      breakpoints: true
    })
    writeFileSync(journalPath, JSON.stringify(journal))
    writeFileSync(join(folder, '9999_ahead.sql'), 'SELECT 1;')
    migrate(folder)
  }
  it('diagnoses a genuinely ahead database and defers the translated warning', async () => {
    append()
    const sqlite = new Database(file)
    const db = drizzle({ client: sqlite, casing: 'snake_case' })
    const written = db
      .insert(userProviderTable)
      .values({ providerId: 'preserved', name: 'Preserved', orderKey: 'a0', providerSettings: { timeout: 45 } })
      .returning()
      .get()
    sqlite.close()
    const before = chain()
    start()
    const afterSqlite = new Database(file)
    const rows = drizzle({ client: afterSqlite, casing: 'snake_case' }).select().from(userProviderTable).all()
    afterSqlite.close()
    expect(rows).toEqual([written])
    expect(chain()).toEqual(before)
    expect(mockMainLoggerService.error).toHaveBeenCalledExactlyOnceWith(aheadMessage, {
      relation: 'ahead',
      appliedCount: before.length,
      bundledCount: before.length - 1,
      appliedTip: before.at(-1),
      bundledTip: before.at(-2)
    })
    expect(mockMainLoggerService.info).not.toHaveBeenCalledWith('Database migration completed successfully')
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    ready()
    await vi.waitFor(() =>
      expect(dialog.showMessageBox).toHaveBeenCalledExactlyOnceWith({
        type: 'warning',
        title: 'Database Compatibility',
        message:
          "This profile's database migration chain is ahead of this Cherry Studio build. Open this profile with an up-to-date Cherry Studio build.",
        buttons: ['OK'],
        defaultId: 0,
        cancelId: 0
      })
    )
  })
  it('identifies an internal fork despite an unchanged tip', () => {
    migrate()
    const sqlite = new Database(file)
    sqlite.prepare('UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?').run('fork', chain()[1].folderMillis)
    sqlite.close()
    start()
    expect(mockMainLoggerService.error).toHaveBeenCalledWith(
      forkMessage,
      expect.objectContaining({ relation: 'forked' })
    )
    expect(mockMainLoggerService.error).not.toHaveBeenCalledWith(aheadMessage, expect.anything())
  })
  it.each(['fresh', 'in-sync'] as const)('accepts a %s database', (kind) => {
    if (kind === 'in-sync') migrate()
    start()
    expect(chain().length).toBeGreaterThan(0)
    expect(mockMainLoggerService.error).not.toHaveBeenCalled()
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(mockMainLoggerService.info).toHaveBeenCalledWith('Database migration completed successfully')
  })
  it('migrates a valid older chain forward', () => {
    const prefix = copyMigrationPrefix(join(dir, 'prefix'), '0033_child_context_projection')
    migrate(prefix)
    const count = chain().length
    start()
    expect(chain().length).toBeGreaterThan(count)
    expect(mockMainLoggerService.error).not.toHaveBeenCalled()
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })
  it.each(['readiness', 'throw', 'reject'] as const)('contains %s presentation failures', async (failure) => {
    append()
    const error = new Error(failure)
    if (failure === 'readiness') app.whenReady = vi.fn().mockRejectedValue(error)
    if (failure === 'throw')
      vi.mocked(dialog.showMessageBox).mockImplementation(() => {
        throw error
      })
    if (failure === 'reject') vi.mocked(dialog.showMessageBox).mockRejectedValue(error)
    start()
    ready()
    await vi.waitFor(() =>
      expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
        'Failed to show database migration compatibility message',
        { relation: 'ahead', error }
      )
    )
  })
  it('suppresses the pending warning while quitting', async () => {
    append()
    start()
    Object.defineProperty(application, 'isQuitting', { value: true, configurable: true })
    ready()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    Object.defineProperty(application, 'isQuitting', { value: false, configurable: true })
  })
  it('treats invalid metadata as an inspection failure', () => {
    migrate()
    const sqlite = new Database(file)
    sqlite.prepare('UPDATE __drizzle_migrations SET hash = ? WHERE created_at = ?').run('', chain()[1].folderMillis)
    sqlite.close()
    start()
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to inspect database migration compatibility'),
      expect.objectContaining({ relation: 'unknown' })
    )
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(chain()).toHaveLength(readMigrationFiles({ migrationsFolder: resolveMigrationsPath() }).length)
    // The contract suppresses the success line after a failed inspection.
    expect(mockMainLoggerService.info).not.toHaveBeenCalledWith('Database migration completed successfully')
  })
  it('continues migration when inspection cannot read the database', () => {
    migrate()
    service = new DbService()
    const sqlite = (service as unknown as { sqlite: Database.Database }).sqlite
    const prepare = sqlite.prepare.bind(sqlite)
    let first = true
    vi.spyOn(sqlite, 'prepare').mockImplementation((...args) => {
      if (first) {
        first = false
        throw new Error('inspection fault')
      }
      return prepare(...args)
    })
    ;(service as unknown as { migrateDb(): void }).migrateDb()
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to inspect database migration compatibility'),
      expect.objectContaining({ relation: 'unknown' })
    )
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(chain()).toHaveLength(readMigrationFiles({ migrationsFolder: resolveMigrationsPath() }).length)
    // The contract suppresses the success line after a failed inspection.
    expect(mockMainLoggerService.info).not.toHaveBeenCalledWith('Database migration completed successfully')
  })
  it('propagates a real migration failure', () => {
    migrate()
    const folder = join(dir, 'broken')
    cpSync(resolveMigrationsPath(), folder, { recursive: true })
    const journalPath = join(folder, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    journal.entries.push({
      idx: journal.entries.length,
      version: '6',
      when: 2000000000034,
      tag: '9999_bad',
      breakpoints: true
    })
    writeFileSync(journalPath, JSON.stringify(journal))
    writeFileSync(join(folder, '9999_bad.sql'), 'INVALID SQL;')
    vi.mocked(application.getPath).mockImplementation((key) => (key === 'app.database.file' ? file : folder))
    service = new DbService()
    expect(() => (service as unknown as { migrateDb(): void }).migrateDb()).toThrow()
    expect(mockMainLoggerService.error).toHaveBeenCalledWith('Database migration failed', expect.anything())
  })
  it('suppresses the pending warning after disposal', async () => {
    append()
    start()
    await service!._doDestroy()
    service = undefined
    ready()
    await readyPromise
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })
})
