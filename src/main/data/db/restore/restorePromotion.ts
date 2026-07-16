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
 * recovery could not handle. Two-way triage on the commit boundary:
 *
 * - Commit already landed (commitLanded): the new DB is live — freezing that
 *   to failed would strand a half-promoted DB and delete the staging tree the
 *   resume still needs. Leave the promoting journal for the next boot.
 * - Otherwise, restore the cardinal invariant first: if the live slot is
 *   empty but the aside still holds the old DB, put it back — else the next
 *   boot would silently create a fresh EMPTY database while the user's data
 *   sits stranded in the aside. Then apply the standard terminal cleanup
 *   (journal write + staging tree removal).
 *
 * Must never throw beyond what the shell already guards.
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
  if (journal.state === 'promoting' && commitLanded(ctx, journal)) {
    // The commit rename is durably on disk: the new DB is live with the old
    // DB parked aside. Freezing THAT to failed would strand a half-promoted
    // DB as the live one and delete the staging tree the resume still needs
    // — the forbidden third state. Leave the promoting journal untouched;
    // the next boot's recoverPromoting resumes it idempotently.
    logger.warn('Escaped crash left a committed promotion — keeping it resumable for the next boot', {
      restoreId: journal.restoreId
    })
    return
  }
  restoreLiveFromAside(ctx)
  finalize(ctx, 'failed', journal.state === 'promoting' ? journal.step : undefined)
}

/**
 * Whether the commit rename has durably landed AND the committed state is
 * still intact, judged by the journal marker plus filesystem reality (markers
 * are write-behind, so the FS wins ties). Both branches require the new DB
 * live AND the old DB still aside — a revert that already re-installed the
 * old DB clears the aside and correctly re-enables freezing. Below the
 * commit marker only the probe pattern (marker lagging one step behind the
 * landed rename) proves the commit; the same aside requirement keeps an
 * interrupted revert from matching it (see recoverPromoting).
 */
function commitLanded(ctx: PromotionContext, journal: PromotingJournal): boolean {
  if (!fs.existsSync(ctx.livePath) || !fs.existsSync(ctx.asidePath)) {
    return false
  }
  if (PROMOTION_STEP_ORDER.indexOf(journal.step) >= PROMOTION_STEP_ORDER.indexOf(COMMIT_STEP)) {
    return true
  }
  return journal.step === 'live-aside' && !fs.existsSync(ctx.workPath)
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
        // TODO(skills-restore §7.2): SKILLS dir-add (folderName) same-name conflict must
        // NOT expire the whole restore like blob/note add does — it should keep the local
        // dir (no-clobber, never-delete-local) + record degraded + reconcileSkills, per
        // skills-directory-resource design §7.2. This generic fatal rule stays correct for
        // blob/note add; specialize it for SKILLS dir-add when #07-13 lands SKILLS restore
        // promotion (dir-add candidate keyed by folderName, not file_entry.id).
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
    logger.warn('Crash inside an interrupted post-commit revert — finishing the revert', {
      restoreId: journal.restoreId,
      step: journal.step
    })
    revertPostCommit(ctx)
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
        revertPostCommit(ctx)
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
  inverseManifest(ctx)
  restoreLiveFromAside(ctx)
  finalize(ctx, 'failed')
}

/**
 * Post-commit failure (integrity or a later step): the promoted DB is live
 * but unacceptable. Park it for forensics, restore the aside, and undo ALL
 * file operations — entries were applied by now, so reverting only the DB
 * would leave an "old DB + new files" inconsistent state.
 *
 * Idempotent under re-entry (a crash mid-revert routes back here next boot):
 * the park guard requires the aside to still exist — once the aside restore
 * has run, the live slot holds the OLD DB and parking it would destroy the
 * very database the revert is protecting.
 */
function revertPostCommit(ctx: PromotionContext): void {
  if (fs.existsSync(ctx.livePath) && fs.existsSync(ctx.asidePath)) {
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
 * apply direction. Idempotent by construction: adds are renamed back to
 * their staging source (only when this promotion provably moved them in),
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
