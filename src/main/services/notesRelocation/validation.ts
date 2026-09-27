import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { isWin } from '@main/core/platform'
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
  return path.normalize(path.resolve(value))
}

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(normalizeForCompare(parent), normalizeForCompare(child))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
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

  const appDataPath = path.resolve(application.getPath('sys.appdata'))
  const filesDir = path.resolve(application.getPath('feature.files.data'))
  const defaultNotesDir = path.resolve(application.getPath('feature.notes.data'))

  if (
    normalizedPath.startsWith(filesDir) ||
    normalizedPath.startsWith(appDataPath) ||
    normalizedPath === defaultNotesDir
  ) {
    invalid('invalid_target', `target is a protected directory: ${dirPath}`)
  }

  const isSystemRoot = isWin
    ? /^[a-zA-Z]:[\\/]?$/.test(normalizedPath)
    : normalizedPath === '/' || normalizedPath === '/usr' || normalizedPath === '/etc' || normalizedPath === '/System'

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
  const source = normalizeForCompare(sourcePath)
  const target = normalizeForCompare(targetPath)

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

  if (source === target) {
    invalid('same_path', `source and target are the same path: ${targetPath}`)
  }
  if (isPathInside(target, source)) {
    invalid('target_inside_source', `target is inside source: ${targetPath}`)
  }
  if (isPathInside(source, target)) {
    invalid('target_contains_source', `target contains source: ${targetPath}`)
  }

  assertNotesTargetDirectory(targetPath)
}
