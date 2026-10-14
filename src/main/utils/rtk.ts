import path from 'node:path'

import { gte as semverGte } from 'semver'

import { application } from '@application'
import { loggerService } from '@logger'
import { getBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { CommandFailedError, executeCommand } from '@main/utils/processRunner'
import { getRawShellEnv } from '@main/utils/shellEnv'
const logger = loggerService.withContext('Utils:Rtk')

const RTK_MIN_VERSION = '0.23.0'
const REWRITE_TIMEOUT_MS = 3000
// Bound the availability probe. getToolSnapshots may run `mise ls` and `mise which`,
// each under BinaryManager's own multi-minute timeout, so a stalled mise backend
// could otherwise hold up the Bash PreToolUse hook that awaits rtkRewrite for
// minutes. On timeout rtk is treated as unavailable for this TTL cycle instead.
const PROBE_TIMEOUT_MS = 3000
// Re-probe rtk availability periodically so that installing or uninstalling rtk
// via BinaryManager takes effect without restarting the app. The probe itself
// is cheap (one execFile + version parse) and only runs at most once per minute.
const RTK_PROBE_TTL_MS = 60_000

interface RtkExecution {
  path: string
  env: NodeJS.ProcessEnv
}

let cachedProbe: { checkedAt: number; execution: RtkExecution | null } | null = null
let probePromise: Promise<RtkExecution | null> | null = null

/** Resolve `promise`, or `null` if it does not settle within `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

async function probeRtk(): Promise<RtkExecution | null> {
  // A single guard keeps the probe from ever rejecting: rtkRewrite and its Bash
  // PreToolUse hook await this inline, so a thrown snapshot query must degrade to
  // "no rewrite", never propagate out and fail the tool call.
  try {
    const snapshot = await withTimeout(
      application
        .get('BinaryManager')
        .getToolSnapshots(['rtk'])
        .then((snapshots) => snapshots.rtk),
      PROBE_TIMEOUT_MS
    )
    if (!snapshot || snapshot.availability.source === 'none') {
      logger.warn(
        snapshot
          ? 'rtk binary not found; command rewrite disabled until RTK is installed from Settings → Plugins'
          : 'rtk snapshot probe timed out; command rewrite disabled this cycle'
      )
      return null
    }

    // A Windows batch wrapper (.cmd/.bat) forces argument passing through
    // cmd.exe's parser, where the model-generated shell command handed to
    // `rtk rewrite` is not reliably escapable (cross-spawn only hardens
    // node_modules/.bin shims). The rewrite is an optimization, so refuse the
    // unsafe boundary instead of trying to escape across it.
    if (['.cmd', '.bat'].includes(path.extname(snapshot.availability.path).toLowerCase())) {
      logger.warn('rtk resolves to a batch wrapper; command rewrite disabled', {
        path: snapshot.availability.path
      })
      return null
    }

    const execution: RtkExecution = {
      path: snapshot.availability.path,
      env:
        snapshot.availability.source === 'system'
          ? await getRawShellEnv()
          : { ...process.env, ...getBinaryExecutionEnv() }
    }

    const stdout = await executeCommand(execution.path, ['--version'], {
      capture: true,
      env: execution.env,
      timeout: REWRITE_TIMEOUT_MS
    })
    const match = stdout.match(/(\d+\.\d+\.\d+)/)
    if (match) {
      const version = match[1]
      if (!semverGte(version, RTK_MIN_VERSION)) {
        logger.warn(`rtk version too old (need >= ${RTK_MIN_VERSION})`, { version })
        return null
      }
      logger.info('rtk available', { version, path: execution.path })
    }
    return execution
  } catch (error) {
    logger.warn('Failed to probe rtk', {
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

async function getRtkExecution(): Promise<RtkExecution | null> {
  if (cachedProbe && Date.now() - cachedProbe.checkedAt < RTK_PROBE_TTL_MS) return cachedProbe.execution
  if (!probePromise) {
    probePromise = probeRtk()
      .then((execution) => {
        cachedProbe = { checkedAt: Date.now(), execution }
        return execution
      })
      .finally(() => {
        probePromise = null
      })
  }
  return probePromise
}

/**
 * Rewrite a shell command using rtk for token-optimized output.
 * Returns the rewritten command, or null if no rewrite is available.
 */
export async function rtkRewrite(command: string): Promise<string | null> {
  const execution = await getRtkExecution()
  if (!execution) return null

  let stdout: string
  try {
    stdout = await executeCommand(execution.path, ['rewrite', command], {
      capture: true,
      env: execution.env,
      timeout: REWRITE_TIMEOUT_MS
    })
  } catch (error) {
    if (error instanceof CommandFailedError) {
      // Upstream contract violation (rtk-ai/rtk#3634): `rtk rewrite` prints the
      // rewritten command but exits 3 on success, so accept it while rtk ships
      // the fix. Exit 1 is the documented "no rtk equivalent" outcome.
      if (error.code === 3) {
        const rewritten = error.stdout.trim()
        if (rewritten && rewritten !== command) {
          logger.warn('rtk rewrite reported success via its non-standard exit code 3 (rtk-ai/rtk#3634)', {
            code: error.code
          })
          return rewritten
        }
      } else if (error.code !== 1) {
        logger.warn('rtk rewrite failed', { code: error.code, error: error.message })
      }
    } else {
      logger.warn('rtk rewrite failed', { error: error instanceof Error ? error.message : String(error) })
    }
    return null
  }

  const rewritten = stdout.trim()
  if (!rewritten || rewritten === command) {
    return null
  }
  return rewritten
}
