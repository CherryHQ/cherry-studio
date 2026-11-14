import fs from 'node:fs'
import path from 'node:path'

import { application } from '@application'
import { isLinux, isWin } from '@main/core/platform'
import { isOutsidePath } from '@main/utils/file'

/**
 * Canonical on-disk spelling of an existing path. `realpath.native` returns the stored case on
 * case-insensitive volumes and leaves case-sensitive volumes untouched, so an exact comparison on its
 * result follows the actual filesystem instead of a per-platform case-folding guess.
 */
function canonicalPath(target: string): string {
  try {
    return fs.realpathSync.native(target)
  } catch {
    return path.resolve(target)
  }
}

function isSameOrInsideCanonical(candidate: string, container: string): boolean {
  const relative = path.relative(container, candidate)
  return relative === '' || !isOutsidePath(relative)
}

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

    // Check both the lexical spelling and the canonical path (exact case each): symlinked aliases can't
    // sneak into or out of protected roots, and a distinct directory on a case-sensitive volume
    // (e.g. `…/library/…` vs `…/Library/…`) stays accepted. Canonicalization supplies the case folding
    // on case-insensitive volumes.
    const protectedRoots = (['sys.appdata', 'feature.files.data'] as const).map((key) => application.getPath(key))
    const notesRoot = application.getPath('feature.notes.data')
    const isProtected = (candidate: string, resolveRoot: (root: string) => string) =>
      protectedRoots.some((root) => isSameOrInsideCanonical(candidate, resolveRoot(root))) ||
      candidate === resolveRoot(notesRoot)

    if (
      isProtected(normalizedPath, (root) => path.resolve(root)) ||
      isProtected(canonicalPath(normalizedPath), canonicalPath)
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
