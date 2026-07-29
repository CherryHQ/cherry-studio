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
  findDbAside,
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
type RevertingJournal = Extract<RestoreJournalV2, { state: 'reverting' }>
type FailedJournal = Extract<RestoreJournalV2, { state: 'failed' }>
type CompletedJournal = Extract<RestoreJournalV2, { state: 'completed' }>
type RollbackArmedJournal = Extract<RestoreJournalV2, { state: 'rollback-armed' }>
type ActiveJournal = ArmedJournal | PromotingJournal | RevertingJournal | RollbackArmedJournal

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
    // An unreadable/future journal proves a restore existed but cannot prove
    // which DB/resource moves landed. Quarantining and deleting staging can
    // destroy the only recovery source even when the live DB still exists, so
    // preserve every artifact and fail closed for manual/compatible recovery.
    throw new Error(`Restore journal is unreadable (${read.reason}) — refusing to discard recovery evidence`)
  }
  const journal = read.journal
  switch (journal.state) {
    case 'prepared':
      return expirePrepared(journal)
    case 'armed':
      return promoteArmed(journal)
    case 'promoting':
      return recoverPromoting(journal)
    case 'reverting':
      return finishPostCommitRevert(journal)
    case 'failed':
      // Terminal, with one loose end: a rollback that could not finish holds
      // asides the user cannot release, so retry it before reporting.
      if (journal.recoveryIncomplete) retryIncompleteRollback(journal)
      return
    case 'completed':
      // Terminal, with the mirror-image loose end: a unit that never reached its
      // installed slot is holding storage the user cannot release.
      if (journal.resourcesIncomplete) retryIncompleteInstall(journal)
      return
    case 'rollback-armed':
      return rollbackCompletedRestore(journal)
    case 'rolled-back':
    case 'expired':
      // Terminal. Reporting and acknowledgement cleanup own these.
      return
  }
}

/**
 * Retry the post-commit install a previous boot could not finish.
 *
 * The database is already live, so this is not a promotion — it is the same
 * committed-direction repair {@link finishResources} runs, re-entered once the
 * transient cause (an open handle, a locked directory) is gone with the process
 * that held it. Every unit is decided from its own triple, so re-entry is safe.
 *
 * The marker is cleared FIRST and the staging tree only after. A crash between
 * them leaves a plain `completed` journal and an orphan tree, which
 * acknowledgement collects; the reverse order would delete the units' only
 * remaining source while the journal still promises a retry.
 */
function retryIncompleteInstall(journal: CompletedJournal): void {
  const userData = application.getPath('app.userdata')
  try {
    recoverResourceUnits(journal.resourceInstalls, userData, 'committed')
  } catch (error) {
    logger.error('Resource units still cannot be put in place — keeping them for the next boot', error as Error)
    throw error
  }

  const settled: CompletedJournal = { ...journal }
  delete settled.resourcesIncomplete
  writeRestoreJournalV2(settled)
  removeStagingTree(journal.restoreId)
  logger.info('Finished an install a previous boot left incomplete', {
    restoreId: journal.restoreId
  })
}

/**
 * Retry a rollback a previous boot could not finish.
 *
 * The usual causes — a file still open, a directory the OS had locked — do not
 * survive a restart, and `recoverResourceUnits` decides each unit from its own
 * triple, so re-entering it is safe and usually resolves. This is the only path
 * that can release those asides: while the marker stands they are protected from
 * the sweep and refused to acknowledgement, which is correct while a repair is
 * outstanding and a permanent cost if nothing ever retries.
 *
 * The marker is cleared LAST and the staging tree is left for acknowledgement to
 * collect. Removing the tree first would put every just-restored unit into the
 * one triple recovery reads as "an installed backup with no aside", so a crash
 * before the marker was cleared would send the next boot's retry out to move the
 * user's own files back out — the exact loss this whole ordering exists to stop.
 */
function retryIncompleteRollback(journal: FailedJournal): void {
  const userData = application.getPath('app.userdata')
  try {
    recoverResourceUnits(journal.resourceInstalls, userData, 'pre-commit')
  } catch (error) {
    logger.error('Resource rollback still cannot complete — keeping the asides for the next boot', error as Error)
    throw error
  }

  const completed: FailedJournal = { ...journal }
  delete completed.recoveryIncomplete
  writeRestoreJournalV2(completed)
  logger.info('Finished a rollback a previous boot left incomplete', {
    restoreId: journal.restoreId
  })
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
  if (journal.state === 'promoting' && recoveryPhase(journal.step, facts) === 'committed') {
    logger.warn('Escaped crash left a committed promotion — keeping it resumable for the next boot', {
      restoreId: journal.restoreId
    })
    return
  }
  restoreLiveFromAside(ctx)
  failRolledBack(ctx, 'promotion crashed outside its own recovery')
}

/**
 * Whether an explicit user-approved rollback has not reached its durable
 * terminal marker. The preboot shell must fail fast on an escaped error in this
 * state: booting with only some resource units reversed would expose a mixed
 * database/filesystem state.
 *
 * `armed` counts. This is only ever consulted after the promotion escaped, and
 * a journal still armed at that point means the gate could not record ANY
 * outcome for a restore the user consented to — including the terminal write
 * itself failing. Booting on would leave that consent standing for the next
 * launch to act on with no record of what this one already did.
 */
export function isRestoreRecoveryPendingV2(): boolean {
  const read = readRestoreJournalV2()
  if (read.kind === 'corrupt') return true
  return (
    read.kind === 'ok' &&
    (read.journal.state === 'armed' ||
      read.journal.state === 'promoting' ||
      read.journal.state === 'reverting' ||
      read.journal.state === 'rollback-armed' ||
      (read.journal.state === 'completed' && read.journal.resourcesIncomplete === true) ||
      (read.journal.state === 'failed' && read.journal.recoveryIncomplete === true))
  )
}

/**
 * Whether the user's database is stranded: the live slot is empty while this
 * machinery's aside still holds the previous one. Booting on from here would
 * create a fresh empty database on first open. A missing live database with no
 * journal is not this machinery's doing and stays out of scope.
 *
 * An UNREADABLE journal counts, and cannot ask the journal where its aside is —
 * so the aside is found by the park-slot naming this module and the producer
 * share ({@link findDbAside}). Evidence, not assumption: with no aside there is
 * nothing to strand and nothing to protect, and refusing the boot would only
 * wedge an app whose data is already gone.
 */
export function isLiveDbStrandedV2(): boolean {
  const read = readRestoreJournalV2()
  if (read.kind === 'none') {
    return false
  }
  if (fs.existsSync(application.getPath('app.database.file'))) {
    return false
  }
  if (read.kind === 'corrupt') {
    return findDbAside() !== null
  }
  return fs.existsSync(path.resolve(application.getPath('app.userdata'), read.journal.db.aside))
}

// ─── prepared: expire, never promote ───

/**
 * A preparation this boot found unarmed. The user never confirmed it (or
 * confirmed and the relaunch never happened), so the only safe reading is that
 * they walked away: freeze the journal to `expired` and drop the staging tree.
 *
 * Terminal state first, tree second, like every other terminal outcome (§6.5):
 * the tree's protection keys on the journal EXISTING and this rewrites rather
 * than clears it, so the tree is covered throughout — while the reverse order
 * deletes a tree the on-disk journal still describes as preparable, and a write
 * that then fails leaves a `prepared` journal pointing at nothing.
 */
function expirePrepared(journal: PreparedJournal): void {
  logger.info('Found an unarmed preparation at boot — expiring it', {
    restoreId: journal.restoreId
  })
  writeRestoreJournalV2({
    ...journal,
    state: 'expired',
    reason: 'the preparation was never armed; an unrelated restart expired it'
  })
  removeStagingTree(journal.restoreId)
}

// ─── armed: admission gate, then forward execution ───

async function promoteArmed(journal: ArmedJournal): Promise<void> {
  const ctx = buildContext(journal)

  const refusal = admissionRefusal(ctx)
  if (refusal !== null) {
    return expire(ctx, refusal)
  }

  logger.info('Restore admission gate passed, promoting', {
    restoreId: journal.restoreId
  })
  const promoting = markStep({ ...journal, state: 'promoting', step: 'gate-passed' }, 'gate-passed')
  await executeForward(ctx, promoting, PROMOTION_STEP_ORDER_V2.indexOf('gate-passed') + 1)
}

/**
 * Why this restore may not proceed, or `null` if it may. Reported rather than
 * thrown so the refusal is separate from expiring on it: {@link expire} itself
 * throws when its terminal journal will not persist, and a thrown refusal would
 * catch that and try to expire a second time.
 */
function admissionRefusal(ctx: PromotionContext): string | null {
  try {
    assertPromotable(ctx)
    return chainIsBundledPrefix(ctx.journal.db.chain)
      ? null
      : 'journal chain is not a prefix of the bundled migration chain (fork or ahead-of-code DB)'
  } catch (error) {
    return `admission gate failed: ${(error as Error).message}`
  }
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
  const bundled = readMigrationFiles({
    migrationsFolder: application.getPath('app.database.migrations')
  })
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
  finalize(ctx, 'expired', reason)
}

// ─── promoting: crash re-entry ───

function recoverPromoting(journal: PromotingJournal): Promise<void> | void {
  const ctx = buildContext(journal)
  const facts = probeFacts(ctx)
  const phase = recoveryPhase(journal.step, facts)
  const action = dbUnitAction(decideRecoveryAction({ phase, ...facts }))
  logger.warn('Resuming an interrupted promotion', {
    restoreId: journal.restoreId,
    step: journal.step,
    phase,
    action
  })

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
 * still exists, so roll back. At or past it the rename has landed (and is
 * power-loss durable on POSIX); the marker is only a hint, so continue in memory
 * — the on-disk marker then lags at most to `live-aside`, exactly where the
 * process-crash probe fires. Windows sudden power loss remains outside contract.
 *
 * A resource repair that cannot finish escapes under the active journal; the
 * preboot shell blocks this launch and retries before normal services start.
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
      const reason = `step '${step}' failed: ${(error as Error).message}`
      if (i > COMMIT_INDEX) {
        beginPostCommitRevert(current, reason)
      } else {
        revertToAside(ctx, reason)
      }
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
  logger.info('Restore promoted — the new database is live', {
    restoreId: ctx.journal.restoreId
  })
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
 * Persist the reverse direction before touching a committed database or its
 * resources. A crash after this write can no longer reinterpret an already
 * restored old database as a successful forward promotion.
 */
function beginPostCommitRevert(journal: PromotingJournal, reason: string): void {
  const reverting: RevertingJournal = { ...journal, state: 'reverting', reason }
  writeRestoreJournalV2(reverting)
  finishPostCommitRevert(reverting)
}

/**
 * Finish a failed post-commit promotion in the durable reverse direction.
 * Resources return first; the old database returns last as the reverse commit
 * boundary. Until all moves converge the `reverting` marker remains and the
 * preboot shell refuses to start normal services.
 */
function finishPostCommitRevert(journal: RevertingJournal): void {
  assertReverseIsProvable(journal)
  const ctx = buildContext(journal)
  const parked = rolledForwardDbPath(ctx)

  recoverResourceUnits(journal.resourceInstalls, ctx.userData, 'pre-commit')

  const live = fs.existsSync(ctx.livePath)
  const aside = fs.existsSync(ctx.asidePath)
  const parkedExists = fs.existsSync(parked)
  if (live) assertRegularRollbackDb(ctx.livePath, 'revert live')
  if (aside) assertRegularRollbackDb(ctx.asidePath, 'revert previous aside')
  if (parkedExists) assertRegularRollbackDb(parked, 'revert rejected parked')
  if (aside) {
    if (live) {
      if (parkedExists) {
        throw new Error('post-commit revert cannot park the rejected database: destination already exists')
      }
      renameDurable(ctx.livePath, parked)
    }
    restoreLiveFromAside(ctx)
  } else if (!live || !parkedExists) {
    throw new Error('post-commit revert cannot prove previous-live plus rejected-parked state')
  }

  if (!fs.existsSync(ctx.livePath) || !fs.existsSync(parked) || fs.existsSync(ctx.asidePath)) {
    throw new Error('post-commit revert did not converge to previous-live plus rejected-parked')
  }
  const result = integrityCheck(ctx.livePath)
  if (result !== 'ok') {
    throw new Error(`integrity_check on the reverted database failed: ${result}`)
  }

  finalize(ctx, 'failed', journal.reason)
}

/**
 * Refuse to carry out a reverse direction whose units cannot say what they
 * replaced.
 *
 * Both reverse paths take units OUT of their live slots, and the one triple
 * that makes that safe — `-L-`, "no aside because the target was originally
 * absent" — is exactly the one an entry without `hadLive` cannot distinguish
 * from "the aside holding the user's original is gone". Boot rather than guess:
 * an armed reverse this old can only come from a pre-release build, and the
 * journal plus every artifact stays untouched for a build that understands it.
 *
 * Forward promotion is deliberately not gated the same way. It never removes a
 * live node it did not itself install, so an unprovable entry costs it nothing.
 */
function assertReverseIsProvable(journal: RevertingJournal | RollbackArmedJournal): void {
  if (journal.resourceInstalls.every((entry) => entry.hadLive !== undefined)) return
  logger.error('Refusing a reverse direction from a journal that predates the aside-origin record', {
    restoreId: journal.restoreId,
    state: journal.state
  })
  throw new Error(
    `restore journal ${journal.restoreId} was written by an earlier build that did not record what each resource replaced — refusing to reverse it`
  )
}

/**
 * Reverse a completed restore after explicit user consent.
 *
 * Resources move first and the database moves last, mirroring forward promotion:
 * the DB rename is again the commit boundary. The `rollback-armed` marker is the
 * durable direction, so every crash re-enters this function and finishes the
 * reverse moves. Nothing is deleted here: the displaced restored resources stay
 * in their staging slots and the restored DB stays in `restore-failed-*` until
 * acknowledgement releases them after the terminal marker is durable.
 */
function rollbackCompletedRestore(journal: RollbackArmedJournal): void {
  assertReverseIsProvable(journal)
  const ctx = buildContext(journal)
  const parked = rolledForwardDbPath(ctx)
  const live = fs.existsSync(ctx.livePath)
  const aside = fs.existsSync(ctx.asidePath)
  const parkedExists = fs.existsSync(parked)

  // Unlike forward promotion, explicit rollback can be requested after the app
  // has run for a while. Re-prove every DB artifact before SQLite opens or a
  // rename moves it; a replaced symlink must not redirect recovery elsewhere.
  if (live) assertRegularRollbackDb(ctx.livePath, 'live')
  if (aside) assertRegularRollbackDb(ctx.asidePath, 'previous aside')
  if (parkedExists) assertRegularRollbackDb(parked, 'displaced restored')

  // Initial reverse entry. Fold every committed frame into the restored main
  // file before parking it, so the copy retained until acknowledgement is whole.
  if (live && aside && !parkedExists) {
    checkpointLiveDb(ctx.livePath)
    fs.rmSync(`${ctx.livePath}-wal`, { force: true })
    fs.rmSync(`${ctx.livePath}-shm`, { force: true })
  } else if (live && aside && parkedExists) {
    throw new Error('rollback state is inconsistent: live, previous aside, and displaced restored DB all exist')
  } else if (!aside && (!live || !parkedExists)) {
    throw new Error('rollback source is missing or the previous database cannot be proven live')
  }

  // Pre-commit direction restores old targets and parks restored targets back in
  // their operation-owned staging slots. It is move-only and safe to re-enter.
  recoverResourceUnits(journal.resourceInstalls, ctx.userData, 'pre-commit')

  if (fs.existsSync(ctx.asidePath)) {
    if (fs.existsSync(ctx.livePath)) {
      if (fs.existsSync(parked)) {
        throw new Error('rollback cannot park the restored database: destination already exists')
      }
      renameDurable(ctx.livePath, parked)
    }
    restoreLiveFromAside(ctx)
  }

  if (!fs.existsSync(ctx.livePath) || !fs.existsSync(parked) || fs.existsSync(ctx.asidePath)) {
    throw new Error('rollback did not converge to previous-live plus displaced-restored')
  }
  const result = integrityCheck(ctx.livePath)
  if (result !== 'ok') {
    throw new Error(`integrity_check on the rolled-back DB failed: ${result}`)
  }

  writeRestoreJournalV2({ ...journal, state: 'rolled-back' })
  logger.info('Restore rolled back — previous data is live', {
    restoreId: journal.restoreId
  })
}

function rolledForwardDbPath(ctx: PromotionContext): string {
  return path.join(ctx.userData, `restore-failed-${ctx.journal.restoreId}.sqlite`)
}

function assertRegularRollbackDb(dbPath: string, role: string): void {
  const stats = fs.lstatSync(dbPath)
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`rollback ${role} database is not a regular file: ${dbPath}`)
  }
}

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
 * Finish a rolled-back attempt: the restore's resource units go back out before
 * the journal turns terminal.
 *
 * A restore is ONE replacement. Leaving the archive's files installed over a
 * database that rolled back would produce exactly the mixed state §1 forbids, so
 * this runs on every failing path, including the ones where the database itself
 * had nothing left to undo.
 *
 * If any unit cannot return, this function throws under the still-active
 * journal. The preboot shell then refuses this launch instead of exposing the
 * old database beside archive resources.
 */
function failRolledBack(ctx: PromotionContext, reason: string): void {
  // Do not turn an incomplete reverse move into a terminal state. The existing
  // promoting marker still carries the pre-commit direction, and escaping keeps
  // preboot closed until a later attempt puts every original resource back.
  recoverResourceUnits(ctx.journal.resourceInstalls, ctx.userData, 'pre-commit')
  finalize(ctx, 'failed', reason)
}

/**
 * Bring resource units to their committed terminal state on crash re-entry.
 * Normally this is a no-op because install precedes DB commit. Any anomaly must
 * settle before boot; the active marker retains both copies for the retry.
 */
function finishResources(ctx: PromotionContext): void {
  // A committed database and incomplete resources are not a usable terminal
  // state. Let the error escape under the still-promoting journal so preboot
  // blocks this launch and retries before any normal service opens the DB.
  recoverResourceUnits(ctx.journal.resourceInstalls, ctx.userData, 'committed')
}

function restoreLiveFromAside(ctx: PromotionContext): void {
  if (fs.existsSync(ctx.asidePath) && !fs.existsSync(ctx.livePath)) {
    renameDurable(ctx.asidePath, ctx.livePath)
  }
}

/**
 * A state the promotion algorithm cannot produce (§6.4's fail-closed rows).
 * Mutate nothing and keep every artifact for repair. The preboot shell separately
 * refuses an empty live slot and every still-active recovery direction.
 */
function failClosed(ctx: PromotionContext): never {
  const facts = probeFacts(ctx)
  logger.error('Restore recovery hit an inconsistent state — refusing to mutate or boot', {
    restoreId: ctx.journal.restoreId,
    ...facts
  })
  throw new Error(
    `restore recovery state is inconsistent: staged=${facts.staged} live=${facts.live} aside=${facts.aside}`
  )
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
 *
 * A terminal state that will not persist is not a terminal state. Every
 * filesystem move this outcome needed has already landed, but the journal on
 * disk still describes the restore as in flight, so the process must not go on
 * to boot: it would run with an active journal claiming a direction this boot
 * already carried out. The throw reaches the preboot gate's fail-closed path,
 * which keeps the app shut while the journal, the staging tree, and both
 * database copies stay exactly as they are — the next boot re-decides from the
 * same evidence and retries the same terminal write.
 */
function finalize(
  ctx: PromotionContext,
  state: 'failed' | 'expired',
  reason: string,
  recoveryIncomplete = false
): void {
  if (!writeTerminal(ctx, state, reason, recoveryIncomplete)) {
    // Nothing may be deleted on the strength of a state that was never
    // recorded: dropping the tree here would leave exactly the triple this
    // ordering exists to avoid — see above — and the next boot would take the
    // user's own files back out.
    logger.error('Keeping the staging tree: the terminal journal is not on disk', {
      restoreId: ctx.journal.restoreId
    })
    throw new Error(`terminal '${state}' journal is not durable — refusing to boot on an unrecorded restore outcome`)
  }
  if (recoveryIncomplete) {
    // The wedged units' archive copies still need somewhere to go when the
    // rollback is retried at the next boot.
    return
  }
  removeStagingTree(ctx.journal.restoreId)
}

/** The database and every resource are live; record success, then clean staging. */
function finalizeCompleted(ctx: PromotionContext, step: PromotionStepV2): void {
  writeRestoreJournalV2({
    ...ctx.journal,
    state: 'completed',
    step,
    // Exactly the transported Knowledge bases eligible for restore-only rebuild
    // (§6.7). An archive that installed no material schedules nothing.
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

/**
 * Write the terminal journal, reporting whether it is durably on disk.
 *
 * Reported rather than thrown from here so the decision stays with
 * {@link finalize}: what may still be deleted, and what the failure means for
 * this boot, depends on the outcome being recorded — not on the write.
 */
function writeTerminal(
  ctx: PromotionContext,
  state: 'failed' | 'expired',
  reason: string,
  recoveryIncomplete = false
): boolean {
  try {
    writeRestoreJournalV2({
      ...ctx.journal,
      state,
      reason,
      // Only the `failed` variant declares it, and the journal is strict.
      ...(state === 'failed' && recoveryIncomplete ? { recoveryIncomplete: true as const } : {})
    })
    return true
  } catch (error) {
    logger.error(`Could not write the terminal '${state}' journal`, error as Error)
    return false
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
 * silently rolled back. Windows cannot fsync directory handles and Node/libuv
 * does not request `MOVEFILE_WRITE_THROUGH`; the Windows contract is therefore
 * process-crash recovery, not sudden-power-loss metadata durability.
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
