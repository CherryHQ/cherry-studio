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
import { miniAppInstallationTable } from '@data/db/schemas/miniApp'
import { loggerService } from '@logger'
import { MiniAppIdSchema } from '@shared/types/miniAppManifest'
import { eq } from 'drizzle-orm'
import * as z from 'zod'

import { miniAppBackupPath, miniAppDataPath, miniAppInstallPath, miniAppRollingPath } from '../paths'

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
  z.strictObject({ kind: z.literal('rollback'), appId: MiniAppIdSchema, contentHash: z.string().min(1) }),
  z.strictObject({ kind: z.literal('uninstall'), appId: MiniAppIdSchema })
])

export type PublishEntry = z.infer<typeof PublishEntrySchema>

export interface PublishRecovery {
  appId: string
  action: 'rolled-forward' | 'rolled-back'
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
    return entry ? [entry] : []
  })
}

export function writePublishJournal(entry: PublishEntry): void {
  const target = journalPath(entry.appId)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  // Atomic replace, and the tmp name carries the appId: two apps publishing at once
  // must not race for one temporary file.
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(entry), 'utf8')
  fs.renameSync(tmp, target)
}

export function clearPublishJournal(appId: string): void {
  fs.rmSync(journalPath(appId), { force: true })
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
function isCommitted(entry: PublishEntry): boolean {
  const hash = installedRow(entry.appId)?.contentHash
  // An uninstall commits by REMOVING the row, so its witness is absence.
  if (entry.kind === 'uninstall') return hash === undefined
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
  }
  // A reinstall journals as `update` yet records no previous version, so its parked tree
  // is one nothing can roll back to — the in-process path removes it right after the
  // commit, and a crash in that window is the only way it survives.
  if (entry.kind === 'update' && !installedRow(entry.appId)?.previousContentHash) return rm(t.backup)
  // install / update: the files already are what the committed rows describe, and
  // `update` deliberately keeps `.backup` — it is the user-facing rollback entry.
}

async function rollBack(entry: PublishEntry): Promise<void> {
  const t = treesOf(entry.appId)
  switch (entry.kind) {
    case 'install':
      return rm(t.install)
    case 'update':
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
  }
}

/** Runs at startup from `MiniAppRuntimeService.onReady()`. */
export async function recoverInterruptedPublishes(): Promise<PublishRecovery[]> {
  const pending = readAll()
  if (pending.length === 0) return []

  const recovered: PublishRecovery[] = []
  for (const entry of pending) {
    const committed = isCommitted(entry)
    await (committed ? rollForward(entry) : rollBack(entry))
    // Cleared as each one finishes, not in one sweep at the end: a crash midway through
    // recovery must not re-run the repairs that already succeeded.
    clearPublishJournal(entry.appId)
    recovered.push({ appId: entry.appId, action: committed ? 'rolled-forward' : 'rolled-back' })
    logger.warn('Recovered an interrupted mini app publish', {
      appId: entry.appId,
      kind: entry.kind,
      action: committed ? 'rolled-forward' : 'rolled-back'
    })
  }
  return recovered
}
