import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import Database from 'better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import type { AppliedMigration } from './appliedChain'
import { checkpointTruncateAssert } from './checkpoint'
import { hashDbFile } from './hashDbFile'
import type { PromotionStep, RestoreJournal } from './restoreJournalV1Compat'
import {
  PROMOTION_STEP_ORDER,
  readRestoreJournal,
  removeRestoreJournal,
  writeRestoreJournal
} from './restoreJournalV1Compat'

const logger = loggerService.withContext('RestorePromotion')

function assertNever(x: never): never {
  throw new Error(`Unhandled discriminant: ${JSON.stringify(x)}`)
}

type StagedJournal = Extract<RestoreJournal, { state: 'staged' }>
type PromotingJournal = Extract<RestoreJournal, { state: 'promoting' }>
type RevertingJournal = Extract<RestoreJournal, { state: 'reverting' }>
type ActiveJournal = StagedJournal | PromotingJournal | RevertingJournal
type FileResource = RestoreJournal['fileResources'][number]

/**
 * After this step the work database IS the live database: crash recovery at
 * or past it must resume forward; before it, roll back. Ordering goes through
 * PROMOTION_STEP_ORDER.indexOf — see the warning on that constant.
 */
const COMMIT_STEP: PromotionStep = 'work-promoted'

interface PromotionContext {
  readonly journal: ActiveJournal
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
 * (backupRestoreGate.ts) swallows those — unless recovery left no live DB at
 * all (see isLiveDbStranded) — because a preboot exception would dead-loop
 * the "Unable to Start" fail-fast path.
 */
export async function runRestorePromotion(): Promise<void> {
  const read = readRestoreJournal()
  if (read.kind === 'none') {
    return
  }
  if (read.kind === 'corrupt') {
    throw new Error(`Restore journal is unreadable — refusing to discard recovery evidence: ${read.error}`)
  }
  const journal = read.journal
  switch (journal.state) {
    case 'completed':
    case 'failed':
    case 'expired':
      // The gate shell consumes terminal journals after its stranded-DB check.
      return
    case 'staged':
      return promoteStaged(journal)
    case 'promoting':
      return recoverPromoting(journal)
    case 'reverting':
      return finishPostCommitRevert(journal)
  }
}

/**
 * Consume terminal restore artifacts after the gate has proved that no live
 * database is stranded. Active and corrupt journals remain untouched.
 */
export function cleanupTerminalRestoreArtifacts(): void {
  const read = readRestoreJournal()
  if (read.kind !== 'ok') {
    return
  }
  const journal = read.journal
  if (journal.state === 'staged' || journal.state === 'promoting' || journal.state === 'reverting') {
    return
  }

  const stagingRoot = application.getPath('feature.backup.restore.staging')
  fs.rmSync(path.join(stagingRoot, journal.restoreId), { recursive: true, force: true })
  removeRestoreJournal()
  logger.info('Terminal restore journal consumed and removed', {
    restoreId: journal.restoreId,
    state: journal.state,
    step: journal.step
  })
}

/**
 * Last-resort net for a crash that ESCAPED runRestorePromotion — called only
 * by the gate shell's catch. Escaped throws are precisely the cases in-band
 * recovery could not handle. A promoting or reverting journal may still need
 * its staging tree to retry an incomplete inverse, so the crash net preserves
 * all active evidence and lets the gate block boot. Only a staged journal has
 * not crossed a destructive boundary and can be terminalized here.
 *
 * Must never throw beyond what the shell already guards.
 */
export function markRestoreFailedAfterCrash(): void {
  const read = readRestoreJournal()
  if (read.kind !== 'ok') {
    return
  }
  const journal = read.journal
  if (journal.state === 'reverting' || journal.state === 'promoting') {
    // A promotion may have failed while its inverse was still returning old
    // resources or moving the old DB back. Its journal and staging tree are
    // the only retry evidence, so the crash net must never terminalize it.
    logger.warn('Escaped crash left active restore recovery — preserving retry evidence', {
      restoreId: journal.restoreId,
      state: journal.state
    })
    return
  }
  if (journal.state !== 'staged') return
  const ctx = buildContext(journal)
  finalize(ctx, 'failed')
}

/**
 * Whether the user's database is stranded: the live slot is empty while this
 * machinery's aside still holds the previous database. The shell checks this
 * after an escaped crash — booting on from here would CREATE a fresh empty
 * database on first open, with the user's data invisible in the aside. A
 * missing live DB with no journal (or a corrupt one) is not this machinery's
 * doing and stays out of scope.
 */
export function isLiveDbStranded(): boolean {
  const read = readRestoreJournal()
  if (read.kind !== 'ok') {
    return false
  }
  const livePath = application.getPath('app.database.file')
  const asidePath = path.resolve(application.getPath('app.userdata'), read.journal.db.aside)
  return !fs.existsSync(livePath) && fs.existsSync(asidePath)
}

/** Active or corrupt v1 evidence must keep preboot from exposing a mixed restore. */
export function isRestoreRecoveryPending(): boolean {
  const read = readRestoreJournal()
  return (
    read.kind === 'corrupt' || (read.kind === 'ok' && ['staged', 'promoting', 'reverting'].includes(read.journal.state))
  )
}

function buildContext(journal: ActiveJournal): PromotionContext {
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
    assertNoAddConflicts(ctx)
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
 * Admission preflight: add targets must not pre-exist (the writer contract
 * moveIdempotent also enforces per move). Refusing up front turns what would
 * be a mid-apply conflict throw + rollback into a clean expire that provably
 * touched nothing.
 */
function assertNoAddConflicts(ctx: PromotionContext): void {
  for (const entry of ctx.journal.fileResources) {
    if (entry.kind === 'blob-add' || entry.kind === 'dir-add' || entry.kind === 'note-add') {
      const live = resolveEntry(ctx, entry.livePath)
      if (fs.existsSync(live)) {
        throw new Error(`add target already exists: ${entry.livePath} (${entry.kind})`)
      }
    }
  }
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
  // A parked candidate is reverse-direction evidence even if the old marker
  // lagged before the commit step. Mark that direction before inspecting or
  // mutating anything else; a pre-existing parked file plus both live and
  // aside is ambiguous and must fail closed rather than delete it.
  if (fs.existsSync(parkedDbPath(ctx))) {
    logger.warn('Crash left post-commit reverse evidence — recording and finishing the revert', {
      restoreId: journal.restoreId,
      step: journal.step
    })
    beginPostCommitRevert(journal)
    return
  }
  if (order < commit) {
    // Commit-boundary marker lag: the work→live rename (fsynced) can outlive
    // its own journal marker when the crash lands between the two writes.
    // Markers lag their action by at most one step, and in every legitimate
    // pre-commit state the work file still exists — so "work gone ∧ live
    // present ∧ aside present" at step live-aside proves the commit rename
    // landed AND no revert has re-installed the old DB (a finished aside
    // restore is the only thing that clears the aside slot). Rolling back
    // here would delete the additive files the now-live new DB references
    // while the aside guard leaves the new DB in place — the forbidden third
    // state. Resume instead. Without the aside check an interrupted revert
    // (old DB already back, marker still stuck at live-aside) would match
    // this pattern and mis-resume forward; with it, that state falls through
    // to the rollback below, which correctly finishes undoing the manifest
    // on the already-restored old DB.
    if (
      journal.step === 'live-aside' &&
      !fs.existsSync(ctx.workPath) &&
      fs.existsSync(ctx.livePath) &&
      fs.existsSync(ctx.asidePath)
    ) {
      logger.warn('Commit rename landed but its marker lagged — resuming promotion', {
        restoreId: journal.restoreId
      })
      let resumed: PromotingJournal
      try {
        resumed = markStep(journal, COMMIT_STEP)
      } catch (error) {
        // The journal is unwritable, but the FS already proves the commit —
        // and re-proves it to the probe on any later crash. Resume in memory
        // rather than escape to the shell, which cannot roll a commit back.
        logger.error('Probe-detected commit marker could not be persisted — resuming in memory', error as Error)
        resumed = { ...journal, step: COMMIT_STEP }
      }
      await executeForward(ctx, resumed)
      return
    }
    logger.warn('Crash before the commit point — rolling back to the old DB', {
      restoreId: journal.restoreId,
      step: journal.step
    })
    rollbackPreCommit(ctx)
    return
  }
  // Forward resume is legitimate only while the committed state is intact:
  // new DB live AND old DB parked aside. A cleared aside means an interrupted
  // revert already re-installed the old DB — resuming forward would
  // integrity-check the (valid) old DB and misreport the restore as
  // completed. Finish the revert instead (idempotent by its aside guards).
  if (!fs.existsSync(ctx.asidePath)) {
    logger.warn('Crash inside an interrupted post-commit revert — recording and finishing the revert', {
      restoreId: journal.restoreId,
      step: journal.step
    })
    beginPostCommitRevert(journal)
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
 *
 * Marker writes can fail too (disk full, EACCES) — the action they record has
 * already succeeded, so the response depends on which side of the commit
 * point the step sits: before it, the write-ahead contract is broken (a later
 * crash could lag more steps than the FS probe covers) and the old DB still
 * exists, so roll back; at/past it the commit rename is durable and the
 * marker is only a recovery hint, so continue in memory — if the terminal
 * write fails as well, the on-disk journal lags at most one step (or sits at
 * live-aside, where the FS probe fires) and the next boot resumes.
 */
async function executeForward(ctx: PromotionContext, journal: PromotingJournal): Promise<void> {
  let current = journal
  const commitIndex = PROMOTION_STEP_ORDER.indexOf(COMMIT_STEP)
  for (let i = PROMOTION_STEP_ORDER.indexOf(current.step) + 1; i < PROMOTION_STEP_ORDER.length; i++) {
    const step = PROMOTION_STEP_ORDER[i]
    try {
      runStep(ctx, step)
    } catch (error) {
      // The commit step's rename is the point of no return, and renameDurable
      // fsyncs the affected directories AFTER renaming — so this throw can
      // arrive with the work→live rename already physically landed. Consult
      // the FS: "work gone ∧ live present" inside this catch can only mean
      // the rename ran (every earlier throw site leaves work in place or
      // live absent). Rolling back would strip the additives off the
      // now-live new DB and delete the staging tree while the aside guard
      // leaves the new DB live — the forbidden third state. Treat it like a
      // lagged commit marker instead: continue in memory, leaving the
      // on-disk marker at live-aside (the last durably-fsynced one), which
      // is exactly the state the recoverPromoting probe re-derives if a
      // later crash intervenes.
      if (i === commitIndex && !fs.existsSync(ctx.workPath) && fs.existsSync(ctx.livePath)) {
        logger.error('Commit rename landed but its durability tail failed — continuing in memory', error as Error)
        current = { ...current, step }
        continue
      }
      logger.error(`Promotion step '${step}' failed`, error as Error)
      if (i <= commitIndex) {
        rollbackPreCommit(ctx)
      } else {
        beginPostCommitRevert(current)
      }
      return
    }
    try {
      current = markStep(current, step)
    } catch (error) {
      if (i < commitIndex) {
        logger.error(`Marker write for '${step}' failed before the commit point — rolling back`, error as Error)
        rollbackPreCommit(ctx)
        return
      }
      logger.error(`Marker write for '${step}' failed at/past the commit point — continuing in memory`, error as Error)
      current = { ...current, step }
    }
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
  const failures = inverseManifest(ctx)
  collectFailure(failures, 'restoring the old database', () => restoreLiveFromAside(ctx))
  collectFailure(failures, 'proving the old database was restored', () => assertOldDatabaseRestored(ctx))
  failures.push(...manifestRollbackFailures(ctx))
  if (failures.length > 0) throw restoreRecoveryIncomplete('pre-commit rollback', failures)
  finalize(ctx, 'failed')
}

/** Persist the reverse direction before touching either database rename. */
function beginPostCommitRevert(journal: PromotingJournal): void {
  const reverting: RevertingJournal = { ...journal, state: 'reverting' }
  writeRestoreJournal(reverting)
  finishPostCommitRevert(reverting)
}

/**
 * Resume a marked post-commit revert. The parked candidate is never removed:
 * its presence is evidence of a completed first reverse rename, and any
 * unrecognized combination is ambiguous rather than a deletion opportunity.
 */
function finishPostCommitRevert(journal: RevertingJournal): void {
  const ctx = buildContext(journal)
  const parked = parkedDbPath(ctx)
  const live = fs.existsSync(ctx.livePath)
  const aside = fs.existsSync(ctx.asidePath)
  const parkedExists = fs.existsSync(parked)

  if (live && aside && !parkedExists) {
    assertRegularFile(ctx.livePath, 'promoted database')
    assertRegularFile(ctx.asidePath, 'previous database')
    renameDurable(ctx.livePath, parked)
    renameDurable(ctx.asidePath, ctx.livePath)
    logger.warn('Promoted DB failed post-commit checks — parked for forensics', { parked })
  } else if (!live && aside && parkedExists) {
    assertRegularFile(ctx.asidePath, 'previous database')
    assertRegularFile(parked, 'parked promoted database')
    renameDurable(ctx.asidePath, ctx.livePath)
  } else if (!(live && !aside && parkedExists)) {
    throw new Error('post-commit revert cannot prove a complete old database')
  }

  const failures = inverseManifest(ctx)
  collectFailure(failures, 'proving the old database was restored', () => assertOldDatabaseRestored(ctx))
  failures.push(...manifestRollbackFailures(ctx))
  if (failures.length > 0) throw restoreRecoveryIncomplete('post-commit revert', failures)
  finalize(ctx, 'failed', journal.step)
}

function restoreLiveFromAside(ctx: PromotionContext): void {
  if (fs.existsSync(ctx.asidePath) && !fs.existsSync(ctx.livePath)) {
    renameDurable(ctx.asidePath, ctx.livePath)
  }
}

/**
 * Undo every manifest operation that (may) have happened, in reverse of the
 * apply direction. Every entry is attempted even when one is blocked, but a
 * failed inverse is deliberately returned to its caller: terminal cleanup
 * would otherwise erase the only retry source and leave old DB + new files.
 */
function inverseManifest(ctx: PromotionContext): Error[] {
  const failures: Error[] = []
  for (const entry of ctx.journal.fileResources) {
    try {
      inverseEntry(ctx, entry)
    } catch (error) {
      const failure = error as Error
      logger.error(`Manifest inverse failed for '${entry.livePath}' (${entry.kind}) — continuing`, failure)
      failures.push(failure)
    }
  }
  return failures
}

function inverseEntry(ctx: PromotionContext, entry: FileResource): void {
  const live = resolveEntry(ctx, entry.livePath)
  switch (entry.kind) {
    case 'blob-add':
    case 'note-add':
    case 'dir-add': {
      // Rename-back, never delete: "staging source gone" is the only proof
      // this promotion moved the target in. On a conflicted entry the source
      // still sits in staging and the live target belongs to someone else —
      // deleting it would be unrecoverable loss of data the old DB may
      // reference. The returned copy is discarded with the staging tree.
      const source = resolveEntry(ctx, entry.stagingPath)
      if (!fs.existsSync(source) && fs.existsSync(live)) {
        renameDurable(live, source)
      }
      return
    }
    case 'note-overwrite':
    case 'overwrite': {
      const aside = entry.asidePath ? resolveEntry(ctx, entry.asidePath) : undefined
      if (aside && fs.existsSync(aside)) {
        // `overwrite` covers both files and whole directories. A failed
        // promotion must clear either shape before restoring its aside.
        fs.rmSync(live, { recursive: true, force: true })
        renameDurable(aside, live)
      }
      return
    }
    default:
      assertNever(entry.kind)
  }
}

function manifestRollbackFailures(ctx: PromotionContext): Error[] {
  const failures: Error[] = []
  for (const entry of ctx.journal.fileResources) {
    try {
      assertEntryRestored(ctx, entry)
    } catch (error) {
      failures.push(error as Error)
    }
  }
  return failures
}

function assertEntryRestored(ctx: PromotionContext, entry: FileResource): void {
  const live = resolveEntry(ctx, entry.livePath)
  const staging = resolveEntry(ctx, entry.stagingPath)
  switch (entry.kind) {
    case 'blob-add':
    case 'note-add':
    case 'dir-add':
      // Both present means this promotion never moved the staging source; the
      // live target is therefore foreign data that rollback must not delete.
      if (!fs.existsSync(staging) && fs.existsSync(live)) {
        throw new Error(`added resource remains live: ${entry.livePath}`)
      }
      if (!fs.existsSync(staging) && !fs.existsSync(live)) {
        throw new Error(`added resource cannot be proven restored: ${entry.livePath}`)
      }
      return
    case 'note-overwrite':
    case 'overwrite': {
      const aside = entry.asidePath ? resolveEntry(ctx, entry.asidePath) : undefined
      if (!fs.existsSync(live)) throw new Error(`overwritten resource is missing: ${entry.livePath}`)
      if (aside && fs.existsSync(aside)) throw new Error(`original resource remains aside: ${entry.livePath}`)
      return
    }
    default:
      assertNever(entry.kind)
  }
}

function assertOldDatabaseRestored(ctx: PromotionContext): void {
  if (fs.existsSync(ctx.asidePath)) throw new Error('previous database remains parked aside')
  assertRegularFile(ctx.livePath, 'restored database')
  const result = integrityCheck(ctx.livePath)
  if (result !== 'ok') throw new Error(`integrity_check on the restored DB failed: ${result}`)
}

function assertRegularFile(filePath: string, role: string): void {
  const stats = fs.lstatSync(filePath)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${role} is not a regular file`)
}

function parkedDbPath(ctx: PromotionContext): string {
  return path.join(ctx.userData, `work-failed-${ctx.journal.restoreId}.sqlite`)
}

function collectFailure(failures: Error[], action: string, operation: () => void): void {
  try {
    operation()
  } catch (error) {
    const failure = error as Error
    logger.error(`Restore recovery failed while ${action}`, failure)
    failures.push(failure)
  }
}

function restoreRecoveryIncomplete(phase: string, failures: readonly Error[]): Error {
  return new Error(`${phase} is incomplete: ${failures.map((failure) => failure.message).join('; ')}`)
}

// ─── terminal bookkeeping ───

/**
 * Every terminal outcome writes the journal state and deletes the staging
 * tree (the staging tree's lifecycle is wholly owned by this state machine).
 * Callers reach here only after proving the old/new terminal state, so a
 * failed inverse leaves the active journal and staging evidence untouched.
 */
function finalize(ctx: PromotionContext, state: 'completed' | 'failed' | 'expired', step?: PromotionStep): void {
  writeRestoreJournal({ ...ctx.journal, state, step } as RestoreJournal)
  const stagingRoot = application.getPath('feature.backup.restore.staging')
  fs.rmSync(path.join(stagingRoot, ctx.journal.restoreId), { recursive: true, force: true })
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
