/**
 * Crash consistency for install / update / rollback / uninstall.
 *
 * The dangerous window is between "files moved into place" and "rows committed".
 * A crash can land on either side of that line and the two sides need OPPOSITE
 * repairs — delete the files, or keep them — so this cannot be a cleanup pass that
 * deletes whatever it finds. The committed row is the only witness of which side
 * the crash fell on, so every entry carries the contentHash the row will hold and
 * recovery joins on it.
 *
 * Recorded in a plain JSON file rather than the database, because the database is
 * exactly the component that has not caught up yet.
 *
 * NO PATHS ARE STORED. Every path is derived from `miniAppInstallPath(appId)` at
 * recovery time. A persisted absolute path goes stale on userData relocation just
 * as it would in the database — and here the stale value would be the target of a
 * recursive delete.
 */
import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { miniAppFileRefTable } from '@data/db/schemas/fileRelations'
import { miniAppInstallationTable } from '@data/db/schemas/miniApp'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { shouldSilenceFsyncDirError } from '@main/utils/file'
import { MiniAppIdSchema } from '@shared/types/miniAppManifest'
import { eq } from 'drizzle-orm'
import * as z from 'zod'

import { miniAppBackupPath, miniAppDataPath, miniAppInstallPath, miniAppRollingPath } from '../paths'
import { clearMiniAppPartition } from '../runtime/partition'

const logger = loggerService.withContext('miniAppPublishJournal')

/**
 * `appId` is validated with the SAME schema the rest of the system uses, not as a
 * loose string. Dropping the paths from the entry was only half the fix: the appId
 * still goes into `path.join(packagesRoot, appId)` and the result is a recursive
 * delete target, so `../..` in a hand-edited or corrupted journal walks straight
 * out of the mini-app root. `MiniAppIdSchema` is reverse-DNS only — no separators,
 * no dot-only segments — which makes the traversal unrepresentable.
 */
const PublishEntrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('install'), appId: MiniAppIdSchema, contentHash: z.string().min(1) }),
  z.strictObject({ kind: z.literal('update'), appId: MiniAppIdSchema, contentHash: z.string().min(1) }),
  /**
   * Its OWN kind, not an `update`: a reinstall retains no snapshot, and — because
   * `hashTree` sees only content — re-extracting the SAME version reproduces the hash the
   * row already holds. `previousContentHash` is what makes that case recognisable.
   */
  z.strictObject({
    kind: z.literal('reinstall'),
    appId: MiniAppIdSchema,
    contentHash: z.string().min(1),
    previousContentHash: z.string().min(1)
  }),
  z.strictObject({ kind: z.literal('rollback'), appId: MiniAppIdSchema, contentHash: z.string().min(1) }),
  z.strictObject({ kind: z.literal('uninstall'), appId: MiniAppIdSchema }),
  /**
   * "Clear data" — the same broken promise as a half-finished uninstall, one tree smaller.
   * No contentHash: the package is untouched, so there is nothing for a hash to witness.
   */
  z.strictObject({ kind: z.literal('clear-data'), appId: MiniAppIdSchema })
])

export type PublishEntry = z.infer<typeof PublishEntrySchema>

export interface PublishRecovery {
  appId: string
  /**
   * `failed` is why the outcome is reported at all: the repair threw, so the tree on disk
   * is NOT what the committed rows describe and no guest may load it until a later launch
   * repairs it. The other two mean the tree and the rows agree again.
   */
  action: 'rolled-forward' | 'rolled-back' | 'failed'
}

/**
 * ONE FILE PER APP, under its own registry key.
 *
 * A single shared array file would need a lock covering EVERY app. Publishes are
 * serialized per appId, so two apps publish concurrently, and two "read all → change my
 * entry → write back" cycles silently drop each other's entries — the exact record a
 * crash needs to decide which way to repair. Per-app files have no shared state, so the
 * per-app lock the system already has is sufficient by construction.
 *
 * `getPath`'s filename argument, not a `path.join` on its result: that is the sanctioned
 * form (paths/README §2) and it validates the name.
 */
function journalPath(appId: string): string {
  return application.getPath('feature.mini_app.publish_journal', `${appId}.json`)
}

/** The three trees a publish can touch, all derived — never read from the journal. */
function treesOf(appId: string) {
  return {
    install: miniAppInstallPath(appId),
    backup: miniAppBackupPath(appId),
    rolling: miniAppRollingPath(appId)
  }
}

function readOne(appId: string): PublishEntry | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(journalPath(appId), 'utf8'))
  } catch {
    // A corrupt journal must never block startup — the worst case is one orphan
    // directory the user can still remove.
    return undefined
  }
  const result = PublishEntrySchema.safeParse(parsed)
  if (!result.success) {
    logger.warn('Discarded a malformed publish journal file', { appId })
    return undefined
  }
  return result.data
}

/** Every journal on disk. `readdir` is the index — there is no second list to drift. */
function readAll(): PublishEntry[] {
  let names: string[]
  try {
    names = fs.readdirSync(application.getPath('feature.mini_app.publish_journal'))
  } catch {
    return []
  }
  return names.flatMap((name) => {
    if (!name.endsWith('.json')) return []
    // The FILENAME is validated before it is used to build a read path — a stray
    // `../x.json` in this directory must not be able to name a file outside it.
    const appId = MiniAppIdSchema.safeParse(name.slice(0, -'.json'.length))
    if (!appId.success) return []
    const entry = readOne(appId.data)
    if (!entry) return []
    // And the payload must name the file it was found in. `clearPublishJournal` deletes by
    // the PAYLOAD's appId, so a mismatched pair never clears itself: it would repair the
    // other app's trees on every launch, for ever, off a file nothing can retire.
    if (entry.appId !== appId.data) {
      logger.warn('Discarded a publish journal filed under another app', { file: appId.data, entry: entry.appId })
      return []
    }
    return [entry]
  })
}

/**
 * Make the journal directory's own entry durable, as `restoreJournal.ts` does for the
 * restore marker. A rename that is only in the page cache is lost to a power cut, and this
 * marker is written BEFORE the files move — losing it leaves a moved tree with no witness.
 *
 * Best-effort, with `atomicWriteFile`'s errno policy rather than a throw: a filesystem that
 * rejects directory fsync outright (network mount, FUSE) is somewhere userData can legally
 * be relocated to, and failing every publish there would be the worse bug.
 */
function fsyncJournalDir(target: string): void {
  // Windows moves are write-through and directory handles cannot be fsynced there.
  if (isWin) return
  try {
    const dirFd = fs.openSync(path.dirname(target), 'r')
    try {
      fs.fsyncSync(dirFd)
    } finally {
      fs.closeSync(dirFd)
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // ENOENT as well: no directory means no entry left to make durable.
    if (code === 'ENOENT' || shouldSilenceFsyncDirError(code)) return
    logger.warn('fsync(dir) failed for a publish journal; durability not confirmed', { target, code })
  }
}

export function writePublishJournal(entry: PublishEntry): void {
  const target = journalPath(entry.appId)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  // Atomic replace, and the tmp name carries the appId: two apps publishing at once
  // must not race for one temporary file.
  const tmp = `${target}.${process.pid}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, JSON.stringify(entry))
    // The bytes before the rename: a durable directory entry pointing at an empty file
    // witnesses nothing, and `readOne` discards what it cannot parse.
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, target)
  fsyncJournalDir(target)
}

export function clearPublishJournal(appId: string): void {
  const target = journalPath(appId)
  fs.rmSync(target, { force: true })
  // Durable too: a lost unlink replays a repair that already ran, and a replay that throws
  // now keeps the app out on the launch after that.
  fsyncJournalDir(target)
}

function installedRow(appId: string) {
  const [row] = application
    .get('DbService')
    .getDb()
    .select({
      contentHash: miniAppInstallationTable.contentHash,
      previousContentHash: miniAppInstallationTable.previousContentHash
    })
    .from(miniAppInstallationTable)
    .where(eq(miniAppInstallationTable.appId, appId))
    .all()
  return row
}

/** Did the transaction this entry was opened for actually commit? */
/** How many file references the app still owns — the witness a clear-data commits by. */
function ownedRefCount(appId: string): number {
  return application
    .get('DbService')
    .getDb()
    .select({ id: miniAppFileRefTable.id })
    .from(miniAppFileRefTable)
    .where(eq(miniAppFileRefTable.sourceId, appId))
    .all().length
}

function isCommitted(entry: PublishEntry): boolean {
  const hash = installedRow(entry.appId)?.contentHash
  // An uninstall commits by REMOVING the row, so its witness is absence.
  if (entry.kind === 'uninstall') return hash === undefined
  // A clear witnesses itself in the REFERENCE rows, not in the installation row — the app
  // stays installed and its hash never moves. Answering "always committed" here would look
  // harmless (clearing twice is a no-op) but the journal is armed BEFORE the delete, so a
  // crash in between would clear the stores while the refs survive: the files page still
  // lists blobs whose save file is gone, which is worse than either end of the operation.
  //
  // The degenerate case is benign, unlike `reinstall` below: an app that owned no files
  // reads "committed" because its delete WAS a no-op, so rolling forward is right anyway.
  if (entry.kind === 'clear-data') return ownedRefCount(entry.appId) === 0
  // A same-version reinstall writes back the hash the row ALREADY held, so the row answers
  // "committed" from the moment the journal is written — and nothing else the transaction
  // touches is guaranteed to differ either. Treated as uncommitted, which repairs correctly
  // on BOTH sides: the two trees are byte-identical when their hashes agree, so restoring
  // the parked one puts back the same bytes the committed rows describe.
  if (entry.kind === 'reinstall' && entry.contentHash === entry.previousContentHash) return false
  return hash === entry.contentHash
}

async function rm(target: string): Promise<void> {
  await fs.promises.rm(target, { recursive: true, force: true })
}

/** Move `from` over `to`, if `from` still exists. */
async function restore(from: string, to: string): Promise<void> {
  if (!fs.existsSync(from)) return
  await rm(to)
  await fs.promises.rename(from, to)
}

async function rollForward(entry: PublishEntry): Promise<void> {
  const t = treesOf(entry.appId)
  if (entry.kind === 'rollback') return rm(t.rolling)
  if (entry.kind === 'uninstall') {
    await rm(t.install)
    await rm(t.backup)
    await rm(t.rolling)
    // The save data too, as the in-process path does: a reinstall must not read it back.
    await rm(miniAppDataPath(entry.appId))
    // And the partition, which is the OTHER store nothing cascades: cookies and the HTTP
    // cache live on it, so a crash between the commit and the in-process sweep would leave
    // an uninstalled app's server identity intact for the next install of the same id.
    // `reclaimEntries` has no counterpart here on purpose — it needs the orphan list
    // computed before the commit, and nothing on disk records it.
    await clearMiniAppPartition(entry.appId)
  }
  // A reinstall retains nothing, so its parked tree is one nothing can roll back to —
  // dropped here exactly as the in-process path drops it right after its own commit.
  if (entry.kind === 'reinstall') return rm(t.backup)
  if (entry.kind === 'clear-data') {
    // The two stores the in-process path clears after its commit, and the two a crash
    // in between leaves behind: the save file the app would read straight back, and the
    // partition still holding its cookies. The package tree stays — the app is installed.
    await rm(miniAppDataPath(entry.appId))
    return clearMiniAppPartition(entry.appId)
  }
  // install / update: the files already are what the committed rows describe, and
  // `update` deliberately keeps `.backup` — it is the user-facing rollback entry.
}

async function rollBack(entry: PublishEntry): Promise<void> {
  const t = treesOf(entry.appId)
  switch (entry.kind) {
    case 'install':
      return rm(t.install)
    case 'update':
    case 'reinstall':
      // Rows still describe the previous version, so the previous tree goes back
      // under them. The new tree may or may not have landed.
      return restore(t.backup, t.install)
    case 'rollback':
      // The rows still describe the NEW version, so that is the tree to put back; the
      // PREVIOUS one at `install` returns to `.backup` rather than being destroyed.
      if (!fs.existsSync(t.rolling)) return
      if (fs.existsSync(t.install) && !fs.existsSync(t.backup)) {
        await fs.promises.rename(t.install, t.backup)
      } else {
        await rm(t.install)
      }
      return await fs.promises.rename(t.rolling, t.install)
    case 'uninstall':
      // The delete never committed — the app is still installed, files included.
      return
    case 'clear-data':
      // The reference delete never committed, so nothing was cleared and nothing is owed:
      // the app keeps its files, its save data and its partition, exactly as it was.
      return
  }
}

/**
 * Runs at startup from `MiniAppRuntimeService.onReady()`.
 *
 * @returns one outcome per journal entry, `failed` included — the caller must keep those
 * apps unloadable, because a repair that threw leaves a tree the committed rows do not
 * describe. Never rejects for a single entry's sake: one app's EBUSY is not the others'.
 */
export async function recoverInterruptedPublishes(): Promise<PublishRecovery[]> {
  const pending = readAll()
  if (pending.length === 0) return []

  const outcomes: PublishRecovery[] = []
  for (const entry of pending) {
    try {
      const committed = isCommitted(entry)
      await (committed ? rollForward(entry) : rollBack(entry))
      // Cleared as each one finishes, not in one sweep at the end: a crash midway through
      // recovery must not re-run the repairs that already succeeded.
      clearPublishJournal(entry.appId)
      const action = committed ? 'rolled-forward' : 'rolled-back'
      outcomes.push({ appId: entry.appId, action })
      logger.warn('Recovered an interrupted mini app publish', { appId: entry.appId, kind: entry.kind, action })
    } catch (error) {
      // Isolated per entry, and the WHOLE entry: `isCommitted` reads the database and
      // `clearPublishJournal` writes the disk, so a throw from either used to abort every
      // LATER app's repair too. Left armed AND reported — the caller admits no guest for
      // an app whose tree the rows no longer describe, and the next launch retries it.
      logger.error('Failed to recover an interrupted mini app publish', { appId: entry.appId, error })
      outcomes.push({ appId: entry.appId, action: 'failed' })
    }
  }
  return outcomes
}
