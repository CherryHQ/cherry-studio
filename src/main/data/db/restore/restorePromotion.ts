import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import Database from 'better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'

import type { AppliedMigration } from './appliedChain'
import { checkpointTruncateAssert } from './checkpoint'
import {
  DB_COMMIT_STEP,
  findDbAside,
  PROMOTION_STEP_ORDER,
  type PromotionStep,
  readRestoreJournal,
  type RestoreJournal,
  writeRestoreJournal
} from './restoreJournal'
import { decideRecoveryAction, phaseForStep } from './restoreRecovery'

const logger = loggerService.withContext('RestorePromotion')
const COMMIT_INDEX = PROMOTION_STEP_ORDER.indexOf(DB_COMMIT_STEP)

type ArmedJournal = Extract<RestoreJournal, { state: 'armed' }>
type PromotingJournal = Extract<RestoreJournal, { state: 'promoting' }>
type RevertingJournal = Extract<RestoreJournal, { state: 'reverting' }>
type RollbackArmedJournal = Extract<RestoreJournal, { state: 'rollback-armed' }>
type ActiveJournal = ArmedJournal | PromotingJournal | RevertingJournal | RollbackArmedJournal

interface PromotionContext {
  readonly journal: ActiveJournal
  readonly userData: string
  readonly livePath: string
  readonly stagedPath: string
  readonly asidePath: string
}

interface DbFacts {
  readonly staged: boolean
  readonly live: boolean
  readonly aside: boolean
}

interface RollbackFacts {
  readonly live: boolean
  readonly aside: boolean
  readonly rejected: boolean
}

/** The only preboot writer of the live database; it runs before DbService exists. */
export async function runRestorePromotion(): Promise<void> {
  const read = readRestoreJournal()
  if (read.kind === 'none') return
  if (read.kind === 'corrupt')
    throw new Error(`Restore journal is unreadable — refusing to discard recovery evidence: ${read.error}`)

  switch (read.journal.state) {
    case 'prepared':
      return expirePrepared(read.journal)
    case 'armed':
      return promoteArmed(read.journal)
    case 'promoting':
      return recoverPromoting(read.journal)
    case 'reverting':
      return finishPostCommitRevert(read.journal)
    case 'rollback-armed':
      return rollbackCompletedRestore(read.journal)
    case 'completed':
    case 'rolled-back':
    case 'failed':
    case 'expired':
      return
  }
}

/** Escaped preboot failures preserve evidence, but never leave the old DB invisible in its aside. */
export function markRestoreFailedAfterCrash(): void {
  const read = readRestoreJournal()
  if (read.kind !== 'ok' || (read.journal.state !== 'armed' && read.journal.state !== 'promoting')) return
  const ctx = buildContext(read.journal)
  const facts = probeFacts(ctx)
  if (read.journal.state === 'promoting' && isCommitted(read.journal.step, facts)) return
  restoreLiveFromAside(ctx)
  finalizeFailure(ctx, 'promotion crashed outside its own recovery')
}

export function isRestoreRecoveryPending(): boolean {
  const read = readRestoreJournal()
  return (
    read.kind === 'corrupt' ||
    (read.kind === 'ok' && ['promoting', 'reverting', 'rollback-armed'].includes(read.journal.state))
  )
}

export function isLiveDbStranded(): boolean {
  const read = readRestoreJournal()
  if (!fs.existsSync(application.getPath('app.database.file'))) {
    if (read.kind === 'corrupt') return findDbAside() !== null
    if (read.kind === 'ok')
      return fs.existsSync(path.resolve(application.getPath('app.userdata'), read.journal.db.aside))
  }
  return false
}

function expirePrepared(journal: Extract<RestoreJournal, { state: 'prepared' }>): void {
  removeStagingTree(journal.restoreId)
  writeRestoreJournal({
    ...journal,
    state: 'expired',
    reason: 'the preparation was never armed; an unrelated restart expired it'
  })
}

async function promoteArmed(journal: ArmedJournal): Promise<void> {
  const ctx = buildContext(journal)
  try {
    assertPromotable(ctx)
    if (!chainIsBundledPrefix(journal.db.chain))
      return expire(ctx, 'journal chain is not a prefix of the bundled migration chain')
  } catch (error) {
    return expire(ctx, `admission gate failed: ${(error as Error).message}`)
  }
  const promoting: PromotingJournal = { ...journal, state: 'promoting', step: 'gate-passed' }
  writeRestoreJournal(promoting)
  await executeForward(ctx, promoting, 1)
}

function assertPromotable(ctx: PromotionContext): void {
  if (!fs.existsSync(ctx.livePath)) throw new Error('no live database to replace')
  if (!fs.existsSync(ctx.stagedPath)) throw new Error('staged database missing')
  if (fs.existsSync(`${ctx.stagedPath}-wal`) || fs.existsSync(`${ctx.stagedPath}-shm`)) {
    throw new Error('staged database is not sealed')
  }
}

function chainIsBundledPrefix(chain: readonly AppliedMigration[]): boolean {
  const bundled = readMigrationFiles({ migrationsFolder: application.getPath('app.database.migrations') })
  return (
    chain.length <= bundled.length &&
    chain.every((item, index) => item.folderMillis === bundled[index].folderMillis && item.hash === bundled[index].hash)
  )
}

function expire(ctx: PromotionContext, reason: string): void {
  if (writeTerminal(ctx, 'expired', reason)) removeStagingTree(ctx.journal.restoreId)
}

async function recoverPromoting(journal: PromotingJournal): Promise<void> {
  const ctx = buildContext(journal)
  const facts = probeFacts(ctx)
  const committed = isCommitted(journal.step, facts)
  const action = decideRecoveryAction({ phase: committed ? 'committed' : 'pre-commit', ...facts })

  if (committed) {
    // The only committed facts that can prove a DB-only outcome are the
    // promoted main file (with or without its retained old aside), or the one
    // marker-lag row where staged+aside remain and promotion has not rerun.
    if (action === 'complete' && !facts.staged && facts.live) {
      return executeForward(ctx, { ...journal, step: DB_COMMIT_STEP }, COMMIT_INDEX + 1)
    }
    if (action === 'install-forward' && facts.staged && !facts.live && facts.aside) {
      moveIdempotent(ctx.stagedPath, ctx.livePath)
      return executeForward(ctx, { ...journal, step: DB_COMMIT_STEP }, COMMIT_INDEX + 1)
    }
    return failClosed(ctx)
  }

  // The live DB is never originally absent. Only rows that prove it stayed live
  // or that prove it is parked aside may recover; generic resource-only rows are
  // intentionally rejected rather than guessed through.
  if (facts.live && !facts.aside && (action === 'discard-staged' || action === 'uninstall')) {
    discardStaged(ctx)
    finalizeFailure(ctx, `rolled back from step '${journal.step}'`)
    return
  }
  if (!facts.live && facts.aside && action === 'restore-aside') {
    restoreLiveFromAside(ctx)
    discardStaged(ctx)
    finalizeFailure(ctx, `rolled back from step '${journal.step}'`)
    return
  }
  return failClosed(ctx)
}

function isCommitted(step: PromotionStep, facts: DbFacts): boolean {
  return phaseForStep(step) === 'committed' || (step === 'live-aside' && !facts.staged && facts.live && facts.aside)
}

async function executeForward(ctx: PromotionContext, initial: PromotingJournal, startIndex: number): Promise<void> {
  let current = initial
  for (let index = startIndex; index < PROMOTION_STEP_ORDER.length; index++) {
    const step = PROMOTION_STEP_ORDER[index]
    try {
      runStep(ctx, step)
    } catch (error) {
      const landedCommit = index === COMMIT_INDEX && !fs.existsSync(ctx.stagedPath) && fs.existsSync(ctx.livePath)
      if (landedCommit) {
        current = { ...current, step }
        continue
      }
      const reason = `step '${step}' failed: ${(error as Error).message}`
      if (index > COMMIT_INDEX) beginPostCommitRevert(current, reason)
      else {
        restoreLiveFromAside(ctx)
        discardStaged(ctx)
        finalizeFailure(ctx, reason)
      }
      return
    }
    try {
      current = markCompletedStep(current, step)
    } catch (error) {
      if (index < COMMIT_INDEX) {
        logger.error(`Restore marker write failed before commit (${step})`, error as Error)
        restoreLiveFromAside(ctx)
        discardStaged(ctx)
        finalizeFailure(ctx, `marker write for '${step}' failed`)
        return
      }
      logger.error(`Restore marker write failed after commit (${step})`, error as Error)
      current = { ...current, step }
    }
  }
  writeRestoreJournal({ ...current, state: 'completed' })
  removeStagingTree(ctx.journal.restoreId)
  logger.info('Restore promoted', { restoreId: ctx.journal.restoreId })
}

function runStep(ctx: PromotionContext, step: PromotionStep): void {
  switch (step) {
    case 'gate-passed':
      return
    case 'live-checkpointed':
      checkpointLiveDb(ctx.livePath)
      return
    case 'sidecars-removed':
      fs.rmSync(`${ctx.livePath}-wal`, { force: true })
      fs.rmSync(`${ctx.livePath}-shm`, { force: true })
      return
    case 'live-aside':
      moveIdempotent(ctx.livePath, ctx.asidePath)
      return
    case 'db-promoted':
      moveIdempotent(ctx.stagedPath, ctx.livePath)
      return
    case 'integrity-ok':
      if (integrityCheck(ctx.livePath) !== 'ok') throw new Error('integrity_check on the promoted DB failed')
  }
}

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
    return (error as Error).message
  } finally {
    sqlite?.close()
  }
}

function beginPostCommitRevert(journal: PromotingJournal, reason: string): void {
  const reverting: RevertingJournal = { ...journal, state: 'reverting', reason }
  writeRestoreJournal(reverting)
  finishPostCommitRevert(reverting)
}

function finishPostCommitRevert(journal: RevertingJournal): void {
  const ctx = buildContext(journal)
  const rejectedPath = rejectedDbPath(journal.restoreId)
  const facts = probeRollbackFacts(ctx, rejectedPath)

  if (facts.live && facts.aside && !facts.rejected) {
    assertRegularFile(ctx.livePath, 'promoted database')
    assertRegularFile(ctx.asidePath, 'previous database')
    renameDurable(ctx.livePath, rejectedPath)
    renameDurable(ctx.asidePath, ctx.livePath)
  } else if (!facts.live && facts.aside && facts.rejected) {
    // Crash after live→rejected but before aside→live: both remaining files are
    // operation-owned and sufficient to finish the durable reverse direction.
    assertRegularFile(ctx.asidePath, 'previous database')
    assertRegularFile(rejectedPath, 'rejected database')
    renameDurable(ctx.asidePath, ctx.livePath)
  } else if (!(facts.live && !facts.aside && facts.rejected)) {
    throw new Error('post-commit revert cannot prove a complete old database')
  }

  assertRegularFile(ctx.livePath, 'reverted database')
  assertRegularFile(rejectedPath, 'rejected database')
  if (integrityCheck(ctx.livePath) !== 'ok') throw new Error('integrity_check on reverted DB failed')
  writeRestoreJournal({ ...journal, state: 'failed' })
}

function rollbackCompletedRestore(journal: RollbackArmedJournal): void {
  const ctx = buildContext(journal)
  const rejectedPath = rejectedDbPath(journal.restoreId)
  const facts = probeRollbackFacts(ctx, rejectedPath)

  if (facts.live && facts.aside && !facts.rejected) {
    assertRegularFile(ctx.livePath, 'live database')
    assertRegularFile(ctx.asidePath, 'previous database')
    checkpointLiveDb(ctx.livePath)
    fs.rmSync(`${ctx.livePath}-wal`, { force: true })
    fs.rmSync(`${ctx.livePath}-shm`, { force: true })
    renameDurable(ctx.livePath, rejectedPath)
    renameDurable(ctx.asidePath, ctx.livePath)
  } else if (!facts.live && facts.aside && facts.rejected) {
    // Same interrupted-reverse shape as post-commit failure recovery.
    assertRegularFile(ctx.asidePath, 'previous database')
    assertRegularFile(rejectedPath, 'displaced restored database')
    renameDurable(ctx.asidePath, ctx.livePath)
  } else if (!(facts.live && !facts.aside && facts.rejected)) {
    throw new Error('rollback cannot prove all required database artifacts')
  }

  assertRegularFile(ctx.livePath, 'rolled-back database')
  assertRegularFile(rejectedPath, 'displaced restored database')
  if (integrityCheck(ctx.livePath) !== 'ok') throw new Error('integrity_check on rolled-back DB failed')
  writeRestoreJournal({ ...journal, state: 'rolled-back' })
}

function finalizeFailure(ctx: PromotionContext, reason: string): void {
  if (writeTerminal(ctx, 'failed', reason)) removeStagingTree(ctx.journal.restoreId)
}

function writeTerminal(ctx: PromotionContext, state: 'failed' | 'expired', reason: string): boolean {
  try {
    writeRestoreJournal({ ...ctx.journal, state, reason })
    return true
  } catch (error) {
    logger.error(`Could not write terminal restore journal (${state})`, error as Error)
    return false
  }
}

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

function probeFacts(ctx: PromotionContext): DbFacts {
  return {
    staged: fs.existsSync(ctx.stagedPath),
    live: fs.existsSync(ctx.livePath),
    aside: fs.existsSync(ctx.asidePath)
  }
}

function probeRollbackFacts(ctx: PromotionContext, rejectedPath: string): RollbackFacts {
  return {
    live: fs.existsSync(ctx.livePath),
    aside: fs.existsSync(ctx.asidePath),
    rejected: fs.existsSync(rejectedPath)
  }
}

function markCompletedStep(journal: PromotingJournal, step: PromotionStep): PromotingJournal {
  const next = { ...journal, step }
  try {
    writeRestoreJournal(next)
    return next
  } catch (error) {
    if (PROMOTION_STEP_ORDER.indexOf(step) < COMMIT_INDEX) throw error
    logger.error(`Restore marker write failed after commit (${step})`, error as Error)
    return next
  }
}

function restoreLiveFromAside(ctx: PromotionContext): void {
  if (fs.existsSync(ctx.asidePath) && !fs.existsSync(ctx.livePath)) renameDurable(ctx.asidePath, ctx.livePath)
}

function discardStaged(ctx: PromotionContext): void {
  fs.rmSync(ctx.stagedPath, { force: true })
}

function removeStagingTree(restoreId: string): void {
  fs.rmSync(path.join(application.getPath('feature.backup.restore.staging'), restoreId), {
    recursive: true,
    force: true
  })
}

function rejectedDbPath(restoreId: string): string {
  const livePath = application.getPath('app.database.file')
  return path.join(path.dirname(livePath), `${path.basename(livePath)}.restore-rejected-${restoreId}`)
}

function assertRegularFile(filePath: string, role: string): void {
  const stats = fs.lstatSync(filePath)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${role} is not a regular file`)
}

function failClosed(ctx: PromotionContext): never {
  const facts = probeFacts(ctx)
  throw new Error(
    `restore recovery state is inconsistent: staged=${facts.staged} live=${facts.live} aside=${facts.aside}`
  )
}

function moveIdempotent(source: string, target: string): void {
  const sourceExists = fs.existsSync(source)
  const targetExists = fs.existsSync(target)
  if (!sourceExists && targetExists) return
  if (!sourceExists) throw new Error('restore move source missing')
  if (targetExists) throw new Error('restore move destination already exists')
  renameDurable(source, target)
}

function renameDurable(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.renameSync(source, target)
  fsyncDir(path.dirname(target))
  if (path.dirname(source) !== path.dirname(target)) fsyncDir(path.dirname(source))
}

function fsyncDir(dir: string): void {
  if (process.platform === 'win32') return
  const fd = fs.openSync(dir, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
