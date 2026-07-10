import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import Database from 'better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import type { AppliedMigration } from './appliedChain'
import { checkpointTruncateAssert } from './checkpoint'
import { hashDbFile } from './hashDbFile'
import type { PromotionStep, RestoreJournal } from './restoreJournal'
import { PROMOTION_STEP_ORDER, readRestoreJournal, writeRestoreJournal } from './restoreJournal'

const logger = loggerService.withContext('RestorePromotion')

function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`)
}

type StagedJournal = Extract<RestoreJournal, { state: 'staged' }>
type PromotingJournal = Extract<RestoreJournal, { state: 'promoting' }>
type FileResource = RestoreJournal['fileResources'][number]

/**
 * After this step the work database IS the live database: crash recovery at
 * or past it must resume forward; before it, roll back. Ordering goes through
 * PROMOTION_STEP_ORDER.indexOf — see the warning on that constant.
 */
const COMMIT_STEP: PromotionStep = 'work-promoted'

interface PromotionContext {
  readonly journal: StagedJournal | PromotingJournal
  readonly userData: string
  readonly livePath: string
  readonly workPath: string
  readonly asidePath: string
}

/**
 * Promote a staged restore. Called once per boot from the preboot gate
 * shell, after the path registry is frozen and the single instance lock is
 * held, before the v2 migration gate opens the DB.
 *
 * Every exit converges to one of two states — old DB intact and live, or new
 * DB complete and live — and any terminal outcome deletes the staging tree.
 * This function may throw only on truly unexpected failures; the shell
 * (backupRestoreGate.ts) swallows those, because a preboot exception would
 * dead-loop the "Unable to Start" fail-fast path.
 */
export async function runRestorePromotion(): Promise<void> {
  const read = readRestoreJournal()
  if (read.kind === 'none') {
    return
  }
  if (read.kind === 'corrupt') {
    quarantineCorruptJournal(read.error)
    return
  }
  const journal = read.journal
  switch (journal.state) {
    case 'completed':
    case 'failed':
    case 'expired':
      // Reporting + deletion of terminal journals is owned by BackupService.
      return
    case 'staged':
      return promoteStaged(journal)
    case 'promoting':
      return recoverPromoting(journal)
  }
}

/**
 * Last-resort net for a crash that ESCAPED runRestorePromotion — called only
 * by the gate shell's catch. Escaped throws are precisely the cases in-band
 * recovery could not handle, so before freezing the journal to a terminal
 * `failed` this restores the cardinal invariant: if the live slot is empty
 * but the aside still holds the old DB, put it back — otherwise the next
 * boot would silently create a fresh EMPTY database while the user's data
 * sits stranded in the aside. Then applies the standard terminal cleanup
 * (journal write + staging tree removal). Must never throw beyond what the
 * shell already guards.
 */
export function markRestoreFailedAfterCrash(): void {
  const read = readRestoreJournal()
  if (read.kind !== 'ok') {
    return
  }
  const journal = read.journal
  if (journal.state !== 'staged' && journal.state !== 'promoting') {
    return
  }
  const ctx = buildContext(journal)
  restoreLiveFromAside(ctx)
  finalize(ctx, 'failed', journal.state === 'promoting' ? journal.step : undefined)
}

function buildContext(journal: StagedJournal | PromotingJournal): PromotionContext {
  const userData = application.getPath('app.userdata')
  return {
    journal,
    userData,
    livePath: application.getPath('app.database.file'),
    workPath: path.resolve(userData, journal.db.promote),
    asidePath: path.resolve(userData, journal.db.aside)
  }
}

// ─── staged: admission gate, then forward execution ───

async function promoteStaged(journal: StagedJournal): Promise<void> {
  const ctx = buildContext(journal)

  try {
    sealWorkSidecars(ctx.workPath)
    if (!(await fingerprintMatches(ctx.livePath, journal.db.fingerprint))) {
      return expire(
        ctx,
        'live fingerprint mismatch — the DB changed after staging (write-gate leak or external writer)'
      )
    }
    if (!chainIsBundledPrefix(journal.db.chain)) {
      return expire(ctx, 'journal chain is not a prefix of the bundled migration chain (fork or ahead-of-code DB)')
    }
  } catch (error) {
    return expire(ctx, `admission gate failed: ${(error as Error).message}`)
  }

  logger.info('Restore admission gate passed, promoting', { restoreId: journal.restoreId })
  const promoting = markStep({ ...journal, state: 'promoting', step: 'gate-passed' }, 'gate-passed')
  await executeForward(ctx, promoting)
}

/**
 * Defensive re-seal: a dirty exit on the staging side leaves
 * committed restore rows in work.sqlite-wal, and the promotion renames only
 * the main file — those rows would be silently lost while integrity_check
 * still passes. Fold them in through a temporary connection; a clean close
 * of the last connection checkpoints and removes the sidecars.
 */
function sealWorkSidecars(workPath: string): void {
  if (!fs.existsSync(workPath)) {
    throw new Error(`work database missing: ${workPath}`)
  }
  if (!fs.existsSync(`${workPath}-wal`) && !fs.existsSync(`${workPath}-shm`)) {
    return
  }
  logger.warn('work.sqlite has leftover sidecars — folding WAL into the main file', { workPath })
  const sqlite = new Database(workPath, { fileMustExist: true })
  try {
    checkpointTruncateAssert(sqlite)
  } finally {
    sqlite.close()
  }
  if (fs.existsSync(`${workPath}-wal`)) {
    throw new Error(`work database WAL survived checkpoint+close: ${workPath}-wal`)
  }
}

/** Both fingerprint sides use the same primitives: TRUNCATE checkpoint, then hash the main file. */
async function fingerprintMatches(livePath: string, expected: string): Promise<boolean> {
  const sqlite = new Database(livePath, { fileMustExist: true })
  try {
    checkpointTruncateAssert(sqlite)
  } finally {
    sqlite.close()
  }
  return (await hashDbFile(livePath)) === expected
}

/**
 * The journal chain (work's actual applied sequence) must be a prefix of the
 * app's bundled sequence. Item-wise comparison — tip membership alone cannot
 * catch a fork (A B′ C vs A B C share the tip but B′ never gets applied).
 * A strict prefix is VALID: the app being ahead by a patch migration simply
 * means DbService.onInit will migrate the promoted DB forward.
 */
function chainIsBundledPrefix(chain: readonly AppliedMigration[]): boolean {
  const bundled = readMigrationFiles({ migrationsFolder: application.getPath('app.database.migrations') })
  if (chain.length > bundled.length) {
    return false
  }
  return chain.every(
    (item, index) => item.folderMillis === bundled[index].folderMillis && item.hash === bundled[index].hash
  )
}

function expire(ctx: PromotionContext, reason: string): void {
  logger.warn('Restore refused at admission gate — old DB stays live', {
    restoreId: ctx.journal.restoreId,
    reason
  })
  finalize(ctx, 'expired')
}

// ─── promoting: crash re-entry ───

async function recoverPromoting(journal: PromotingJournal): Promise<void> {
  const ctx = buildContext(journal)
  const order = PROMOTION_STEP_ORDER.indexOf(journal.step)
  const commit = PROMOTION_STEP_ORDER.indexOf(COMMIT_STEP)
  if (order < commit) {
    // Commit-boundary marker lag: the work→live rename (fsynced) can outlive
    // its own journal marker when the crash lands between the two writes.
    // Markers lag their action by at most one step, and in every legitimate
    // pre-commit state the work file still exists — so "work gone ∧ live
    // present" at step live-aside proves the commit rename already landed.
    // Rolling back here would delete the additive files the now-live new DB
    // references while the aside guard leaves the new DB in place — the
    // forbidden third state. Resume instead.
    if (journal.step === 'live-aside' && !fs.existsSync(ctx.workPath) && fs.existsSync(ctx.livePath)) {
      logger.warn('Commit rename landed but its marker lagged — resuming promotion', {
        restoreId: journal.restoreId
      })
      await executeForward(ctx, markStep(journal, COMMIT_STEP))
      return
    }
    logger.warn('Crash before the commit point — rolling back to the old DB', {
      restoreId: journal.restoreId,
      step: journal.step
    })
    rollbackPreCommit(ctx)
    return
  }
  logger.warn('Crash at/after the commit point — resuming promotion', {
    restoreId: journal.restoreId,
    step: journal.step
  })
  await executeForward(ctx, journal)
}

// ─── forward execution ───

/**
 * Run every step after `journal.step`, recording each completed step in the
 * journal (write-ahead file write, idempotent operations) so a crash lands in
 * recoverPromoting with an accurate marker. A step failure before the commit
 * point rolls back; at/after it, reverts to the old DB (aside) in full.
 */
async function executeForward(ctx: PromotionContext, journal: PromotingJournal): Promise<void> {
  let current = journal
  const commitIndex = PROMOTION_STEP_ORDER.indexOf(COMMIT_STEP)
  for (let i = PROMOTION_STEP_ORDER.indexOf(current.step) + 1; i < PROMOTION_STEP_ORDER.length; i++) {
    const step = PROMOTION_STEP_ORDER[i]
    try {
      runStep(ctx, step)
    } catch (error) {
      logger.error(`Promotion step '${step}' failed`, error as Error)
      if (i <= commitIndex) {
        rollbackPreCommit(ctx)
      } else {
        revertPostCommit(ctx)
      }
      return
    }
    current = markStep(current, step)
  }
  logger.info('Restore promoted — new DB is live', { restoreId: ctx.journal.restoreId })
  finalize(ctx, 'completed', current.step)
}

function runStep(ctx: PromotionContext, step: PromotionStep): void {
  switch (step) {
    case 'gate-passed':
      // Admission marker only — no filesystem action.
      return
    case 'additive-moved':
      for (const entry of ctx.journal.fileResources) {
        if (entry.kind === 'blob-add' || entry.kind === 'dir-add') {
          moveIdempotent(resolveEntry(ctx, entry.stagingPath), resolveEntry(ctx, entry.livePath))
        }
      }
      return
    case 'sidecars-removed':
      // Stale live sidecars would be replayed by SQLite over the PROMOTED
      // main file on next open — delete them in the zero-connection window.
      fs.rmSync(`${ctx.livePath}-wal`, { force: true })
      fs.rmSync(`${ctx.livePath}-shm`, { force: true })
      return
    case 'live-aside':
      renameOnceIdempotent(ctx.livePath, ctx.asidePath)
      return
    case 'work-promoted':
      renameOnceIdempotent(ctx.workPath, ctx.livePath)
      return
    case 'entries-applied':
      for (const entry of ctx.journal.fileResources) {
        applyEntry(ctx, entry)
      }
      return
    case 'integrity-ok': {
      const result = integrityCheck(ctx.livePath)
      if (result !== 'ok') {
        throw new Error(`integrity_check on the promoted DB failed: ${result}`)
      }
      return
    }
    default:
      assertNever(step)
  }
}

function integrityCheck(dbPath: string): string {
  let sqlite: Database.Database | undefined
  try {
    sqlite = new Database(dbPath, { fileMustExist: true })
    return String(sqlite.pragma('integrity_check', { simple: true }))
  } catch (error) {
    // Open failures (missing/locked/not-a-db) are integrity failures too.
    return (error as Error).message
  } finally {
    try {
      sqlite?.close()
    } catch {
      // a corrupt DB may fail to close cleanly; the check result already tells the story
    }
  }
}

function applyEntry(ctx: PromotionContext, entry: FileResource): void {
  switch (entry.kind) {
    case 'blob-add':
    case 'dir-add':
      // Already handled in the additive step.
      return
    case 'note-add':
      moveIdempotent(resolveEntry(ctx, entry.stagingPath), resolveEntry(ctx, entry.livePath))
      return
    case 'note-overwrite':
    case 'overwrite': {
      const live = resolveEntry(ctx, entry.livePath)
      const aside = entry.asidePath ? resolveEntry(ctx, entry.asidePath) : undefined
      // Aside-first: the original must be parked before the overwrite lands.
      if (aside && fs.existsSync(live) && !fs.existsSync(aside)) {
        renameDurable(live, aside)
      }
      moveIdempotent(resolveEntry(ctx, entry.stagingPath), live)
      return
    }
    default:
      assertNever(entry.kind)
  }
}

// ─── rollback / revert ───

/**
 * Pre-commit crash: the old DB still exists (live or aside). Undo the
 * manifest work done so far, put the old DB back, mark failed. The staged
 * restore content is discarded with the staging tree — a failed restore is
 * re-run from the backup archive, never resumed from half-moved files.
 */
function rollbackPreCommit(ctx: PromotionContext): void {
  inverseManifest(ctx)
  restoreLiveFromAside(ctx)
  finalize(ctx, 'failed')
}

/**
 * Post-commit failure (integrity or a later step): the promoted DB is live
 * but unacceptable. Park it for forensics, restore the aside, and undo ALL
 * file operations — entries were applied by now, so reverting only the DB
 * would leave an "old DB + new files" inconsistent state.
 */
function revertPostCommit(ctx: PromotionContext): void {
  if (fs.existsSync(ctx.livePath)) {
    const parked = path.join(ctx.userData, `work-failed-${ctx.journal.restoreId}.sqlite`)
    fs.rmSync(parked, { force: true })
    renameDurable(ctx.livePath, parked)
    logger.warn('Promoted DB failed post-commit checks — parked for forensics', { parked })
  }
  restoreLiveFromAside(ctx)
  inverseManifest(ctx)
  finalize(ctx, 'failed')
}

function restoreLiveFromAside(ctx: PromotionContext): void {
  if (fs.existsSync(ctx.asidePath) && !fs.existsSync(ctx.livePath)) {
    renameDurable(ctx.asidePath, ctx.livePath)
  }
}

/**
 * Undo every manifest operation that (may) have happened, in reverse of the
 * apply direction. Idempotent by construction: adds are deleted if present,
 * overwrites are restored only while their aside exists. Best-effort per
 * entry: one stuck entry must not abort the rest of the inverse — the aside
 * restore of the live DB and the terminal bookkeeping still have to follow.
 */
function inverseManifest(ctx: PromotionContext): void {
  for (const entry of ctx.journal.fileResources) {
    try {
      inverseEntry(ctx, entry)
    } catch (error) {
      logger.error(`Manifest inverse failed for '${entry.livePath}' (${entry.kind}) — continuing`, error as Error)
    }
  }
}

function inverseEntry(ctx: PromotionContext, entry: FileResource): void {
  const live = resolveEntry(ctx, entry.livePath)
  switch (entry.kind) {
    case 'blob-add':
    case 'note-add':
      fs.rmSync(live, { force: true })
      return
    case 'dir-add':
      fs.rmSync(live, { recursive: true, force: true })
      return
    case 'note-overwrite':
    case 'overwrite': {
      const aside = entry.asidePath ? resolveEntry(ctx, entry.asidePath) : undefined
      if (aside && fs.existsSync(aside)) {
        fs.rmSync(live, { force: true })
        renameDurable(aside, live)
      }
      return
    }
    default:
      assertNever(entry.kind)
  }
}

// ─── terminal bookkeeping ───

/**
 * Every terminal outcome writes the journal state and deletes the staging
 * tree (the staging tree's lifecycle is wholly owned by this state machine).
 * Terminal journals themselves are kept — BackupService reads them for the
 * post-boot report and owns their deletion.
 */
function finalize(ctx: PromotionContext, state: 'completed' | 'failed' | 'expired', step?: PromotionStep): void {
  writeRestoreJournal({ ...ctx.journal, state, step } as RestoreJournal)
  const stagingRoot = application.getPath('feature.backup.restore.staging')
  fs.rmSync(path.join(stagingRoot, ctx.journal.restoreId), { recursive: true, force: true })
}

function quarantineCorruptJournal(error: string): void {
  const journalPath = application.getPath('feature.backup.restore.file')
  const quarantined = `${journalPath}.corrupt-${Date.now()}`
  logger.error('Corrupt restore journal — quarantining and clearing staging', { quarantined, error })
  try {
    fs.renameSync(journalPath, quarantined)
  } catch (renameError) {
    logger.error('Failed to quarantine corrupt journal', renameError as Error)
    fs.rmSync(journalPath, { force: true })
  }
  // No trustworthy restoreId — clear the whole staging root.
  fs.rmSync(application.getPath('feature.backup.restore.staging'), { recursive: true, force: true })
}

// ─── filesystem primitives ───

function resolveEntry(ctx: PromotionContext, relativePath: string): string {
  return path.resolve(ctx.userData, relativePath)
}

function markStep(journal: PromotingJournal, step: PromotionStep): PromotingJournal {
  const next: PromotingJournal = { ...journal, step }
  writeRestoreJournal(next)
  return next
}

/**
 * Move with crash-idempotent semantics: "source gone ∧ target present" means
 * a previous attempt already did it. Both present is a manifest-contract
 * violation (add targets must not pre-exist) — fail rather than clobber.
 */
function moveIdempotent(source: string, target: string): void {
  const sourceExists = fs.existsSync(source)
  const targetExists = fs.existsSync(target)
  if (!sourceExists && targetExists) {
    return
  }
  if (sourceExists && targetExists) {
    throw new Error(`move conflict — both source and target exist: ${source} → ${target}`)
  }
  if (!sourceExists) {
    throw new Error(`move source missing: ${source} → ${target}`)
  }
  renameDurable(source, target)
}

/** Same idempotence for the two DB renames, where the target never legitimately pre-exists. */
function renameOnceIdempotent(source: string, target: string): void {
  moveIdempotent(source, target)
}

/**
 * Rename + fsync of the affected directories (POSIX). Without the directory
 * fsync, a power cut after the journal recorded a completed step could undo
 * the rename but keep the journal — recovery would then skip a step that was
 * silently rolled back by the filesystem. Windows cannot fsync directory
 * handles; its MoveFileEx path is accepted as best-effort (same trade-off as
 * writeRestoreJournal).
 */
function renameDurable(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.renameSync(source, target)
  fsyncDir(path.dirname(target))
  const sourceDir = path.dirname(source)
  if (sourceDir !== path.dirname(target)) {
    fsyncDir(sourceDir)
  }
}

function fsyncDir(dir: string): void {
  if (process.platform === 'win32') {
    return
  }
  const fd = fs.openSync(dir, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
