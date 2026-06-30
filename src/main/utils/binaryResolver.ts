import { application } from '@application'
import { isWin } from '@main/core/platform'
import fs from 'fs'
import path from 'path'

import { getBinarySearchDirs } from './binaryEnv'

/**
 * Resolution for Cherry-managed binaries — turns a tool name into the on-disk
 * path of the bundled-or-installed executable, searching the layout defined by
 * `binaryEnv.getBinarySearchDirs()` (mise shims first, then `cherry.bin`).
 */

export async function getBinaryName(name: string): Promise<string> {
  if (isWin) {
    return `${name}.exe`
  }
  return name
}

export async function getBinaryPath(name?: string): Promise<string> {
  const searchDirs = getBinarySearchDirs()
  if (!name) {
    // Legacy: no-arg returns the cherry.bin directory (extract target).
    return application.getPath('cherry.bin')
  }

  const binaryName = await getBinaryName(name)
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
