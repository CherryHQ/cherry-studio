import { constants } from 'node:fs'
import { lstat, mkdir, open, unlink } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { hasHeartbeatTasks } from '@shared/ai/agentHeartbeat'

const logger = loggerService.withContext('HeartbeatReader')

const HEARTBEAT_FILENAME = 'heartbeat.md'

/** Comments-only template: readHeartbeat skips it, so a fresh heartbeat costs nothing until the user adds real entries. */
const HEARTBEAT_TEMPLATE = [
  '<!-- Heartbeat checklist: read on every heartbeat tick (interval in agent settings). -->',
  '<!-- Add short periodic tasks below as plain markdown, e.g. "- Check the inbox". -->',
  '<!-- Keep it small: every non-empty tick is a model call. While only these comments are present, ticks are skipped. -->',
  ''
].join('\n')

export async function readHeartbeat(workspacePath: string): Promise<string | undefined> {
  const resolved = path.resolve(workspacePath, HEARTBEAT_FILENAME)
  const normalizedWorkspace = path.resolve(workspacePath)

  if (!resolved.startsWith(normalizedWorkspace + path.sep) && resolved !== normalizedWorkspace) {
    logger.warn(`Path traversal attempt blocked: ${HEARTBEAT_FILENAME}`)
    return undefined
  }

  try {
    // Windows ignores O_NOFOLLOW; lstat rejects existing symlinks, but is not atomic.
    if (process.platform === 'win32') {
      const linkStat = await lstat(resolved).catch(() => null)
      if (linkStat?.isSymbolicLink()) {
        logger.warn(`Heartbeat path is a symlink; refusing to read: ${resolved}`)
        return undefined
      }
    }
    // O_NOFOLLOW rejects symlink swaps; handle.stat validates the opened file.
    // O_NONBLOCK prevents FIFO opens from hanging before validation.
    const openFlags =
      constants.O_RDONLY | constants.O_NOFOLLOW | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK)
    const handle = await open(resolved, openFlags)
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
    if (!hasHeartbeatTasks(trimmed)) {
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

/** The heartbeat.md path is occupied by a non-regular file — every tick would fail its read. */
export class HeartbeatFileNotRegularError extends Error {
  constructor(readonly occupiedPath: string) {
    super(`Heartbeat path is not a regular file: ${occupiedPath}`)
  }
}

/**
 * Provision `heartbeat.md` in a workspace with the comments-only template.
 * Idempotent: an existing file is never touched (the `wx` flag fails with
 * EEXIST), so user checklists survive re-runs.
 */
/** True when the heartbeat path is absent or holds a regular file — not a symlink/dir/FIFO occupant. */
async function heartbeatOccupantIsRegular(resolved: string): Promise<boolean> {
  const stat = await lstat(resolved).catch(() => null)
  return stat === null || stat.isFile()
}

export async function ensureHeartbeatFile(workspacePath: string): Promise<void> {
  const resolved = path.resolve(workspacePath, HEARTBEAT_FILENAME)
  try {
    await writeTemplate(resolved)
    logger.info(`Provisioned heartbeat file: ${resolved}`)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      // Exclusive creation preserves user files; reject non-regular occupants before arming.
      if (!(await heartbeatOccupantIsRegular(resolved))) throw new HeartbeatFileNotRegularError(resolved)
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
    if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') {
      // Same non-regular check as the first attempt: an occupant that appeared
      // during the recovery window must not be silently accepted.
      if (!(await heartbeatOccupantIsRegular(resolved))) throw new HeartbeatFileNotRegularError(resolved)
      return
    }
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
    // Remove partial files after failed writes so the next sync can provision them again.
    await unlink(resolved).catch(() => undefined)
    throw error
  }
  await handle.close()
}
