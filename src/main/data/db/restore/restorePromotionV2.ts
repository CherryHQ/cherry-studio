import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import Database from 'better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import type { AppliedMigration } from './appliedChain'
import { checkpointTruncateAssert } from './checkpoint'
import { installedKnowledgeBaseIds, installResourceUnits, recoverResourceUnits } from './resourceInstallV2'
import type { PromotionStepV2, RestoreJournalV2 } from './restoreJournalV2'
import {
  DB_COMMIT_STEP,
  PROMOTION_STEP_ORDER_V2,
  readRestoreJournalV2,
  writeRestoreJournalV2
} from './restoreJournalV2'
import { decideRecoveryAction, phaseForStep, type RecoveryAction, type RecoveryPhase } from './restoreRecovery'

const logger = loggerService.withContext('RestorePromotionV2')

/**
 * The Backup v2 promotion gate (docs/references/backup/README.md §6).
 *
 * Called once per boot from the preboot shell, after the path registry is
 * frozen and the single-instance lock is held, before anything opens the
 * database. This is the only code allowed to replace the live database, and it
 * runs in the one window where no connection exists.
 *
 * Every exit converges to one of exactly two states — the old database intact
 * and live, or the new database complete and live. There is no third state, and
 * the two invariants that keep it that way are:
 *
 * - **`armed` is the only entry.** A `prepared` journal a restart merely
 *   stumbled over is EXPIRED, never promoted: preparation is a staged file, not
 *   consent (§6.1).
 * - **The live WAL is checkpointed first** (§6.2). v2 dropped v1's fingerprint,
 *   so nothing else proves the parked database carries the user's last
 *   committed transactions. It is also the first effectful step, so a checkpoint
 *   failure aborts having touched nothing.
 *
 * Crash recovery is decided by the pure table in `./restoreRecovery.ts` fed with
 * filesystem reality, plus the marker-lag probe v1 proved necessary — markers
 * are written AFTER the action they record, so around the commit boundary the
 * filesystem, not the marker, is ground truth.
 */

type ArmedJournal = Extract<RestoreJournalV2, { state: 'armed' }>
type PreparedJournal = Extract<RestoreJournalV2, { state: 'prepared' }>
type PromotingJournal = Extract<RestoreJournalV2, { state: 'promoting' }>
type ActiveJournal = ArmedJournal | PromotingJournal

const COMMIT_INDEX = PROMOTION_STEP_ORDER_V2.indexOf(DB_COMMIT_STEP)

interface PromotionContext {
  readonly journal: ActiveJournal
  readonly userData: string
  /** The database the app boots from. */
  readonly livePath: string
  /** The archive's database, sealed and waiting. */
  readonly stagedPath: string
  /** Park slot for the replaced database, retained until acknowledgement (§6.5). */
  readonly asidePath: string
}

/** The existence triple the recovery table decides from. */
interface UnitFacts {
  readonly staged: boolean
  readonly live: boolean
  readonly aside: boolean
}

export async function runRestorePromotionV2(): Promise<void> {
  const read = readRestoreJournalV2()
  if (read.kind === 'none') {
    return
  }
  if (read.kind === 'corrupt') {
    quarantineCorruptJournal(read.error)
    return
  }
  const journal = read.journal
  switch (journal.state) {
    case 'prepared':
      return expirePrepared(journal)
    case 'armed':
      return promoteArmed(journal)
    case 'promoting':
      return recoverPromoting(journal)
    case 'completed':
    case 'failed':
    case 'expired':
      // Terminal. Reporting and acknowledgement cleanup own these.
      return
  }
}

/**
 * Last-resort net for a crash that ESCAPED {@link runRestorePromotionV2} —
 * called only by the gate shell's catch, i.e. exactly the cases in-band recovery
 * could not handle. Two-way triage on the commit boundary:
 *
 * - The commit already landed: the new database is live. Freezing that to
 *   `failed` would strand a half-promoted database, so leave the `promoting`
 *   journal for the next boot to resume.
 * - Otherwise restore the cardinal invariant first — an empty live slot with the
 *   old database still parked aside would let the next boot CREATE a fresh empty
 *   database while the user's data sits invisible — then mark the attempt
 *   failed.
 */
export function markRestoreFailedAfterCrashV2(): void {
  const read = readRestoreJournalV2()
  if (read.kind !== 'ok') {
    return
  }
  const journal = read.journal
  if (journal.state !== 'armed' && journal.state !== 'promoting') {
    return
  }
  const ctx = buildContext(journal)
  const facts = probeFacts(ctx)
  if (
    journal.state === 'promoting' &&
    facts.live &&
    facts.aside &&
    recoveryPhase(journal.step, facts) === 'committed'
  ) {
    logger.warn('Escaped crash left a committed promotion — keeping it resumable for the next boot', {
      restoreId: journal.restoreId
    })
    return
  }
  restoreLiveFromAside(ctx)
  failRolledBack(ctx, 'promotion crashed outside its own recovery')
}

/**
 * Whether the user's database is stranded: the live slot is empty while this
 * machinery's aside still holds the previous one. Booting on from here would
 * create a fresh empty database on first open. A missing live database with no
 * journal is not this machinery's doing and stays out of scope.
 */
export function isLiveDbStrandedV2(): boolean {
  const read = readRestoreJournalV2()
  if (read.kind !== 'ok') {
    return false
  }
  const livePath = application.getPath('app.database.file')
  const asidePath = path.resolve(application.getPath('app.userdata'), read.journal.db.aside)
  return !fs.existsSync(livePath) && fs.existsSync(asidePath)
}

// ─── prepared: expire, never promote ───

/**
 * A preparation this boot found unarmed. The user never confirmed it (or
 * confirmed and the relaunch never happened), so the only safe reading is that
 * they walked away: drop the staging tree and freeze the journal to `expired`.
 *
 * Staging tree first, journal last — while the journal exists the tree is
 * protected (§6.5), so clearing the journal first would orphan it.
 */
function expirePrepared(journal: PreparedJournal): void {
  logger.info('Found an unarmed preparation at boot — expiring it', { restoreId: journal.restoreId })
  removeStagingTree(journal.restoreId)
  writeRestoreJournalV2({
    ...journal,
    state: 'expired',
    reason: 'the preparation was never armed; an unrelated restart expired it'
  })
}

// ─── armed: admission gate, then forward execution ───

async function promoteArmed(journal: ArmedJournal): Promise<void> {
  const ctx = buildContext(journal)

  try {
    assertPromotable(ctx)
    if (!chainIsBundledPrefix(journal.db.chain)) {
      return expire(ctx, 'journal chain is not a prefix of the bundled migration chain (fork or ahead-of-code DB)')
    }
  } catch (error) {
    return expire(ctx, `admission gate failed: ${(error as Error).message}`)
  }

  logger.info('Restore admission gate passed, promoting', { restoreId: journal.restoreId })
  const promoting = markStep({ ...journal, state: 'promoting', step: 'gate-passed' }, 'gate-passed')
  await executeForward(ctx, promoting, PROMOTION_STEP_ORDER_V2.indexOf('gate-passed') + 1)
}

/**
 * Admission preflight, before any effect.
 *
 * A live database MUST exist: this gate REPLACES a database, and the whole
 * recovery model reads "live present, aside absent" as "the original is still in
 * place". Promoting into an empty live slot would make that reading a lie and
 * leave no rollback target if a later step failed.
 *
 * The staged database must carry no sidecar. Materialization sealed it
 * (`journal_mode=DELETE`), and the gate renames only the main file — a `-wal`
 * next to it means something opened the archive after admission, so its
 * committed rows would vanish on promotion. Refuse rather than guess.
 */
function assertPromotable(ctx: PromotionContext): void {
  if (!fs.existsSync(ctx.livePath)) {
    throw new Error(`no live database to replace: ${ctx.livePath}`)
  }
  if (!fs.existsSync(ctx.stagedPath)) {
    throw new Error(`staged database missing: ${ctx.stagedPath}`)
  }
  if (fs.existsSync(`${ctx.stagedPath}-wal`) || fs.existsSync(`${ctx.stagedPath}-shm`)) {
    throw new Error(`staged database is not sealed — it retained a WAL/SHM sidecar: ${ctx.stagedPath}`)
  }
}

/**
 * The journal chain (the staged DB's actual applied sequence) must be a prefix
 * of the app's bundled sequence. Item-wise — tip membership alone cannot catch a
 * fork (A B′ C vs A B C share the tip but B′ never gets applied). A strict
 * prefix is VALID: the app being ahead simply means DbService migrates the
 * promoted database forward on first open.
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
  logger.warn('Restore refused at admission gate — old DB stays live', { restoreId: ctx.journal.restoreId, reason })
  finalize(ctx, 'expired', reason)
}

// ─── promoting: crash re-entry ───

function recoverPromoting(journal: PromotingJournal): Promise<void> | void {
  const ctx = buildContext(journal)
  const facts = probeFacts(ctx)
  const phase = recoveryPhase(journal.step, facts)
  const action = dbUnitAction(decideRecoveryAction({ phase, ...facts }))
  logger.warn('Resuming an interrupted promotion', { restoreId: journal.restoreId, step: journal.step, phase, action })

  switch (action) {
    case 'complete':
      // The commit landed. Persist it so a later crash needs no probe, then run
      // whatever follows it (integrity).
      finishResources(ctx)
      return executeForward(ctx, persistCommitMarker(journal), COMMIT_INDEX + 1)
    case 'install-forward':
      // Defensive: the marker claims committed while the staged DB is still
      // there, so the rename cannot have landed. Re-run it.
      finishResources(ctx)
      return executeForward(ctx, journal, COMMIT_INDEX)
    case 'discard-staged':
      discardStaged(ctx)
      return failRolledBack(ctx, `rolled back from step '${journal.step}'`)
    case 'restore-aside':
      return revertToAside(ctx, `rolled back from step '${journal.step}'`)
    case 'noop':
      return failRolledBack(ctx, `nothing left to roll back from step '${journal.step}'`)
    case 'abort-inconsistent':
      return failClosed(ctx)
    case 'uninstall':
      // Mapped away by dbUnitAction; kept for exhaustiveness.
      return failClosed(ctx)
  }
}

/**
 * The recovery direction, marker plus filesystem.
 *
 * Markers are written AFTER the action they record, so the commit rename can
 * outlive its own marker by exactly one step. `live-aside` is the only
 * pre-commit step whose successor is the commit, and in every legitimate
 * pre-commit state the staged file still exists — so "staged gone ∧ live present
 * ∧ aside present" at `live-aside` proves the rename landed AND that no revert
 * has re-installed the old database (a finished revert is the only thing that
 * clears the aside). Rolling back there would discard a database that is already
 * live.
 */
function recoveryPhase(step: PromotionStepV2, facts: UnitFacts): RecoveryPhase {
  if (phaseForStep(step) === 'committed') {
    return 'committed'
  }
  return step === 'live-aside' && !facts.staged && facts.live && facts.aside ? 'committed' : 'pre-commit'
}

/**
 * Specialize the generic unit table for the DB unit.
 *
 * `uninstall` is the table's "the target was originally absent, so remove the
 * installed backup" row. The DB unit's target ALWAYS pre-exists — the armed gate
 * refuses to promote without a live database — so that reading cannot apply
 * here: pre-commit with `live` present and no aside can only mean the original
 * is still (or again) in place, either because `live-aside` has not run or
 * because a rollback already put it back. Discarding the staged database is the
 * whole remaining work; removing `live` would delete the user's database.
 */
function dbUnitAction(action: RecoveryAction): RecoveryAction {
  return action === 'uninstall' ? 'discard-staged' : action
}

/**
 * Record the probe-detected commit. If the journal is unwritable the filesystem
 * still proves the commit — and re-proves it to the probe on any later crash —
 * so resume in memory rather than escape to a shell that cannot roll a commit
 * back.
 */
function persistCommitMarker(journal: PromotingJournal): PromotingJournal {
  if (PROMOTION_STEP_ORDER_V2.indexOf(journal.step) >= COMMIT_INDEX) {
    return journal
  }
  try {
    return markStep(journal, DB_COMMIT_STEP)
  } catch (error) {
    logger.error('Probe-detected commit marker could not be persisted — resuming in memory', error as Error)
    return { ...journal, step: DB_COMMIT_STEP }
  }
}

// ─── forward execution ───

/**
 * Run the steps from `startIndex` onward, recording each COMPLETED step so a
 * crash lands in {@link recoverPromoting} with an accurate marker.
 *
 * Marker writes can fail too (disk full, EACCES); the action they record has
 * already succeeded, so the response depends on which side of the commit the
 * step sits. Before it, the write-ahead contract is broken and the old database
 * still exists, so roll back. At or past it the rename is durable and the marker
 * is only a hint, so continue in memory — the on-disk marker then lags at most
 * to `live-aside`, exactly where the probe fires.
 */
async function executeForward(ctx: PromotionContext, journal: PromotingJournal, startIndex: number): Promise<void> {
  let current = journal
  for (let i = startIndex; i < PROMOTION_STEP_ORDER_V2.length; i++) {
    const step = PROMOTION_STEP_ORDER_V2[i]
    try {
      runStep(ctx, step)
    } catch (error) {
      // renameDurable fsyncs AFTER renaming, so a throw at the commit step can
      // arrive with the rename physically landed. Consult the filesystem:
      // "staged gone ∧ live present" here can only mean it ran. Rolling back
      // would revert a database that is already live.
      if (i === COMMIT_INDEX && !fs.existsSync(ctx.stagedPath) && fs.existsSync(ctx.livePath)) {
        logger.error('Commit rename landed but its durability tail failed — continuing in memory', error as Error)
        current = { ...current, step }
        continue
      }
      logger.error(`Promotion step '${step}' failed`, error as Error)
      // One recovery for both sides of the commit: before it the aside does not
      // exist yet and reverting degrades to "drop the staged DB"; after it the
      // promoted database is parked and the aside comes back.
      revertToAside(ctx, `step '${step}' failed: ${(error as Error).message}`)
      return
    }
    try {
      current = markStep(current, step)
    } catch (error) {
      if (i < COMMIT_INDEX) {
        logger.error(`Marker write for '${step}' failed before the commit point — rolling back`, error as Error)
        revertToAside(ctx, `marker write for '${step}' failed`)
        return
      }
      logger.error(`Marker write for '${step}' failed at/past the commit point — continuing in memory`, error as Error)
      current = { ...current, step }
    }
  }
  logger.info('Restore promoted — the new database is live', { restoreId: ctx.journal.restoreId })
  finalizeCompleted(ctx, current.step)
}

function runStep(ctx: PromotionContext, step: PromotionStepV2): void {
  switch (step) {
    case 'gate-passed':
      // Admission marker only — no filesystem action.
      return
    case 'live-checkpointed':
      checkpointLiveDb(ctx.livePath)
      return
    case 'resources-installed':
      // Before the commit boundary on purpose: a resource that cannot be
      // installed must still have the untouched old database to fall back to.
      installResourceUnits(ctx.journal.resourceInstalls, ctx.userData)
      return
    case 'sidecars-removed':
      // Stale live sidecars would be replayed by SQLite over the PROMOTED main
      // file on next open — delete them in the zero-connection window, and only
      // after the checkpoint above has folded them into the file being parked.
      fs.rmSync(`${ctx.livePath}-wal`, { force: true })
      fs.rmSync(`${ctx.livePath}-shm`, { force: true })
      return
    case 'live-aside':
      moveIdempotent(ctx.livePath, ctx.asidePath)
      return
    case 'db-promoted':
      moveIdempotent(ctx.stagedPath, ctx.livePath)
      return
    case 'integrity-ok': {
      const result = integrityCheck(ctx.livePath)
      if (result !== 'ok') {
        throw new Error(`integrity_check on the promoted DB failed: ${result}`)
      }
      return
    }
  }
}

/**
 * Fold the live WAL into the main file (§6.2). Without v1's fingerprint this is
 * the only thing that proves the database about to be parked aside carries the
 * user's last committed transactions — a rename moves the main file alone, so
 * un-checkpointed frames would be lost with the sidecar.
 */
function checkpointLiveDb(livePath: string): void {
  const sqlite = new Database(livePath, { fileMustExist: true })
  try {
    checkpointTruncateAssert(sqlite)
  } finally {
    sqlite.close()
  }
}

function integrityCheck(dbPath: string): string {
  let sqlite: Database.Database | undefined
  try {
    sqlite = new Database(dbPath, { fileMustExist: true })
    return String(sqlite.pragma('integrity_check', { simple: true }))
  } catch (error) {
    // Open failures (missing / locked / not-a-db) are integrity failures too.
    return (error as Error).message
  } finally {
    try {
      sqlite?.close()
    } catch {
      // a corrupt DB may fail to close cleanly; the check result already tells the story
    }
  }
}

// ─── rollback ───

/**
 * Put the pre-restore database back: park whatever currently occupies the live
 * slot (it is either the promoted archive database or an unprovable leftover —
 * either way it is evidence, not garbage), restore the aside, drop the staged
 * database, and mark the attempt failed.
 *
 * Idempotent under re-entry: the park only fires while the aside still exists,
 * so once the restore has run, `live` holds the OLD database and parking it
 * would destroy the very thing this is protecting.
 */
function revertToAside(ctx: PromotionContext, reason: string): void {
  if (fs.existsSync(ctx.livePath) && fs.existsSync(ctx.asidePath)) {
    const parked = path.join(ctx.userData, `restore-failed-${ctx.journal.restoreId}.sqlite`)
    fs.rmSync(parked, { force: true })
    renameDurable(ctx.livePath, parked)
    logger.warn('Parked the rejected database for forensics', { parked })
  }
  restoreLiveFromAside(ctx)
  discardStaged(ctx)
  failRolledBack(ctx, reason)
}

/**
 * Finish a rolled-back attempt: the Full preset's resource units go back out
 * before the journal turns terminal.
 *
 * A restore is ONE replacement. Leaving the archive's files installed over a
 * database that rolled back would produce exactly the mixed state §1 forbids, so
 * this runs on every failing path, including the ones where the database itself
 * had nothing left to undo.
 *
 * A wedged unit cannot hold the database hostage — the cardinal invariant is
 * that the live slot ends up holding a complete database — so the failure is
 * carried into the journal's reason instead: the affected units keep their
 * asides, and acknowledgement will not silently drop them while the user still
 * has a repair to make.
 */
function failRolledBack(ctx: PromotionContext, reason: string): void {
  let suffix = ''
  try {
    recoverResourceUnits(ctx.journal.resourceInstalls, ctx.userData, 'pre-commit')
  } catch (error) {
    logger.error('Resource rollback could not complete — keeping the units and their asides', error as Error)
    suffix = `; resource rollback incomplete: ${(error as Error).message}`
  }
  finalize(ctx, 'failed', `${reason}${suffix}`)
}

/**
 * Bring the resource units to their committed terminal state on a crash re-entry
 * past the commit boundary.
 *
 * Normally a no-op: the install and its marker both precede the commit, so by
 * this point every unit is already installed. A unit that says otherwise is an
 * anomaly, and past the commit there is no rollback left to offer — the database
 * is live. Record it and finish the promotion rather than strand the boot.
 */
function finishResources(ctx: PromotionContext): void {
  try {
    recoverResourceUnits(ctx.journal.resourceInstalls, ctx.userData, 'committed')
  } catch (error) {
    logger.error('Resource units were inconsistent after the commit — continuing with the restored database', {
      restoreId: ctx.journal.restoreId,
      error: (error as Error).message
    })
  }
}

function restoreLiveFromAside(ctx: PromotionContext): void {
  if (fs.existsSync(ctx.asidePath) && !fs.existsSync(ctx.livePath)) {
    renameDurable(ctx.asidePath, ctx.livePath)
  }
}

/**
 * A state the promotion algorithm cannot produce (§6.4's fail-closed rows).
 * Mutate nothing except the cardinal invariant — an empty live slot with the old
 * database parked aside must be undone, or the next boot creates a fresh empty
 * database over the user's data — and keep the staging tree as a repair
 * artifact instead of deleting evidence.
 */
function failClosed(ctx: PromotionContext): void {
  logger.error('Restore recovery hit an inconsistent state — failing closed and keeping the artifacts', {
    restoreId: ctx.journal.restoreId,
    ...probeFacts(ctx)
  })
  restoreLiveFromAside(ctx)
  writeTerminal(ctx, 'failed', 'recovery state was inconsistent; artifacts kept for repair')
}

// ─── terminal bookkeeping ───

/**
 * Every terminal outcome writes the journal state and drops the staging tree —
 * a failed restore is re-run from the archive, never resumed from a half-moved
 * one. The journal itself is kept for post-boot reporting and acknowledgement.
 *
 * THE TERMINAL STATE GOES FIRST. The tree stays protected either way (§6.5 keys
 * protection on the journal EXISTING, and this rewrites it rather than clearing
 * it), while the reverse order has a window that costs data: between dropping
 * the tree and writing the state, a still-`promoting` journal describes rolled
 * back units whose staged copies just vanished — and "live present, nothing
 * staged, no aside" is the one triple the recovery table reads as an installed
 * backup, so the next boot would take the user's own file back out. A crash in
 * the window this order opens instead leaves an orphan tree, which the
 * acknowledgement sweep collects.
 */
function finalize(ctx: PromotionContext, state: 'failed' | 'expired', reason: string): void {
  writeTerminal(ctx, state, reason)
  removeStagingTree(ctx.journal.restoreId)
}

function finalizeCompleted(ctx: PromotionContext, step: PromotionStepV2): void {
  writeRestoreJournalV2({
    ...ctx.journal,
    state: 'completed',
    step,
    // What the post-promotion rebuild must not re-index (§6.7). Full records the
    // Knowledge bases it installed; Lite installs nothing and leaves it empty,
    // which sends the scheduler to the restored database instead.
    summary: {
      knowledgeBaseIds: installedKnowledgeBaseIds(
        ctx.journal.resourceInstalls,
        ctx.userData,
        application.getPath('feature.knowledgebase.data')
      )
    }
  })
  removeStagingTree(ctx.journal.restoreId)
}

function writeTerminal(ctx: PromotionContext, state: 'failed' | 'expired', reason: string): void {
  try {
    writeRestoreJournalV2({ ...ctx.journal, state, reason })
  } catch (error) {
    // The filesystem work is already done and correct; a journal that cannot
    // record it is a reporting loss, not a data loss. Escaping here would send
    // the shell into its last-resort net for no reason.
    logger.error(`Could not write the terminal '${state}' journal`, error as Error)
  }
}

function removeStagingTree(restoreId: string): void {
  fs.rmSync(path.join(application.getPath('feature.backup.restore.staging'), restoreId), {
    recursive: true,
    force: true
  })
}

function discardStaged(ctx: PromotionContext): void {
  fs.rmSync(ctx.stagedPath, { force: true })
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

// ─── context & filesystem primitives ───

function buildContext(journal: ActiveJournal): PromotionContext {
  const userData = application.getPath('app.userdata')
  return {
    journal,
    userData,
    livePath: application.getPath('app.database.file'),
    stagedPath: path.resolve(userData, journal.db.promote),
    asidePath: path.resolve(userData, journal.db.aside)
  }
}

function probeFacts(ctx: PromotionContext): UnitFacts {
  return {
    staged: fs.existsSync(ctx.stagedPath),
    live: fs.existsSync(ctx.livePath),
    aside: fs.existsSync(ctx.asidePath)
  }
}

function markStep(journal: PromotingJournal, step: PromotionStepV2): PromotingJournal {
  const next: PromotingJournal = { ...journal, step }
  writeRestoreJournalV2(next)
  return next
}

/**
 * Move with crash-idempotent semantics: "source gone ∧ target present" means a
 * previous attempt already did it. Both present is a contract violation — fail
 * rather than clobber a database.
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

/**
 * Rename + fsync of the affected directories (POSIX). Without the directory
 * fsync a power cut after the journal recorded a completed step could undo the
 * rename but keep the marker, and recovery would skip a step the filesystem
 * silently rolled back. Windows cannot fsync directory handles; its MoveFileEx
 * is accepted as best-effort, the same trade-off the journal writer makes.
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
