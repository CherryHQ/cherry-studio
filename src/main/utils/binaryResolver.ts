import fs from 'fs'
import fsp from 'node:fs/promises'
import path from 'path'

import { application } from '@application'
import { isWin } from '@main/core/platform'

import { getBinarySearchDirs } from './binaryEnv'
import { isSameOrInside } from './file'

/**
 * Resolution for Cherry-managed binaries — turns a tool name into the on-disk
 * path of the bundled-or-installed executable, searching the layout defined by
 * `binaryEnv.getBinarySearchDirs()` (mise shims first, then `cherry.bin`).
 */

export async function isManagedBinaryPath(candidate: string, roots: string[]): Promise<boolean> {
  if (roots.some((root) => isSameOrInside(candidate, root))) return true
  const resolved = await fsp.realpath(candidate).catch(() => undefined)
  if (!resolved) return false
  const canonicalRoots = await Promise.all(roots.map((root) => fsp.realpath(root).catch(() => root)))
  return canonicalRoots.some((root) => isSameOrInside(resolved, root))
}

export function getBinaryName(name: string): string {
  return isWin ? `${name}.exe` : name
}

export async function getBinaryPath(name?: string): Promise<string> {
  const searchDirs = getBinarySearchDirs()
  if (!name) {
    // Legacy: no-arg returns the cherry.bin directory (extract target).
    return application.getPath('cherry.bin')
  }

  const binaryName = getBinaryName(name)
  for (const dir of searchDirs) {
    const candidate = path.join(dir, binaryName)
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return binaryName
}

export async function isBinaryExists(name: string): Promise<boolean> {
  const cmd = await getBinaryPath(name)
  return fs.existsSync(cmd)
}
