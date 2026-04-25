import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('HeartbeatReader')

const HEARTBEAT_FILENAME = 'heartbeat.md'

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
