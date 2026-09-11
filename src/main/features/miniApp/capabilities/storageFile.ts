import fs from 'node:fs'

import * as z from 'zod'

import { loggerService } from '@logger'

import { MiniAppUnavailableError } from '../errors'
import { miniAppDataPath, miniAppStorageFile } from '../paths'
import { MINI_APP_QUOTAS, QuotaExceededError } from './quota'

const logger = loggerService.withContext('miniAppStorage')

/** The whole save file, not one value: the backend rewrites it as a unit. */
export const MINI_APP_STORAGE_MAX_BYTES = MINI_APP_QUOTAS.storage.bytes
export const MINI_APP_STORAGE_MAX_KEYS = MINI_APP_QUOTAS.storage.count

const StorageSchema = z.record(z.string(), z.string())

export function readStorage(appId: string): Record<string, string> {
  let raw: string
  try {
    raw = fs.readFileSync(miniAppStorageFile(appId), 'utf8')
  } catch (error) {
    // ENOENT alone means empty. Every OTHER read failure — EACCES, EIO, EBUSY — means the
    // file could not be READ, which is a different fact and must not be reported as the
    // first: `set` merges onto this result and writes the merge back atomically, so
    // answering "empty" to a transient I/O error replaces a good save file with one key.
    // Wrapped, not rethrown bare: a raw fs error falls through `publicErrorOf` to
    // `Internal`, whose documented meaning is a host bug and whose message is frozen. This
    // is transient and the app can act on it, which is what `Unavailable` is for.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new MiniAppUnavailableError(`Save file for ${appId} could not be read`)
    }
    return {}
  }
  try {
    return StorageSchema.parse(JSON.parse(raw))
  } catch (error) {
    // Read but unparseable: hand-edited, or torn by something below this process. The
    // data is already unusable, so starting over loses nothing that was still there.
    logger.warn('Discarding an unreadable mini app save file', { appId, error })
    return {}
  }
}

export function writeStorage(appId: string, map: Record<string, string>): void {
  const content = JSON.stringify(map)
  const bytes = Buffer.byteLength(content, 'utf8')
  // Check BEFORE touching the disk: the temp file is the same size as the real one,
  // so writing first and checking after would let a rejected save fill the disk.
  if (bytes > MINI_APP_STORAGE_MAX_BYTES) {
    throw new QuotaExceededError(`Save file would be ${bytes} bytes (limit ${MINI_APP_STORAGE_MAX_BYTES})`)
  }
  if (Object.keys(map).length > MINI_APP_STORAGE_MAX_KEYS) {
    throw new QuotaExceededError(`Save file would hold ${Object.keys(map).length} keys`)
  }
  const target = miniAppStorageFile(appId)
  fs.mkdirSync(miniAppDataPath(appId), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, target)
}

/**
 * ADVISORY, and the one reader of the save file that must never throw.
 *
 * The detail panel reads this synchronously while it renders (`miniAppDetail`), and that
 * panel is where the user goes to clear the data or uninstall the app — so letting an
 * unreadable file propagate here turns "your save is damaged" into "the screen that could
 * fix it will not open". Nothing enforces a limit from this: `writeStorage` weighs the map
 * it is handed, so reporting a fallback here cannot widen what an app may write.
 */
/** Never throws, for any reason: see the call site. */
function sizeOnDisk(file: string): number {
  try {
    return fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0
  } catch {
    return 0
  }
}

export function storageUsage(appId: string) {
  let map: Record<string, string> = {}
  let bytes = 0
  try {
    map = readStorage(appId)
    bytes = Buffer.byteLength(JSON.stringify(map), 'utf8')
  } catch {
    // The file's size on disk rather than 0: "0 bytes" next to a Clear-data button reads as
    // "there is nothing here", which is the one thing we know to be untrue.
    //
    // Wrapped, because `throwIfNoEntry` covers ENOENT ALONE — and an EACCES on the file or
    // its directory is the very thing that lands execution here, so the unwrapped call threw
    // straight back out in exactly the case this fallback exists for. Zero is a poorer answer
    // than the size, but this function must not be able to take down the one screen that can
    // clear the data.
    bytes = sizeOnDisk(miniAppStorageFile(appId))
  }
  return {
    bytes,
    count: Object.keys(map).length,
    bytesLimit: MINI_APP_STORAGE_MAX_BYTES,
    countLimit: MINI_APP_STORAGE_MAX_KEYS
  }
}
