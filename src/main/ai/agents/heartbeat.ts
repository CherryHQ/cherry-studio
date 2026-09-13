import { constants } from 'node:fs'
import { lstat, mkdir, open, unlink } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('HeartbeatReader')

const HEARTBEAT_FILENAME = 'heartbeat.md'

// An unterminated `<!--` consumes the rest of the file (HTML5 rule), so a
// truncated template still counts as comments-only instead of firing a model call.
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?(?:-->|$)/g

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
    // libuv drops O_NOFOLLOW on Windows (UV_FS_O_NOFOLLOW unsupported), so
    // the open below would silently follow a symlink there. Refuse a
    // pre-existing symlink via lstat on that platform — non-atomic, but the
    // only guard Windows offers.
    if (process.platform === 'win32') {
      const linkStat = await lstat(resolved).catch(() => null)
      if (linkStat?.isSymbolicLink()) {
        logger.warn(`Heartbeat path is a symlink; refusing to read: ${resolved}`)
        return undefined
      }
    }
    // O_NOFOLLOW + fstat on the open handle: a pre-existing symlink at
    // heartbeat.md — or one swapped in between any check and the read — fails
    // the open with ELOOP instead of streaming its target (e.g. ~/.ssh)
    // straight into the model prompt. lstat+readFile would leave that window.
    const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW)
    let content: string
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) {
        logger.warn(`Heartbeat path is not a regular file; refusing to read: ${resolved}`)
        return undefined
      }
      content = await handle.readFile('utf-8')
    } finally {
      await handle.close()
    }
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
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      logger.debug(`Heartbeat file not found: ${resolved}`)
      return undefined
    }
    if (code === 'ELOOP') {
      logger.warn(`Heartbeat path is a symlink; refusing to read: ${resolved}`)
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
    await writeTemplate(resolved)
    logger.info(`Provisioned heartbeat file: ${resolved}`)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      // The exclusive create never follows a symlink, so something is there.
      // Leave user content alone, but flag a non-regular occupant (a symlinked
      // heartbeat.md would make every tick read outside managed storage).
      const stat = await lstat(resolved).catch(() => null)
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) {
        logger.warn(`Heartbeat path is not a regular file; not provisioning: ${resolved}`)
      }
      return
    }
    // Missing workspace directory (migrated/corrupted install or manual deletion): recreate and retry once.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  try {
    await mkdir(path.dirname(resolved), { recursive: true })
  } catch (mkdirError) {
    throw new Error(`Cannot recreate workspace directory for heartbeat file: ${resolved}`, { cause: mkdirError })
  }
  try {
    await writeTemplate(resolved)
    logger.info(`Provisioned heartbeat file after recreating workspace: ${resolved}`)
  } catch (retryError) {
    if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') return
    if ((retryError as NodeJS.ErrnoException).code !== 'ENOENT') throw retryError
    // A concurrent remover deleted the directory between mkdir and open; a
    // missing file reads as empty, so skip rather than abort the sync.
    logger.warn(`Workspace directory vanished while provisioning heartbeat file: ${resolved}`)
  }
}

async function writeTemplate(resolved: string): Promise<void> {
  const handle = await open(resolved, 'wx', 0o600)
  try {
    await handle.writeFile(HEARTBEAT_TEMPLATE, 'utf-8')
  } catch (error) {
    // Close BEFORE unlink: Windows refuses to delete an open file (EPERM),
    // and a swallowed failure there would leave the corpse behind forever.
    await handle.close().catch(() => undefined)
    // A failed write leaves a zero-byte/partial file behind; every later
    // ensure short-circuits on EEXIST and the heartbeat is silently empty
    // forever. Drop the corpse so the next sync re-provisions.
    await unlink(resolved).catch(() => undefined)
    throw error
  }
  await handle.close()
}
