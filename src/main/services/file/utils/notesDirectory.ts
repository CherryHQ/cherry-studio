import * as fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'

const logger = loggerService.withContext('NotesDirectory')

export function validateNotesDirectory(dirPath: string): boolean {
  try {
    if (!dirPath || typeof dirPath !== 'string') return false

    const normalizedPath = path.resolve(dirPath)
    if (!fs.existsSync(normalizedPath) || !fs.statSync(normalizedPath).isDirectory()) return false

    const appDataPath = path.resolve(application.getPath('sys.appdata'))
    const filesDir = path.resolve(application.getPath('feature.files.data'))
    const currentNotesDir = path.resolve(application.getPath('feature.notes.data'))
    if (
      normalizedPath.startsWith(filesDir) ||
      normalizedPath.startsWith(appDataPath) ||
      normalizedPath === currentNotesDir
    ) {
      logger.warn(`Invalid directory selection: ${normalizedPath} (app data directory)`)
      return false
    }

    const isSystemRoot =
      (isWin && /^[a-zA-Z]:[\\/]?$/.test(normalizedPath)) ||
      (!isWin &&
        (normalizedPath === '/' ||
          normalizedPath === '/usr' ||
          normalizedPath === '/etc' ||
          normalizedPath === '/System'))
    if (isSystemRoot) {
      logger.warn(`Invalid directory selection: ${normalizedPath} (system root directory)`)
      return false
    }

    try {
      fs.accessSync(normalizedPath, fs.constants.W_OK)
    } catch {
      logger.warn(`Directory not writable: ${normalizedPath}`)
      return false
    }

    return true
  } catch (error) {
    logger.error('Failed to validate notes directory:', error as Error)
    return false
  }
}
