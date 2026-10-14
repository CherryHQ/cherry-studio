import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { isLinux, isWin } from '@main/core/platform'
import { isPathInside } from '@main/utils/file'

/**
 * Shared acceptance policy for `feature.notes.path` — used by folder pickers,
 * Notes loading, and notes-directory migration so a saved path is not rejected later.
 */
export function isNotesDirectoryAcceptedForLoading(dirPath: string): boolean {
  try {
    if (!dirPath || typeof dirPath !== 'string') {
      return false
    }

    const normalizedPath = path.resolve(dirPath)

    if (!fs.existsSync(normalizedPath)) {
      return false
    }

    const stats = fs.statSync(normalizedPath)
    if (!stats.isDirectory()) {
      return false
    }

    const appDataPath = path.resolve(application.getPath('sys.appdata'))
    const filesDir = path.resolve(application.getPath('feature.files.data'))
    const currentNotesDir = path.resolve(application.getPath('feature.notes.data'))

    if (
      normalizedPath === filesDir ||
      isPathInside(normalizedPath, filesDir) ||
      normalizedPath === currentNotesDir ||
      normalizedPath === appDataPath ||
      isPathInside(normalizedPath, appDataPath)
    ) {
      return false
    }

    const isSystemRoot = isWin
      ? /^[a-zA-Z]:[\\/]?$/.test(normalizedPath)
      : normalizedPath === '/' ||
        normalizedPath === '/usr' ||
        normalizedPath === '/etc' ||
        normalizedPath === '/System' ||
        (isLinux && (normalizedPath === '/bin' || normalizedPath === '/sbin' || normalizedPath === '/var'))

    if (isSystemRoot) {
      return false
    }

    try {
      fs.accessSync(normalizedPath, fs.constants.W_OK)
    } catch {
      return false
    }

    return true
  } catch {
    return false
  }
}
