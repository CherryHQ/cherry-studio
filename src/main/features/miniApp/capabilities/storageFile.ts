import fs from 'node:fs'

import { loggerService } from '@logger'
import * as z from 'zod'

import { miniAppDataPath, miniAppStorageFile } from '../paths'
import { MINI_APP_QUOTAS, QuotaExceededError } from './quota'

const logger = loggerService.withContext('miniAppStorage')

/** The whole save file, not one value: the backend rewrites it as a unit. */
export const MINI_APP_STORAGE_MAX_BYTES = MINI_APP_QUOTAS.storage.bytes
export const MINI_APP_STORAGE_MAX_KEYS = MINI_APP_QUOTAS.storage.count

const StorageSchema = z.record(z.string(), z.string())

export function readStorage(appId: string): Record<string, string> {
  try {
    return StorageSchema.parse(JSON.parse(fs.readFileSync(miniAppStorageFile(appId), 'utf8')))
  } catch (error) {
    // Missing is the normal first-run case; malformed means someone edited it by hand
    // or a write was torn. Neither is worth blocking the app from starting over.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Discarding an unreadable mini app save file', { appId, error })
    }
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

export function storageUsage(appId: string) {
  const map = readStorage(appId)
  return {
    bytes: Buffer.byteLength(JSON.stringify(map), 'utf8'),
    count: Object.keys(map).length,
    bytesLimit: MINI_APP_STORAGE_MAX_BYTES,
    countLimit: MINI_APP_STORAGE_MAX_KEYS
  }
}
