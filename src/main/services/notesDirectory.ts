import * as fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { canonicalizePathForContainment, isOutsidePath } from '@main/utils/file'

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

export function resolveEffectiveNotesRoot(): string {
  const defaultPath = application.getPath('feature.notes.data').replace(/\\/g, '/')
  const configured = (application.get('PreferenceService').get('feature.notes.path') || '').replace(/\\/g, '/')
  return !configured || configured === defaultPath || !validateNotesDirectory(configured) ? defaultPath : configured
}

export type NoteSourceResult =
  | { ok: true; path: string; text: string }
  | { ok: false; reason: 'missing' | 'not-a-file' | 'not-markdown' | 'outside-root' | 'unreadable' | 'unsupported' }

export async function readNoteSource(sourcePath: string, signal?: AbortSignal): Promise<NoteSourceResult> {
  signal?.throwIfAborted()
  const root = await canonicalizePathForContainment(resolveEffectiveNotesRoot(), { allowMissing: false })
  if (!root) return { ok: false, reason: 'unreadable' }
  const target = await canonicalizePathForContainment(sourcePath, { allowMissing: false })
  if (!target) {
    try {
      await fs.promises.stat(sourcePath)
      return { ok: false, reason: 'unreadable' }
    } catch (error) {
      return { ok: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable' }
    }
  }
  if (isOutsidePath(path.relative(root, target))) return { ok: false, reason: 'outside-root' }
  try {
    const stat = await fs.promises.stat(target)
    if (!stat.isFile()) return { ok: false, reason: 'not-a-file' }
    if (path.extname(target).toLowerCase() !== '.md') return { ok: false, reason: 'not-markdown' }
    if (stat.size > 10 * 1024 * 1024) return { ok: false, reason: 'unsupported' }
    const text = await fs.promises.readFile(target, { encoding: 'utf8', signal })
    return { ok: true, path: target, text }
  } catch (error) {
    signal?.throwIfAborted()
    return { ok: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable' }
  }
}
