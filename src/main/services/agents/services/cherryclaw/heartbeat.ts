import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('HeartbeatReader')

export class HeartbeatReader {
  async readHeartbeat(workspacePath: string, filename: string = 'heartbeat.md'): Promise<string | undefined> {
    const resolved = path.resolve(workspacePath, filename)
    const normalizedWorkspace = path.resolve(workspacePath)

    if (!resolved.startsWith(normalizedWorkspace + path.sep) && resolved !== normalizedWorkspace) {
      logger.warn(`Path traversal attempt blocked: ${filename}`)
      return undefined
    }

    try {
      const content = await readFile(resolved, 'utf-8')
      logger.info(`Read heartbeat file: ${resolved}`)
      return content
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info(`Heartbeat file not found: ${resolved}`)
        return undefined
      }
      logger.error(`Failed to read heartbeat file: ${resolved}`, error)
      return undefined
    }
  }
}
