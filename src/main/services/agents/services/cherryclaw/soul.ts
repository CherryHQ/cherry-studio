import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'

const logger = loggerService.withContext('SoulReader')

type CacheEntry = {
  mtimeMs: number
  content: string
}

export class SoulReader {
  private cache = new Map<string, CacheEntry>()

  async readSoul(workspacePath: string): Promise<string | undefined> {
    const soulPath = path.join(workspacePath, 'soul.md')

    let fileStat
    try {
      fileStat = await stat(soulPath)
    } catch {
      logger.info(`soul.md not found at ${soulPath}`)
      return undefined
    }

    const cached = this.cache.get(soulPath)
    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      logger.info(`Serving cached soul.md for ${workspacePath}`)
      return cached.content
    }

    try {
      const content = await readFile(soulPath, 'utf-8')
      this.cache.set(soulPath, { mtimeMs: fileStat.mtimeMs, content })
      logger.info(`Loaded soul.md from ${soulPath}`)
      return content
    } catch (error) {
      logger.error(`Failed to read soul.md at ${soulPath}`, error as Error)
      return undefined
    }
  }
}
