/**
 * Project-instructions reminder. Reads `<workspaceRoot>/AGENTS.md`
 * (preferred) or `CLAUDE.md` (fallback). Returns null when neither is
 * present or when there's no workspace at all.
 *
 * Cached via `CacheService` keyed by absolute file path. The cache
 * value carries the file's mtimeMs alongside the content; a stat on
 * every call lets us reuse the cached body when the file is
 * unchanged and re-read when it isn't. The CacheService TTL is the
 * outer bound — used as a fallback if mtime-based invalidation
 * somehow misses (e.g., filesystem timestamps go backwards).
 */

import { stat } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'

import type { ReminderBlock, StaticReminderSource } from '../types'

const logger = loggerService.withContext('agentsMdSource')

const CANDIDATE_FILES = ['AGENTS.md', 'CLAUDE.md'] as const
const REMINDER_NAME = 'agents-md'
const CACHE_TTL_MS = 5 * 60 * 1000
const KEY_PREFIX = 'reminders.agents_md.'

interface CacheEntry {
  mtimeMs: number
  content: string
}

export const agentsMdSource: StaticReminderSource = async (ctx): Promise<ReminderBlock | null> => {
  if (!ctx.workspaceRoot) return null

  for (const filename of CANDIDATE_FILES) {
    const filePath = join(ctx.workspaceRoot, filename)
    const content = await readWithCache(filePath)
    if (content !== null) return { name: REMINDER_NAME, content }
  }
  return null
}

async function readWithCache(filePath: string): Promise<string | null> {
  let mtimeMs: number
  try {
    const s = await stat(filePath)
    mtimeMs = s.mtimeMs
  } catch {
    return null
  }

  const cache = application.get('CacheService')
  const key = `${KEY_PREFIX}${filePath}`
  const cached = cache.get<CacheEntry>(key)
  if (cached && cached.mtimeMs === mtimeMs) return cached.content

  try {
    const content = await readFile(filePath, 'utf8')
    cache.set(key, { mtimeMs, content }, CACHE_TTL_MS)
    return content
  } catch (err) {
    logger.warn('failed to read project instructions file', { filePath, error: String(err) })
    return null
  }
}
