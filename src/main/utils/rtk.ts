import { execFile } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { HOME_CHERRY_DIR } from '@shared/config/constant'
import { app } from 'electron'
import os from 'os'

import { isWin } from '../constant'
import { getResourcePath } from '.'

const execFileAsync = promisify(execFile)
const logger = loggerService.withContext('Utils:Rtk')

const RTK_BINARY = isWin ? 'rtk.exe' : 'rtk'
const JQ_BINARY = isWin ? 'jq.exe' : 'jq'
const REWRITE_TIMEOUT_MS = 3000

let rtkPath: string | null = null
let rtkAvailable: boolean | null = null

function getPlatformKey(): string {
  return `${process.platform}-${process.arch}`
}

function getBundledBinariesDir(): string {
  const dir = path.join(getResourcePath(), 'binaries', getPlatformKey())
  if (app.isPackaged) {
    return dir.replace(/\.asar([\\/])/, '.asar.unpacked$1')
  }
  return dir
}

function getUserBinDir(): string {
  return path.join(os.homedir(), HOME_CHERRY_DIR, 'bin')
}

/**
 * Extract bundled rtk and jq binaries to ~/.cherrystudio/bin/ if not already present.
 * Called once at app startup.
 */
export function extractRtkBinaries(): void {
  const bundledDir = getBundledBinariesDir()
  if (!fs.existsSync(bundledDir)) {
    logger.debug('No bundled rtk binaries found for this platform', { dir: bundledDir })
    return
  }

  const userBinDir = getUserBinDir()
  fs.mkdirSync(userBinDir, { recursive: true })

  for (const binaryName of [RTK_BINARY, JQ_BINARY]) {
    const src = path.join(bundledDir, binaryName)
    const dest = path.join(userBinDir, binaryName)

    if (!fs.existsSync(src)) {
      continue
    }

    // Copy if destination doesn't exist or size differs (version upgrade)
    const shouldCopy = !fs.existsSync(dest) || fs.statSync(src).size !== fs.statSync(dest).size

    if (shouldCopy) {
      fs.copyFileSync(src, dest)
      if (!isWin) {
        fs.chmodSync(dest, 0o755)
      }
      logger.info('Extracted binary to user bin dir', { binary: binaryName, dest })
    }
  }
}

function resolveRtkPath(): string | null {
  const userBinPath = path.join(getUserBinDir(), RTK_BINARY)
  if (fs.existsSync(userBinPath)) {
    return userBinPath
  }

  const bundledPath = path.join(getBundledBinariesDir(), RTK_BINARY)
  if (fs.existsSync(bundledPath)) {
    return bundledPath
  }

  return null
}

function isRtkAvailable(): boolean {
  if (rtkAvailable !== null) return rtkAvailable

  rtkPath = resolveRtkPath()
  if (!rtkPath) {
    rtkAvailable = false
    logger.debug('rtk binary not found')
    return false
  }

  try {
    const output = execFileSync(rtkPath, ['--version'], {
      timeout: REWRITE_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const match = output.match(/(\d+)\.(\d+)\.(\d+)/)
    if (match) {
      const major = parseInt(match[1], 10)
      const minor = parseInt(match[2], 10)
      if (major === 0 && minor < 23) {
        logger.warn('rtk version too old (need >= 0.23.0)', { version: match[0] })
        rtkAvailable = false
        return false
      }
      logger.info('rtk available', { version: match[0], path: rtkPath })
    }
    rtkAvailable = true
  } catch (error) {
    logger.warn('Failed to check rtk version', {
      error: error instanceof Error ? error.message : String(error)
    })
    rtkAvailable = false
  }

  return rtkAvailable
}

/**
 * Rewrite a shell command using rtk for token-optimized output.
 * Returns the rewritten command, or null if no rewrite is available.
 */
export async function rtkRewrite(command: string): Promise<string | null> {
  if (!isRtkAvailable() || !rtkPath) {
    return null
  }

  try {
    const { stdout } = await execFileAsync(rtkPath, ['rewrite', command], {
      timeout: REWRITE_TIMEOUT_MS
    })
    const rewritten = stdout.trim()

    if (!rewritten || rewritten === command) {
      return null
    }

    return rewritten
  } catch {
    // rtk rewrite exits 1 when there's no rewrite — expected behavior
    return null
  }
}
