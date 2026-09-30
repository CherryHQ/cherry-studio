import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { isLinux, isMac, isWin } from '@main/core/platform'
import type { NotesRelocationValidationReason } from '@shared/types/notesRelocation'

export class NotesRelocationValidationError extends Error {
  constructor(
    readonly reason: NotesRelocationValidationReason,
    message: string
  ) {
    super(message)
    this.name = 'NotesRelocationValidationError'
  }
}

function invalid(reason: NotesRelocationValidationReason, message: string): never {
  throw new NotesRelocationValidationError(reason, message)
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value)
  return isWin || isMac ? resolved.toLowerCase() : resolved
}

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(normalizeForCompare(parent), normalizeForCompare(child))
  if (relative === '' || relative === '..' || path.isAbsolute(relative)) {
    return false
  }
  return !relative.startsWith(`..${path.sep}`)
}

export function realPath(value: string): string {
  try {
    return fs.realpathSync.native?.(value) ?? fs.realpathSync(value)
  } catch {
    return path.resolve(value)
  }
}

function pathEntryExists(value: string): boolean {
  try {
    fs.lstatSync(value)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function resolveExistingAncestor(value: string): { path: string; effectivePath: string } {
  let cursor = path.resolve(value)
  const missingParts: string[] = []
  while (!pathEntryExists(cursor)) {
    const parent = path.dirname(cursor)
    if (parent === cursor) {
      invalid('invalid_target', `no existing ancestor for target: ${value}`)
    }
    missingParts.unshift(path.basename(cursor))
    cursor = parent
  }
  return { path: cursor, effectivePath: path.join(realPath(cursor), ...missingParts) }
}

function assertNotesTargetDirectory(dirPath: string): void {
  if (!dirPath || typeof dirPath !== 'string') {
    invalid('invalid_target', 'target path is required')
  }

  const normalizedPath = path.resolve(dirPath)
  if (!fs.existsSync(normalizedPath)) {
    invalid('invalid_target', `target does not exist: ${dirPath}`)
  }

  const stats = fs.statSync(normalizedPath)
  if (!stats.isDirectory()) {
    invalid('invalid_target', `target is not a directory: ${dirPath}`)
  }

  const physicalPath = normalizeForCompare(resolveExistingAncestor(dirPath).effectivePath)
  const appDataPath = normalizeForCompare(realPath(application.getPath('sys.appdata')))
  const filesDir = normalizeForCompare(realPath(application.getPath('feature.files.data')))
  const defaultNotesDir = normalizeForCompare(realPath(application.getPath('feature.notes.data')))

  if (
    physicalPath === filesDir ||
    isPathInside(physicalPath, filesDir) ||
    physicalPath === defaultNotesDir ||
    physicalPath === appDataPath
  ) {
    invalid('invalid_target', `target is a protected directory: ${dirPath}`)
  }

  const isSystemRoot = isWin
    ? /^[a-zA-Z]:[\\/]?$/.test(physicalPath)
    : physicalPath === '/' ||
      physicalPath === '/usr' ||
      physicalPath === '/etc' ||
      physicalPath === '/system' ||
      (isLinux && (physicalPath === '/bin' || physicalPath === '/sbin' || physicalPath === '/var'))

  if (isSystemRoot) {
    invalid('invalid_target', `target is a system root directory: ${dirPath}`)
  }

  try {
    fs.accessSync(normalizedPath, fs.constants.W_OK)
  } catch {
    invalid('target_not_writable', `target is not writable: ${dirPath}`)
  }
}

export function assertNotesRelocationPaths(sourcePath: string, targetPath: string): void {
  const sourceReal = normalizeForCompare(realPath(sourcePath))
  const targetEffective = normalizeForCompare(resolveExistingAncestor(targetPath).effectivePath)

  if (!fs.existsSync(sourcePath)) {
    invalid('source_missing', `source does not exist: ${sourcePath}`)
  }
  if (!fs.statSync(sourcePath).isDirectory()) {
    invalid('source_not_directory', `source is not a directory: ${sourcePath}`)
  }
  try {
    fs.accessSync(sourcePath, fs.constants.R_OK)
  } catch {
    invalid('source_missing', `source is not readable: ${sourcePath}`)
  }

  if (sourceReal === targetEffective) {
    invalid('same_path', `source and target are the same path: ${targetPath}`)
  }
  if (isPathInside(targetEffective, sourceReal)) {
    invalid('target_inside_source', `target is inside source: ${targetPath}`)
  }
  if (isPathInside(sourceReal, targetEffective)) {
    invalid('target_contains_source', `target contains source: ${targetPath}`)
  }

  assertNotesTargetDirectory(targetPath)
}
