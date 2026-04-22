import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { HOME_CHERRY_DIR } from '@shared/config/constant'
import { gte as semverGte } from 'semver'

import { isWin } from '../constant'
import { getResourcePath, toAsarUnpackedPath } from '.'

const execFileAsync = promisify(execFile)
const logger = loggerService.withContext('Utils:Rtk')

const RTK_BINARY = isWin ? 'rtk.exe' : 'rtk'
const RTK_VERSION_FILE = '.rtk-version'
const RTK_MIN_VERSION = '0.23.0'
const REWRITE_TIMEOUT_MS = 3000

// rtk is not available for these platforms
const UNSUPPORTED_PLATFORMS = new Set(['win32-arm64'])

let rtkPath: string | null = null
let rtkAvailable: boolean | null = null

function getPlatformKey(): string {
  return `${process.platform}-${process.arch}`
}

function isPlatformSupported(): boolean {
  return !UNSUPPORTED_PLATFORMS.has(getPlatformKey())
}

function getBundledBinariesDir(): string {
  const dir = path.join(getResourcePath(), 'binaries', getPlatformKey())
  return toAsarUnpackedPath(dir)
}

function getUserBinDir(): string {
  return path.join(os.homedir(), HOME_CHERRY_DIR, 'bin')
}

/**
 * Extract bundled rtk binary to ~/.cherrystudio/bin/ if not already present or outdated.
 * Called once at app startup.
 */
export async function extractRtkBinaries(): Promise<void> {
  if (!isPlatformSupported()) {
    logger.debug('rtk not supported on this platform', { platform: getPlatformKey() })
    return
  }

  const bundledDir = getBundledBinariesDir()
  if (!fs.existsSync(bundledDir)) {
    logger.debug('No bundled rtk binaries found for this platform', { dir: bundledDir })
    return
  }

  const userBinDir = getUserBinDir()
  fs.mkdirSync(userBinDir, { recursive: true })

  const src = path.join(bundledDir, RTK_BINARY)
  const dest = path.join(userBinDir, RTK_BINARY)

  if (!fs.existsSync(src)) {
    return
  }

  // Use a version file to detect upgrades instead of comparing file sizes
  const bundledVersionFile = path.join(bundledDir, RTK_VERSION_FILE)
  const installedVersionFile = path.join(userBinDir, RTK_VERSION_FILE)
  const bundledVersion = fs.existsSync(bundledVersionFile) ? fs.readFileSync(bundledVersionFile, 'utf8').trim() : ''
  const installedVersion = fs.existsSync(installedVersionFile)
    ? fs.readFileSync(installedVersionFile, 'utf8').trim()
    : ''

  const shouldCopy = !fs.existsSync(dest) || (bundledVersion && bundledVersion !== installedVersion)

  if (shouldCopy) {
    fs.copyFileSync(src, dest)
    if (!isWin) {
      fs.chmodSync(dest, 0o755)
    }
    if (bundledVersion) {
      fs.writeFileSync(installedVersionFile, bundledVersion, 'utf8')
    }
    logger.info('Extracted rtk binary to user bin dir', { dest, version: bundledVersion || 'unknown' })
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

async function checkRtkAvailable(): Promise<boolean> {
  if (rtkAvailable !== null) return rtkAvailable

  if (!isPlatformSupported()) {
    rtkAvailable = false
    return false
  }

  rtkPath = resolveRtkPath()
  if (!rtkPath) {
    rtkAvailable = false
    logger.debug('rtk binary not found')
    return false
  }

  try {
    const { stdout } = await execFileAsync(rtkPath, ['--version'], {
      timeout: REWRITE_TIMEOUT_MS
    })
    const match = stdout.match(/(\d+\.\d+\.\d+)/)
    if (match) {
      const version = match[1]
      if (!semverGte(version, RTK_MIN_VERSION)) {
        logger.warn(`rtk version too old (need >= ${RTK_MIN_VERSION})`, { version })
        rtkAvailable = false
        return false
      }
      logger.info('rtk available', { version, path: rtkPath })
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
  if (!(await checkRtkAvailable()) || !rtkPath) {
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
