import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { MigrationPaths } from '@data/migration/v2/core/MigrationPaths'
import {
  adoptPrereleaseDatabase,
  detectPrereleaseSituation,
  runPrereleaseAdoption
} from '@data/migration/v2/prerelease/prereleaseAdoption'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { dialog } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { whenReady: vi.fn().mockResolvedValue(undefined) },
  dialog: { showMessageBox: vi.fn(), showErrorBox: vi.fn() }
}))

const showMessageBox = vi.mocked(dialog.showMessageBox)

const CURRENT_MIGRATIONS = resolveMigrationsPath()
const LEGACY_MIGRATIONS = resolve(CURRENT_MIGRATIONS, '../sqlite-drizzle-legacy')

describe('prereleaseAdoption', () => {
  let userData: string
  let paths: MigrationPaths

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'prerelease-adoption-'))
    paths = {
      userData,
      cherryHome: join(userData, '.cherrystudio'),
      databaseFile: join(userData, 'Data', 'cherrystudio.sqlite'),
      knowledgeBaseDir: join(userData, 'Data', 'KnowledgeBase'),
      filesDataDir: join(userData, 'Data', 'Files'),
      versionLogFile: join(userData, 'version.log'),
      legacyAgentDbFile: join(userData, 'Data', 'agents.db'),
      legacyClaudeConfigDir: join(userData, '.claude'),
      legacyClaudeProjectsDir: join(userData, '.claude', 'projects'),
      agentsDataDir: join(userData, 'Data', 'Agents'),
      claudeConfigDir: join(userData, 'Data', 'Agents', '.claude'),
      claudeProjectsDir: join(userData, 'Data', 'Agents', '.claude', 'projects'),
      agentSystemWorkspacesDir: join(userData, 'Data', 'Agents', 'system'),
      customMiniAppsFile: join(userData, 'Data', 'Files', 'custom-minapps.json'),
      prereleaseDatabaseFile: join(userData, 'cherrystudio.sqlite'),
      prereleaseDecisionFile: join(userData, 'prerelease-adoption.pending.json'),
      prereleaseStatusFile: join(userData, 'prerelease-adoption.status.json'),
      legacyConfigFile: join(userData, '.cherrystudio', 'config', 'config.json'),
      migrationsFolder: CURRENT_MIGRATIONS,
      legacyMigrationsFolder: LEGACY_MIGRATIONS
    }
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  /** A database as an alpha/beta install would have left it, at the given chain depth. */
  function writePrereleaseDatabase(steps: number): void {
    const journal = JSON.parse(readFileSync(join(LEGACY_MIGRATIONS, 'meta', '_journal.json'), 'utf-8')) as {
      entries: Array<{ tag: string; when: number }>
    }
    const applied = [...journal.entries].sort((a, b) => a.when - b.when).slice(0, steps)

    const sqlite = new Database(paths.prereleaseDatabaseFile)
    sqlite.pragma('foreign_keys = OFF')
    for (const entry of applied) {
      const sql = readFileSync(join(LEGACY_MIGRATIONS, `${entry.tag}.sql`), 'utf-8')
      for (const statement of sql.split('--> statement-breakpoint')) {
        const trimmed = statement.trim()
        if (trimmed) sqlite.exec(trimmed)
      }
    }
    sqlite.exec(`CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`)
    sqlite
      .prepare(`INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)`)
      .run('legacy', applied[applied.length - 1].when)
    sqlite.close()
  }

  function writeFileAt(file: string, contents: string): void {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, contents)
  }

  describe('detectPrereleaseSituation', () => {
    it('reports none when nothing sits at the pre-release path', () => {
      writeFileAt(paths.databaseFile, 'current')
      expect(detectPrereleaseSituation(paths)).toBe('none')
    })

    it('reports adopt when only the pre-release path has data', () => {
      writeFileAt(paths.prereleaseDatabaseFile, 'prerelease')
      expect(detectPrereleaseSituation(paths)).toBe('adopt')
    })

    it('reports choose when a silent re-migration already produced a second database', () => {
      writeFileAt(paths.prereleaseDatabaseFile, 'prerelease')
      writeFileAt(paths.databaseFile, 'current')
      expect(detectPrereleaseSituation(paths)).toBe('choose')
    })

    // A zero-byte file is what a half-created database leaves behind. Treating
    // it as real would either adopt nothing or, worse, push the real database
    // aside as the loser of a choice the user never needed to make.
    it('treats an empty file as absent on either side', () => {
      writeFileAt(paths.prereleaseDatabaseFile, '')
      expect(detectPrereleaseSituation(paths)).toBe('none')

      writeFileAt(paths.prereleaseDatabaseFile, 'prerelease')
      writeFileAt(paths.databaseFile, '')
      expect(detectPrereleaseSituation(paths)).toBe('adopt')
    })
  })

  describe('adoptPrereleaseDatabase', () => {
    it('moves the database into the consolidated layout', async () => {
      writePrereleaseDatabase(15)

      await adoptPrereleaseDatabase(paths)

      expect(existsSync(paths.databaseFile)).toBe(true)
      expect(existsSync(paths.prereleaseDatabaseFile)).toBe(false)
      expect(detectPrereleaseSituation(paths)).toBe('none')
    })

    // The database ships in WAL mode, so what moves must be a whole database
    // rather than a main file whose recent writes are still in a sidecar left
    // behind at the old path.
    it('leaves nothing readable behind at the pre-release path', async () => {
      writePrereleaseDatabase(15)
      const adopted = new Database(paths.prereleaseDatabaseFile)
      adopted.pragma('journal_mode = WAL')
      adopted
        .prepare(`INSERT INTO topic (id, name, order_key, created_at, updated_at) VALUES ('t1', 'T', 'a0', 1, 1)`)
        .run()
      adopted.close()

      await adoptPrereleaseDatabase(paths)

      for (const suffix of ['', '-wal', '-shm']) {
        expect(existsSync(`${paths.prereleaseDatabaseFile}${suffix}`)).toBe(false)
      }
      const moved = new Database(paths.databaseFile, { fileMustExist: true })
      expect((moved.prepare(`SELECT count(*) AS c FROM topic`).get() as { c: number }).c).toBe(1)
      moved.close()
    })

    it('brings the Claude config to its new home while leaving the source for a downgrade', async () => {
      writePrereleaseDatabase(15)
      writeFileAt(join(paths.legacyClaudeConfigDir, 'settings.json'), '{"theme":"dark"}')

      await adoptPrereleaseDatabase(paths)

      expect(readFileSync(join(paths.claudeConfigDir, 'settings.json'), 'utf-8')).toBe('{"theme":"dark"}')
      expect(existsSync(join(paths.legacyClaudeConfigDir, 'settings.json'))).toBe(true)
    })

    it('is idempotent when re-run after an interrupted move', async () => {
      writePrereleaseDatabase(15)

      await adoptPrereleaseDatabase(paths)
      // Second call has nothing at the pre-release path; it must not undo the
      // first or fail the boot.
      await expect(adoptPrereleaseDatabase(paths)).resolves.toBeUndefined()
      expect(existsSync(paths.databaseFile)).toBe(true)
    })
  })

  /**
   * The one thing the in-app agent is allowed to read. It exists so the agent
   * never needs the profile directory itself — that would mean handing it the
   * user's database to answer a question the boot already answered.
   */
  describe('the status the in-app agent reads', () => {
    const status = () => JSON.parse(readFileSync(paths.prereleaseStatusFile, 'utf-8'))

    it('advertises recoverable data while a pre-release database is waiting', async () => {
      writePrereleaseDatabase(15)
      writeFileAt(paths.databaseFile, 'rebuilt')
      showMessageBox.mockResolvedValue({ response: 2, checkboxChecked: false })

      await runPrereleaseAdoption(paths)

      expect(status()).toMatchObject({ prereleaseDataAvailable: true, currentDataInUse: true })
    })

    // Still recoverable: keeping the current data only renames the other one.
    it('keeps advertising after the pre-release database was set aside', async () => {
      writePrereleaseDatabase(15)
      writeFileAt(paths.databaseFile, 'rebuilt')
      writeFileAt(paths.prereleaseDecisionFile, JSON.stringify({ keep: 'current' }))

      await runPrereleaseAdoption(paths)

      expect(status()).toMatchObject({ prereleaseDataAvailable: true })
    })

    // Nothing left to offer — the agent must stop proposing a choice that no
    // longer exists rather than walking the user through a no-op.
    it('is removed once the pre-release database has been adopted', async () => {
      writePrereleaseDatabase(15)

      await runPrereleaseAdoption(paths)

      expect(existsSync(paths.prereleaseStatusFile)).toBe(false)
    })

    it('is absent for a profile that never ran a pre-release', async () => {
      writeFileAt(paths.databaseFile, 'current')

      await runPrereleaseAdoption(paths)

      expect(existsSync(paths.prereleaseStatusFile)).toBe(false)
    })
  })

  /**
   * The in-app agent can explain the two databases but cannot move one while the
   * app holds it open, so it records the answer and the next boot performs it.
   */
  describe('a choice recorded before this launch', () => {
    beforeEach(() => {
      showMessageBox.mockReset()
      writePrereleaseDatabase(15)
      writeFileAt(paths.databaseFile, 'rebuilt-by-a-silent-re-migration')
    })

    const record = (contents: string) => writeFileAt(paths.prereleaseDecisionFile, contents)

    it('keeps the pre-release database without asking', async () => {
      record(JSON.stringify({ keep: 'prerelease' }))

      await expect(runPrereleaseAdoption(paths)).resolves.toBe('continue')

      expect(showMessageBox).not.toHaveBeenCalled()
      expect(existsSync(paths.prereleaseDatabaseFile)).toBe(false)
      const moved = new Database(paths.databaseFile, { fileMustExist: true })
      expect(moved.prepare(`SELECT count(*) AS c FROM topic`).get()).toEqual({ c: 0 })
      moved.close()
    })

    it('keeps the current database without asking', async () => {
      record(JSON.stringify({ keep: 'current' }))

      await expect(runPrereleaseAdoption(paths)).resolves.toBe('continue')

      expect(showMessageBox).not.toHaveBeenCalled()
      expect(readFileSync(paths.databaseFile, 'utf-8')).toBe('rebuilt-by-a-silent-re-migration')
      expect(existsSync(paths.prereleaseDatabaseFile)).toBe(false)
    })

    // Leaving it would re-fire on the next boot against a profile whose two
    // databases no longer mean what the user was told they meant.
    it('consumes the record so it cannot fire twice', async () => {
      record(JSON.stringify({ keep: 'current' }))

      await runPrereleaseAdoption(paths)

      expect(existsSync(paths.prereleaseDecisionFile)).toBe(false)
    })

    /**
     * The reason the choice only ever renames: someone who kept the current
     * data and later realized what they gave up has nothing at the pre-release
     * path, so the profile reads as settled. Only the record says otherwise.
     */
    it('can still switch back after the pre-release database was set aside', async () => {
      record(JSON.stringify({ keep: 'current' }))
      await runPrereleaseAdoption(paths)
      expect(existsSync(paths.prereleaseDatabaseFile)).toBe(false)
      expect(detectPrereleaseSituation(paths)).toBe('none')

      record(JSON.stringify({ keep: 'prerelease' }))
      await expect(runPrereleaseAdoption(paths)).resolves.toBe('continue')

      expect(showMessageBox).not.toHaveBeenCalled()
      // The declined database is back in place, migrated, and openable.
      const restored = new Database(paths.databaseFile, { fileMustExist: true })
      expect(restored.prepare(`SELECT count(*) AS c FROM topic`).get()).toEqual({ c: 0 })
      restored.close()
    })

    it.each([
      ['not JSON at all', 'nonsense'],
      ['an unrecognized choice', JSON.stringify({ keep: 'both' })]
    ])('falls back to asking when the record is %s', async (_label, contents) => {
      record(contents)
      showMessageBox.mockResolvedValue({ response: 2, checkboxChecked: false })

      // Asking is the safe fallback — guessing would move a database.
      await expect(runPrereleaseAdoption(paths)).resolves.toBe('quit')
      expect(showMessageBox).toHaveBeenCalledOnce()
      expect(existsSync(paths.prereleaseDecisionFile)).toBe(false)
    })
  })
})
