import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'

import { loggerService } from '@logger'
import { getBinaryPath } from '@main/utils/process'
import { gte as semverGte } from 'semver'

const execFileAsync = promisify(execFile)
const logger = loggerService.withContext('Utils:Rtk')

const RTK_MIN_VERSION = '0.23.0'
const REWRITE_TIMEOUT_MS = 3000

let rtkPath: string | null = null
let rtkAvailable: boolean | null = null

async function checkRtkAvailable(): Promise<boolean> {
  if (rtkAvailable !== null) return rtkAvailable

  const resolved = await getBinaryPath('rtk')
  if (!fs.existsSync(resolved)) {
    rtkPath = null
    rtkAvailable = false
    logger.debug('rtk binary not found')
    return false
  }
  rtkPath = resolved

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
