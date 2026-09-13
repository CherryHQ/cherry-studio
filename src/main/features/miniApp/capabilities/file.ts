/**
 * `cherry.file` — a flat, logical-name sandbox on top of FileManager.
 *
 * Names never reach the filesystem: FileManager stores internal blobs as
 * `{uuid}.{ext}`, so path traversal, case-insensitive collisions, NFC/NFD
 * normalization and Windows reserved names are structurally absent rather than
 * defended against. `getUrl` / `getPhysicalPath` deliberately never cross the
 * bridge — a mini app's world has logical names and no concept of a path.
 */

import fs from 'node:fs'

import { and, eq, sql } from 'drizzle-orm'
import { BrowserWindow, dialog, webContents } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { miniAppFileRefTable } from '@data/db/schemas/fileRelations'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { t } from '@main/i18n'
import type { QuotaUsage, QuotaUsageWithLimits } from '@shared/types/miniAppQuota'

import { InvalidArgumentError } from '../errors'
import { PermissionDeniedError } from '../grants'
import type { CallLease } from '../runtime/MiniAppRuntimeService'
import {
  assertWithinQuota,
  base64CharCap,
  ConcurrentRateLimiter,
  MINI_APP_QUOTAS,
  RateLimitedError,
  WriteRateLimiter
} from './quota'

const logger = loggerService.withContext('miniApp:file')

/** No directories in phase one; a flat namespace kills a whole class of problems. */
const LogicalName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/\\]+$/, 'logical name must not contain a path separator')
  .refine((n) => n !== '.' && n !== '..', 'invalid logical name')

const NameParams = z.object({ name: LogicalName })
/**
 * The base64 string is length-capped BEFORE `Buffer.from` decodes it.
 *
 * Checking the quota after decoding is checking it after the damage: the payload has
 * already been structured-cloned across the bridge, copied into the main process and
 * expanded into a Buffer. A mini app could exhaust memory and receive a tidy
 * `QuotaExceededError` for its trouble. `base64CharCap` converts the byte quota into
 * the string length that produces it.
 */
const SaveParams = NameParams.extend({ data: z.base64().max(base64CharCap(MINI_APP_QUOTAS.file.single)) })
/** The dialog's default file name obeys the same rules as a logical name — no separators, no `..`. */
const ExportParams = NameParams.extend({ suggestedName: LogicalName.optional() })

const limiter = new WriteRateLimiter()
/** A save dialog is a modal the user has to dismiss: one at a time, and ten a minute is already a nuisance. */
const exportLimiter = new ConcurrentRateLimiter('file.export', 10, 1)

/**
 * Per-app serialization. `save()` has two awaits between reading usage and writing
 * the ref, so concurrent calls would all pass the same stale usage check and blow
 * past the quota together. A promise chain per app is enough: writes to one app's
 * sandbox are inherently low-frequency (and rate-limited above).
 */
const saveChains = new Map<string, Promise<unknown>>()
function serializePerApp<T>(appId: string, fn: () => Promise<T>): Promise<T> {
  const next = (saveChains.get(appId) ?? Promise.resolve()).then(fn, fn)
  saveChains.set(
    appId,
    next.catch(() => undefined)
  )
  return next
}

function readUsage(appId: string): QuotaUsage {
  const [row] = application
    .get('DbService')
    .getDb()
    .select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(${fileEntryTable.size}), 0)`
    })
    .from(miniAppFileRefTable)
    .innerJoin(fileEntryTable, eq(fileEntryTable.id, miniAppFileRefTable.fileEntryId))
    .where(eq(miniAppFileRefTable.sourceId, appId))
    .all()
  return { bytes: Number(row?.bytes ?? 0), count: Number(row?.count ?? 0) }
}

function findRef(appId: string, name: string) {
  return application
    .get('DbService')
    .getDb()
    .select()
    .from(miniAppFileRefTable)
    .where(and(eq(miniAppFileRefTable.sourceId, appId), eq(miniAppFileRefTable.logicalName, name)))
    .all()[0]
}

/**
 * Bounds concurrent READ-AND-ENCODE work across all apps.
 *
 * The per-call cap bounds one payload; without a total, ten concurrent `file.load`
 * calls at 10 MB each are 100 MB resident regardless. Same reasoning as the protocol
 * handler's read slots — a per-item limit is not a system limit.
 *
 * **Scope, stated precisely because the name used to over-promise:** the budget
 * covers reading the file and producing its base64 string — 1x the file plus ~4/3 for
 * the encoding, hence `7/3`. It is released when the handler returns, which is BEFORE
 * Electron structured-clones the response across the IPC boundary. That clone is
 * therefore outside the budget. Calling this "the in-flight payload limit" implied a
 * process-wide peak guarantee it cannot make; it is a decode-concurrency limit, and
 * the transient clone rides on top of it.
 */
const MAX_INFLIGHT_DECODE_BYTES = 32 * 1024 * 1024
let inflightDecodeBytes = 0

function reserveDecodeBudget(bytes: number): () => void {
  if (inflightDecodeBytes + bytes > MAX_INFLIGHT_DECODE_BYTES) {
    throw new RateLimitedError(`Too many mini app file reads in flight; retry shortly`)
  }
  inflightDecodeBytes += bytes
  let released = false
  return () => {
    if (released) return
    released = true
    inflightDecodeBytes -= bytes
  }
}

/**
 * Reclaim an entry this call just orphaned, now rather than at the pass's convenience.
 *
 * The pass is a crash backstop here, not the reclamation path: it waits an hour
 * (`ENTRY_CLEANUP_GRACE_MS`), takes 100 per run (`ENTRY_CLEANUP_BATCH_LIMIT`) and runs
 * every 30 minutes (`FileManager.CLEANUP_INTERVAL_MS`) — 200/hour against the 3600 an
 * app autosaving once a second produces. The quota counts REFS, so that app shows a
 * flat 10 MB while the disk fills; nothing in the system converges.
 *
 * Deleting is safe without a ref count: `createInternalEntry` mints a fresh id per call
 * and does not dedupe by content hash, so the entry belongs to this call alone.
 *
 * Never throws. The ref rows are already correct, so a failed unlink is a leaked blob
 * for the pass to find — not a reason to fail a committed save.
 */
async function reclaim(fileEntryId: string, why: string): Promise<void> {
  try {
    await application.get('FileManager').permanentDelete(fileEntryId)
  } catch (error) {
    logger.warn('Left a mini app file entry for the cleanup pass', { fileEntryId, why, error })
  }
}

/**
 * Entry ids this app's refs point at. Read BEFORE the rows are deleted — afterwards
 * there is nothing left to join through and the blobs are unreachable until the pass
 * eventually notices them.
 */
export function ownedFileEntryIds(appId: string, db: DbOrTx): string[] {
  return db
    .select({ id: miniAppFileRefTable.fileEntryId })
    .from(miniAppFileRefTable)
    .where(eq(miniAppFileRefTable.sourceId, appId))
    .all()
    .map((r) => r.id)
}

/**
 * Reclaim entries whose ref rows are already gone — clear-data, reset and uninstall.
 *
 * All three are things the user just clicked and expects to have happened. Leaving them
 * to the pass keeps the files listed on the files page (§3.6) and on disk for at least
 * the grace hour, which makes "clear data" a claim the user can watch being false.
 */
export async function reclaimEntries(ids: readonly string[]): Promise<void> {
  for (const id of ids) await reclaim(id, 'app data cleared')
}

export const fileCapability = {
  // `async`, because the checks below now run HERE: a synchronous throw out of a method the
  // bridge awaits escapes its `.catch` entirely, which is the same trap `miniAppBridge.ts`
  // documents on the guest side.
  async save(appId: string, params: unknown) {
    // Parsed, decoded and rate-limited BEFORE the queue, not inside it. Handing the raw
    // params to `serializePerApp` parks the guest's whole base64 string in main-process
    // memory for as long as the queue is busy — and the limiter that exists to refuse it
    // only ran after the wait, so an app could hold as many payloads as it cared to send.
    // The decoded buffer is also the smaller of the two things to be holding.
    const { name, data } = SaveParams.parse(params)
    const bytes = Buffer.from(data, 'base64')
    limiter.check(appId, bytes.byteLength)
    // Lease taken BEFORE the queue wait and checked after it — the whole reason this
    // is not a plain "is quiescing now?" check is that time passes in between.
    const lease = application.get('MiniAppRuntimeService').leaseFor(appId)
    return serializePerApp(appId, () => this.saveSerialized(appId, { name, bytes }, lease))
  },

  async saveSerialized(appId: string, params: { name: string; bytes: Buffer }, lease: CallLease) {
    const { name, bytes } = params

    const previous = findRef(appId, name)
    const previousSize = previous
      ? Number(
          application
            .get('DbService')
            .getDb()
            .select({ size: fileEntryTable.size })
            .from(fileEntryTable)
            .where(eq(fileEntryTable.id, previous.fileEntryId))
            .all()[0]?.size ?? 0
        )
      : 0

    const usage = readUsage(appId)
    assertWithinQuota(
      'file',
      { bytes: usage.bytes - previousSize, count: usage.count - (previous ? 1 : 0) },
      { bytes: bytes.byteLength, count: 1 }
    )

    const entry = await application.get('FileManager').createInternalEntry({
      source: 'bytes',
      data: new Uint8Array(bytes),
      name: 'blob',
      ext: 'bin',
      cleanupPolicy: 'delete_when_unreferenced'
    })

    try {
      // INSIDE the transaction, not adjacent to it: any `await` between the check and
      // the commit is a gap an uninstall fits into. `withWriteTx` runs synchronously.
      application.get('DbService').withWriteTx((tx) => {
        application.get('MiniAppRuntimeService').assertLeaseValid(lease)
        if (previous) {
          tx.delete(miniAppFileRefTable).where(eq(miniAppFileRefTable.id, previous.id)).run()
        }
        tx.insert(miniAppFileRefTable).values({ fileEntryId: entry.id, sourceId: appId, logicalName: name }).run()
      })
    } catch (error) {
      // Nothing ever referenced it, so the bytes would otherwise sit for the grace
      // hour before the pass even considers them.
      await reclaim(entry.id, 'refused save')
      throw error
    }

    if (previous) await reclaim(previous.fileEntryId, 'superseded save')
    return { ok: true }
  },

  async load(appId: string, params: unknown) {
    const { name } = NameParams.parse(params)
    const ref = findRef(appId, name)
    if (!ref) return { data: null }

    // Reserved BEFORE the read and sized for the base64: one load holds the Buffer,
    // the expanded string and the IPC clone at once — ~7/3 of the file.
    const [entry] = application
      .get('DbService')
      .getDb()
      .select({ size: fileEntryTable.size })
      .from(fileEntryTable)
      .where(eq(fileEntryTable.id, ref.fileEntryId))
      .all()
    // `encoding: 'base64'`, NOT 'binary': the binary path copies into a fresh
    // Uint8Array and encoding it here copies again — three resident copies per read.
    const footprint = Math.ceil((Number(entry?.size ?? 0) * 7) / 3)
    const release = reserveDecodeBudget(footprint)
    try {
      const result = await application.get('FileManager').read(ref.fileEntryId, { encoding: 'base64' })
      return { data: result.content }
    } finally {
      release()
    }
  },

  async list(appId: string) {
    return {
      names: application
        .get('DbService')
        .getDb()
        .select({ name: miniAppFileRefTable.logicalName })
        .from(miniAppFileRefTable)
        .where(eq(miniAppFileRefTable.sourceId, appId))
        .all()
        .map((r) => r.name)
        .sort()
    }
  },

  async delete(appId: string, params: unknown) {
    const { name } = NameParams.parse(params)
    // Counted BEFORE the early return: `delete` of a missing name is still a call, and
    // a loop over misses would otherwise be free.
    limiter.check(appId)
    // Lease taken BEFORE the queue, exactly as `save` does — and for a reason queueing
    // CREATED: off the chain this ran immediately, but behind a `save` awaiting
    // `createInternalEntry` it can now wait long enough for an update or reinstall to
    // commit, and the name it then resolves belongs to a newer installation.
    const lease = application.get('MiniAppRuntimeService').leaseFor(appId)
    // On the SAME chain as `save`, for the reason `saveSerialized` already states about
    // uninstall: its `createInternalEntry` is a real `await` between resolving the ref and
    // inserting one. A delete running beside that gap finds nothing, reports success, and
    // the save then commits the row — the file the guest was told was gone is back.
    return serializePerApp(appId, async () => {
      // ONE check, unlike `saveSerialized`'s in-transaction one: everything from here to
      // the commit is synchronous (`findRef`, then `withWriteTx`), so there is no await for
      // a generation to change in. It also answers the miss correctly — a caller from a
      // dead generation must not be told `{ ok: true }` for a name it never owned.
      application.get('MiniAppRuntimeService').assertLeaseValid(lease)
      const ref = findRef(appId, name)
      if (!ref) return { ok: true }
      application
        .get('DbService')
        .withWriteTx((tx) => tx.delete(miniAppFileRefTable).where(eq(miniAppFileRefTable.id, ref.id)).run())
      await reclaim(ref.fileEntryId, 'deleted save')
      return { ok: true }
    })
  },

  async usage(appId: string): Promise<QuotaUsageWithLimits> {
    const usage = readUsage(appId)
    return { ...usage, bytesLimit: MINI_APP_QUOTAS.file.bytes, countLimit: MINI_APP_QUOTAS.file.count }
  },

  /**
   * The one way a sandbox file reaches the user's disk: their own save dialog, parented to
   * the window showing the app and titled with the app's name — the dialog IS the consent,
   * so it has to say who is asking. The chosen path never crosses back to the guest.
   */
  async export(appId: string, params: unknown, senderId: number) {
    const { name, suggestedName } = ExportParams.parse(params)
    const runtime = application.get('MiniAppRuntimeService')
    const guest = webContents.fromId(senderId)
    if (!guest || !runtime.isGuestVisible(senderId)) {
      throw new PermissionDeniedError(appId, 'file.export', 'a save dialog can only be opened while the app is visible')
    }
    const release = exportLimiter.acquire(appId)
    // Taken BEFORE the dialog, exactly as `save` takes one before its own await: the user
    // can sit on a native dialog for minutes, and taking an app offline deliberately does
    // not wait for in-flight calls (design §2.1).
    const lease = runtime.leaseFor(appId)
    try {
      // Fast refusal, so a name that is already gone costs no dialog. The authoritative
      // resolution is the one after it.
      if (!findRef(appId, name)) throw new InvalidArgumentError(`No file named "${name}"`)
      const options = {
        title: t('dialog.mini_app_export', { name: runtime.displayNameOf(appId) }),
        defaultPath: suggestedName ?? name
      }
      const parent = BrowserWindow.fromWebContents(guest.hostWebContents ?? guest)
      const { canceled, filePath } = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options)
      if (canceled || !filePath) return { saved: false }
      // BOTH re-checked, because they answer different questions. The lease catches a
      // clear-data or an uninstall that committed while the dialog was open; the ref is
      // resolved again because a `file.delete` in that same window moves no generation.
      // Copying on the stale one writes a file the user just cleared onto their disk —
      // and once the blob is reclaimed it fails as an unexplained `Internal` instead.
      runtime.assertLeaseValid(lease)
      const ref = findRef(appId, name)
      if (!ref) throw new InvalidArgumentError(`No file named "${name}"`)
      await fs.promises.copyFile(application.get('FileManager').getPhysicalPath(ref.fileEntryId), filePath)
      return { saved: true }
    } finally {
      release()
    }
  }
}
