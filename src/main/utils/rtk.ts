import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { getBinaryExecutionEnv, getBinaryPath } from '@main/utils/process'
import { gte as semverGte } from 'semver'

const execFileAsync = promisify(execFile)
const logger = loggerService.withContext('Utils:Rtk')

const RTK_MIN_VERSION = '0.23.0'
const REWRITE_TIMEOUT_MS = 3000
// Re-probe rtk availability periodically so that installing or uninstalling rtk
// via BinaryManager takes effect without restarting the app. The probe itself
// is cheap (one execFile + version parse) and only runs at most once per minute.
const RTK_PROBE_TTL_MS = 60_000

let rtkPath: string | null = null
let rtkAvailable: boolean | null = null
let rtkProbedAt = 0

async function checkRtkAvailable(): Promise<boolean> {
  if (rtkAvailable !== null && Date.now() - rtkProbedAt < RTK_PROBE_TTL_MS) {
    return rtkAvailable
  }
  rtkProbedAt = Date.now()

  const resolved = await getBinaryPath('rtk')
  if (!fs.existsSync(resolved)) {
    rtkPath = null
    rtkAvailable = false
    logger.warn('rtk binary not found; command rewrite disabled until RTK is installed from Settings → Plugins')
    return false
  }
  rtkPath = resolved

  try {
    const { stdout } = await execFileAsync(rtkPath, ['--version'], {
      env: { ...process.env, ...getBinaryExecutionEnv() },
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
      env: { ...process.env, ...getBinaryExecutionEnv() },
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
