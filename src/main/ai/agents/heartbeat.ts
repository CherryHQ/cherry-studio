import { open, readFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('HeartbeatReader')

const HEARTBEAT_FILENAME = 'heartbeat.md'

const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g

/** Comments-only template: readHeartbeat skips it, so a fresh heartbeat costs nothing until the user adds real entries. */
const HEARTBEAT_TEMPLATE = [
  '<!-- Heartbeat checklist: read on every heartbeat tick (interval in agent settings). -->',
  '<!-- Add short periodic tasks below as plain markdown, e.g. "- Check the inbox". -->',
  '<!-- Keep it small: every non-empty tick is a model call. While only these comments are present, ticks are skipped. -->',
  ''
].join('\n')

/** Effectively empty = nothing but whitespace and HTML comments (a comments-only template). */
function isEffectivelyEmpty(trimmed: string): boolean {
  return trimmed.replace(HTML_COMMENT_PATTERN, '').trim().length === 0
}

export async function readHeartbeat(workspacePath: string): Promise<string | undefined> {
  const resolved = path.resolve(workspacePath, HEARTBEAT_FILENAME)
  const normalizedWorkspace = path.resolve(workspacePath)

  if (!resolved.startsWith(normalizedWorkspace + path.sep) && resolved !== normalizedWorkspace) {
    logger.warn(`Path traversal attempt blocked: ${HEARTBEAT_FILENAME}`)
    return undefined
  }

  try {
    const content = await readFile(resolved, 'utf-8')
    const trimmed = content.trim()
    if (!trimmed) {
      logger.debug('Heartbeat file is empty', { path: resolved })
      return undefined
    }
    if (isEffectivelyEmpty(trimmed)) {
      logger.debug('Heartbeat file is effectively empty (comments only)', { path: resolved })
      return undefined
    }
    logger.info(`Read heartbeat file: ${resolved}`)
    return trimmed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug(`Heartbeat file not found: ${resolved}`)
      return undefined
    }
    logger.error(`Failed to read heartbeat file: ${resolved}`, error as Error)
    return undefined
  }
}

/**
 * Provision `heartbeat.md` in a workspace with the comments-only template.
 * Idempotent: an existing file is never touched (the `wx` flag fails with
 * EEXIST), so user checklists survive re-runs.
 */
export async function ensureHeartbeatFile(workspacePath: string): Promise<void> {
  const resolved = path.resolve(workspacePath, HEARTBEAT_FILENAME)
  try {
    const handle = await open(resolved, 'wx', 0o600)
    try {
      await handle.writeFile(HEARTBEAT_TEMPLATE, 'utf-8')
    } finally {
      await handle.close()
    }
    logger.info(`Provisioned heartbeat file: ${resolved}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return
    throw error
  }
}
