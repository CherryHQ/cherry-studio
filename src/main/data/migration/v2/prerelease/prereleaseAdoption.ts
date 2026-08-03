/**
 * Adopts a `v2.0.0-alpha.*` / `v2.0.0-beta.*` database into the consolidated
 * storage layout.
 *
 * Pre-releases kept the database at `{userData}/cherrystudio.sqlite` and the
 * Claude config at `{userData}/.claude`. The storage consolidation (#17553)
 * moved both under `Data/` without importing what was already there, so on the
 * first rc launch the new location is empty, the migration engine finds no
 * status row, still sees the untouched v1 sources — which migration
 * deliberately preserves for downgrades — and silently re-runs the whole v1→v2
 * migration. The pre-release database is left orphaned at the old path and every
 * session, note and setting created since the user installed a pre-release
 * appears to have rolled back.
 *
 * This module runs before the migration gate opens the database and turns that
 * silent loss into an explicit outcome:
 *
 *   - nothing at the old path      → not a pre-release install, carry on
 *   - only the old path has data   → adopt it silently (sub-second, see below)
 *   - both paths have data         → the user already lost the pre-release data
 *                                    to a silent re-migration and has been using
 *                                    the replacement; only they can say which
 *                                    one to keep, so ask
 *
 * Adoption never deletes: the database it does not adopt is renamed aside, and
 * the v1 sources stay where they are.
 *
 * Deleted wholesale — module, frozen chain and packaging entry — once
 * pre-release installs are no longer supported.
 */

import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import Database from 'better-sqlite3'
import { app, dialog } from 'electron'

import type { MigrationPaths } from '../core/MigrationPaths'
import { copyLegacyClaudeConfig } from '../migrators/agentsFilesystemMigration'
import { replayLegacyChain } from './legacyChainReplay'

const logger = loggerService.withContext('PrereleaseAdoption')

/** SQLite's sidecars — a database is only whole if these travel with it. */
const DATABASE_SIDECARS = ['', '-wal', '-shm'] as const

export type PrereleaseSituation =
  /** No database at the pre-release path — a v1 upgrade or a fresh install. */
  | 'none'
  /** Only the pre-release path has data: adopt it. */
  | 'adopt'
  /** Both paths have data: a silent re-migration already happened. Ask. */
  | 'choose'

export type PrereleaseAdoptionResult = 'continue' | 'quit'

/** Which of the two databases to keep. The other is renamed aside, never deleted. */
export type PrereleaseChoice = 'prerelease' | 'current'

/**
 * Which of the two databases exist. Emptiness counts as absence: a zero-byte
 * file is what a half-created database leaves behind, and adopting one would
 * throw away a real database on the other side.
 */
export function detectPrereleaseSituation(paths: MigrationPaths): PrereleaseSituation {
  if (!isNonEmptyFile(paths.prereleaseDatabaseFile)) return 'none'
  return isNonEmptyFile(paths.databaseFile) ? 'choose' : 'adopt'
}

/**
 * Resolve the pre-release database before the migration gate opens anything.
 *
 * @returns `'continue'` when boot may proceed — including the untouched
 *   no-pre-release case — or `'quit'` when the user chose to exit or adoption
 *   failed. The caller must not start the migration engine after `'quit'`.
 */
export async function runPrereleaseAdoption(paths: MigrationPaths): Promise<PrereleaseAdoptionResult> {
  try {
    return await resolvePrerelease(paths)
  } finally {
    // On the way out, whatever happened: a profile that just settled must stop
    // advertising a choice, and one that failed must keep advertising it.
    publishStatus(paths)
  }
}

async function resolvePrerelease(paths: MigrationPaths): Promise<PrereleaseAdoptionResult> {
  // Before the layout check, not after. Someone who already chose the current
  // data has no database at the pre-release path any more — the profile looks
  // settled — so a later change of mind would be invisible to a check that
  // starts from the layout. The record is what says otherwise.
  const recorded = readRecordedDecision(paths)
  if (recorded) {
    logger.info('Applying a pre-release choice recorded before this launch', { keep: recorded })
    return applyChoice(paths, recorded)
  }

  const situation = detectPrereleaseSituation(paths)
  if (situation === 'none') return 'continue'

  logger.info('Pre-release database detected', {
    situation,
    prereleaseDatabaseFile: paths.prereleaseDatabaseFile
  })

  if (situation === 'choose') {
    return runChoicePrompt(paths)
  }

  try {
    await adoptPrereleaseDatabase(paths)
    return 'continue'
  } catch (error) {
    return reportAdoptionFailure(paths, error)
  }
}

/**
 * Move the pre-release database into the consolidated layout, advancing its
 * schema on the way.
 *
 * Ordered so that an interrupted run always leaves a recoverable state: the
 * schema replay is a single transaction, and the file only moves once it has
 * committed. Crash in between and the next launch replays nothing (the database
 * already carries the marker) and simply moves the file.
 */
export async function adoptPrereleaseDatabase(paths: MigrationPaths): Promise<void> {
  if (!isNonEmptyFile(paths.prereleaseDatabaseFile)) {
    // Already moved — a previous run got past the rename. Re-entering must be a
    // no-op rather than an error, so a retried boot is never worse than a first.
    logger.info('Nothing at the pre-release path, adoption already complete')
    return
  }

  const applied = replayLegacyChain({
    databaseFile: paths.prereleaseDatabaseFile,
    legacyMigrationsFolder: paths.legacyMigrationsFolder,
    migrationsFolder: paths.migrationsFolder
  })

  fs.mkdirSync(path.dirname(paths.databaseFile), { recursive: true })
  moveDatabase(paths.prereleaseDatabaseFile, paths.databaseFile)

  // The Claude config moved in the same consolidation. Copying rather than
  // moving matches what the v1 migration does with it — the source is what a
  // downgrade reads.
  //
  // Deliberately not fatal. The database has already moved by this point, so
  // throwing would block the boot over a secondary asset that is still sitting
  // untouched at its old path — and the retry would find nothing left to adopt
  // and skip this step anyway. An agent config that fails to copy is a bad
  // launch; a database the user cannot reach is a lost one.
  let claudeConfigCopied = false
  try {
    claudeConfigCopied = await copyLegacyClaudeConfig(paths.legacyClaudeConfigDir, paths.claudeConfigDir)
  } catch (error) {
    logger.error('Adopted the database but could not copy the Claude config', error as Error)
  }

  logger.info('Pre-release database adopted', { legacyStepsApplied: applied, claudeConfigCopied })
}

// ── User choice ─────────────────────────────────────────────────────────

/**
 * Ask which database to keep. Both hold real work — the pre-release one up to
 * the day the user upgraded, the current one from then on — and neither can be
 * reconstructed from the other, so this is not a decision to make for them.
 */
async function runChoicePrompt(paths: MigrationPaths): Promise<PrereleaseAdoptionResult> {
  await app.whenReady()

  const prerelease = describeDatabase(paths.prereleaseDatabaseFile)
  const current = describeDatabase(paths.databaseFile)

  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Pre-release Data Found',
    message: 'Two sets of data were found',
    detail:
      `Data from the pre-release version you had installed was left behind when this version ` +
      `reorganized where it stores files, and a replacement was rebuilt from your older backup.\n\n` +
      `  • Pre-release data — ${prerelease.contents}, last used ${prerelease.modified}\n` +
      `  • Current data — ${current.contents}, in use since ${current.modified}\n\n` +
      `Only one can be used. Whichever you do not pick is kept on disk, not deleted, so support ` +
      `can still recover it.`,
    buttons: ['Use Pre-release Data', 'Keep Current Data', 'Quit'],
    defaultId: 0,
    cancelId: 2
  })

  if (response === 2) {
    logger.info('User deferred the pre-release data choice')
    return 'quit'
  }

  return applyChoice(paths, response === 0 ? 'prerelease' : 'current')
}

/** Carry out a choice, whoever made it and wherever they made it. */
async function applyChoice(paths: MigrationPaths, keep: PrereleaseChoice): Promise<PrereleaseAdoptionResult> {
  try {
    if (keep === 'prerelease') {
      restoreSetAsidePrerelease(paths)
      setAside(paths.databaseFile, 'replaced')
      await adoptPrereleaseDatabase(paths)
    } else {
      setAside(paths.prereleaseDatabaseFile, 'unused')
    }
    logger.info('Pre-release choice applied', { keep })
    return 'continue'
  } catch (error) {
    return reportAdoptionFailure(paths, error)
  }
}

/**
 * Put a previously declined pre-release database back in place.
 *
 * Someone who chose the current data and later realized what they gave up has
 * nothing at the pre-release path any more — only the `.unused-*` rename this
 * module made. Without this, changing their mind would be impossible through
 * any route, which is the whole reason the choice never deletes anything. The
 * newest rename wins, since that is the one the last decision produced.
 */
function restoreSetAsidePrerelease(paths: MigrationPaths): void {
  const restoredFrom = findSetAsidePrerelease(paths)
  if (!restoredFrom) return

  moveDatabase(restoredFrom, paths.prereleaseDatabaseFile)
  logger.info('Restored a previously declined pre-release database', { restoredFrom })
}

/**
 * The newest `.unused-*` rename, or null. Newest because that is the one the
 * last decision produced. Returns null while a live pre-release database is
 * present — nothing was declined, so nothing needs restoring.
 */
function findSetAsidePrerelease(paths: MigrationPaths): string | null {
  if (isNonEmptyFile(paths.prereleaseDatabaseFile)) return null

  const directory = path.dirname(paths.prereleaseDatabaseFile)
  const prefix = `${path.basename(paths.prereleaseDatabaseFile)}.unused-`
  let entries: string[]
  try {
    entries = fs.readdirSync(directory)
  } catch {
    return null
  }

  const newest = entries
    .filter((entry) => entry.startsWith(prefix) && !DATABASE_SIDECARS.some((s) => s && entry.endsWith(s)))
    .sort()
    .pop()
  return newest ? path.join(directory, newest) : null
}

/**
 * Publish what the in-app agent may know about this profile.
 *
 * The agent is the fallback for everyone the boot flow could not finish with —
 * someone who quit at the prompt, or chose one database and later wanted the
 * other. Answering them needs exactly two facts, and this file carries both so
 * the agent never has to browse the profile to find them. Removed once neither
 * fact is true any more, so a resolved profile stops advertising a choice.
 *
 * Best effort by design: a profile that cannot take this file is still a
 * profile that must boot.
 */
function publishStatus(paths: MigrationPaths): void {
  const prereleaseDataAvailable = isNonEmptyFile(paths.prereleaseDatabaseFile) || Boolean(findSetAsidePrerelease(paths))

  try {
    if (!prereleaseDataAvailable) {
      fs.rmSync(paths.prereleaseStatusFile, { force: true })
      return
    }
    fs.writeFileSync(
      paths.prereleaseStatusFile,
      JSON.stringify(
        { prereleaseDataAvailable, currentDataInUse: isNonEmptyFile(paths.databaseFile), updatedAt: Date.now() },
        null,
        2
      )
    )
  } catch (error) {
    logger.warn('Could not publish the pre-release status file', error as Error)
  }
}

/**
 * Read and consume a decision recorded before this launch.
 *
 * Consumed unconditionally once read: a decision that survives its own
 * execution would re-fire on the next boot against a profile whose two
 * databases no longer mean what the user was told they meant. Anything
 * unreadable or unrecognized is discarded rather than guessed at — falling
 * through to the dialog asks a question, while guessing moves a database.
 */
function readRecordedDecision(paths: MigrationPaths): PrereleaseChoice | null {
  let raw: string
  try {
    raw = fs.readFileSync(paths.prereleaseDecisionFile, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Could not read the recorded pre-release decision', error as Error)
    }
    return null
  }

  try {
    const parsed = JSON.parse(raw) as { keep?: unknown }
    if (parsed.keep === 'prerelease' || parsed.keep === 'current') return parsed.keep
    logger.warn('Recorded pre-release decision is not a recognized choice, ignoring', { keep: String(parsed.keep) })
  } catch (error) {
    logger.warn('Recorded pre-release decision is not valid JSON, ignoring', error as Error)
  } finally {
    fs.rmSync(paths.prereleaseDecisionFile, { force: true })
  }
  return null
}

/**
 * Stop the boot instead of falling through.
 *
 * Falling through would re-enter the exact failure this module exists to
 * prevent: the consolidated path stays empty, the engine treats the untouched v1
 * sources as an upgrade, and the user silently gets a rebuilt database again.
 * Better to hold the door shut while both databases are still on disk.
 */
async function reportAdoptionFailure(paths: MigrationPaths, error: unknown): Promise<PrereleaseAdoptionResult> {
  logger.error('Failed to adopt the pre-release database', error as Error)
  await app.whenReady()
  dialog.showErrorBox(
    'Data Upgrade Failed - Application Cannot Start',
    `Your data from the pre-release version could not be moved into this version's layout:\n\n` +
      `  ${(error as Error).message}\n\n` +
      `Nothing was deleted — your data is still at:\n\n  ${paths.prereleaseDatabaseFile}\n\n` +
      `The application will now exit. Please contact support with this message.`
  )
  return 'quit'
}

// ── Filesystem ──────────────────────────────────────────────────────────

/**
 * Move a database and its sidecars. Renamed rather than copied so the move is
 * atomic per file and costs nothing on a multi-gigabyte database; both paths are
 * inside userData, so they share a volume.
 */
function moveDatabase(from: string, to: string): void {
  for (const suffix of DATABASE_SIDECARS) {
    const source = `${from}${suffix}`
    if (!fs.existsSync(source)) continue

    // Only ever an empty husk — a real database on the destination side means
    // 'choose', which moves it aside before we get here. Clearing it keeps the
    // rename from depending on how the platform handles an existing target.
    const destination = `${to}${suffix}`
    if (fs.existsSync(destination)) fs.rmSync(destination, { force: true })

    fs.renameSync(source, destination)
  }
}

/** Rename a database out of the way, keeping it readable for support. */
function setAside(file: string, label: string): void {
  const suffixed = `${file}.${label}-${Date.now()}`
  moveDatabase(file, suffixed)
  logger.info('Database set aside', { file, keptAt: suffixed })
}

/**
 * How to describe one side of the choice.
 *
 * Counts rather than bytes, because bytes cannot be told apart: a user upgrading
 * the same day sees two entries with the same date and the same rounded size and
 * has nothing to decide on. Conversation and message totals are the thing they
 * actually recognize as theirs. Both schemas carry these tables — the legacy
 * chain has had them since its first step — but a database stopped anywhere in
 * that chain is not worth trusting blindly, so any failure degrades to the file
 * size instead of blocking the prompt.
 */
function describeDatabase(file: string): { modified: string; contents: string } {
  let modified = 'unknown'
  try {
    modified = fs.statSync(file).mtime.toLocaleDateString()
  } catch {
    // Leaves the placeholder; the counts below are the load-bearing part.
  }

  let sqlite: Database.Database | undefined
  try {
    sqlite = new Database(file, { readonly: true, fileMustExist: true })
    const topics = (sqlite.prepare(`SELECT count(*) AS c FROM topic`).get() as { c: number }).c
    const messages = (sqlite.prepare(`SELECT count(*) AS c FROM message WHERE role <> 'root'`).get() as { c: number }).c
    return { modified, contents: `${plural(topics, 'conversation')}, ${plural(messages, 'message')}` }
  } catch (error) {
    logger.warn('Could not read counts for the choice prompt, falling back to file size', error as Error)
    return { modified, contents: describeSize(file) }
  } finally {
    sqlite?.close()
  }
}

function describeSize(file: string): string {
  try {
    return `${Math.max(1, Math.round(fs.statSync(file).size / 1024 / 1024))} MB`
  } catch {
    return 'unknown size'
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function isNonEmptyFile(file: string): boolean {
  try {
    const stat = fs.statSync(file)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}
