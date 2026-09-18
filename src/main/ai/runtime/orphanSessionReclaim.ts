import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

import type { OrphanSessionReclaimOptions } from './types'

const logger = loggerService.withContext('OrphanSessionReclaim')

/** Directory listing that treats a never-created runtime root as empty. */
export async function listEntries(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Newest mtime anywhere under `target`. Recursive because a runtime's log can
 * sit below the directory being reclaimed (dsh writes `{project}/{session}/session.jsonl`),
 * and a directory's own mtime does not move when a child file is appended to.
 * Symlinks are never followed — `Dirent.isDirectory()` is lstat-based.
 */
export async function newestMtimeMs(target: string): Promise<number | null> {
  const stats = await fs.lstat(target).catch(() => null)
  if (!stats) return null
  if (!stats.isDirectory()) return stats.mtimeMs

  let newest = stats.mtimeMs
  for (const entry of await listEntries(target)) {
    const childNewest = await newestMtimeMs(path.resolve(target, entry.name))
    if (childNewest !== null && childNewest > newest) newest = childNewest
  }
  return newest
}

/**
 * Remove an unclaimed artifact unless it is still warm — a session that has not
 * yet persisted its resume token would otherwise lose the state it is writing.
 * Failures are logged and left for the next sweep.
 */
export async function reclaimStale(
  target: string,
  { freshnessGateMs, now }: OrphanSessionReclaimOptions
): Promise<boolean> {
  const mtimeMs = await newestMtimeMs(target)
  if (mtimeMs === null || now - mtimeMs <= freshnessGateMs) return false

  try {
    await fs.rm(target, { recursive: true, force: true })
    return true
  } catch (error) {
    logger.warn('Failed to reclaim orphan session artifact — retried next sweep', { target, error })
    return false
  }
}
