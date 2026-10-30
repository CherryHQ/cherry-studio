import path from 'node:path'

import { gte as semverGte } from 'semver'

import { application } from '@application'
import { loggerService } from '@logger'
import { getBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { CommandFailedError, executeCommand } from '@main/utils/processRunner'
import { getRawShellEnv } from '@main/utils/shellEnv'
const logger = loggerService.withContext('Utils:Rtk')

const RTK_MIN_VERSION = '0.23.0'
// A slow wrapper — e.g. `rtk` resolving to a mise shim — can cost 5-10s per
// exec (measured 4.9-9.6s for `rtk --version` through one, #21599), so the
// probe and rewrite budgets have to cover wrapper startup, not just binary
// startup.
const REWRITE_TIMEOUT_MS = 10_000
// Bound the availability probe. getToolSnapshots may run `mise ls` and `mise which`,
// each under BinaryManager's own multi-minute timeout, so a stalled mise backend
// could otherwise hold up the Bash PreToolUse hook that awaits rtkRewrite for
// minutes. On timeout rtk is treated as unavailable for this TTL cycle instead.
const PROBE_TIMEOUT_MS = 10_000
// The `--version` exec inside the probe goes through the same wrapper and needs
// the same budget as the snapshot query.
const PROBE_EXEC_TIMEOUT_MS = 10_000
// Re-probe rtk availability periodically so that installing or uninstalling rtk
// via BinaryManager takes effect without restarting the app.
const RTK_PROBE_TTL_MS = 60_000
// A transient probe failure (timeout) is cached for this shorter TTL instead of
// the full one: a one-off hiccup must not disable the feature for a minute
// (#21599), but the Bash PreToolUse hook also should not re-pay a multi-second
// probe on every single tool call.
const RTK_PROBE_FAILURE_TTL_MS = 15_000

interface RtkExecution {
  path: string
  env: NodeJS.ProcessEnv
}

interface ProbeOutcome {
  execution: RtkExecution | null
  /** false when the outcome is definitive (absent / too old / batch wrapper). */
  transient: boolean
}

let cachedProbe: { checkedAt: number; ttl: number; execution: RtkExecution | null } | null = null
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

async function probeRtk(): Promise<ProbeOutcome> {
  const startedAt = Date.now()
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
    if (snapshot === null) {
      // The snapshot query outlived the budget — typically a slow wrapper or a
      // stalled mise backend. Transient: retry on the short failure TTL rather
      // than declaring rtk absent for a full minute (#21599).
      logger.warn(
        `rtk snapshot probe timed out after ${Date.now() - startedAt}ms (slow wrapper?); command rewrite disabled this cycle, retrying soon`
      )
      return { execution: null, transient: true }
    }
    if (snapshot.availability.source === 'none') {
      logger.warn('rtk binary not found; command rewrite disabled until RTK is installed from Settings → Plugins')
      return { execution: null, transient: false }
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
      return { execution: null, transient: false }
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
      timeout: PROBE_EXEC_TIMEOUT_MS
    })
    const match = stdout.match(/(\d+\.\d+\.\d+)/)
    if (match) {
      const version = match[1]
      if (!semverGte(version, RTK_MIN_VERSION)) {
        logger.warn(`rtk version too old (need >= ${RTK_MIN_VERSION})`, { version })
        return { execution: null, transient: false }
      }
      logger.info('rtk available', { version, path: execution.path })
    }
    return { execution, transient: false }
  } catch (error) {
    // A version exec through a slow wrapper can outlive shorter budgets — same
    // transient class as a snapshot-query timeout.
    logger.warn('Failed to probe rtk', {
      error: error instanceof Error ? error.message : String(error)
    })
    return { execution: null, transient: true }
  }
}

async function getRtkExecution(): Promise<RtkExecution | null> {
  if (cachedProbe && Date.now() - cachedProbe.checkedAt < cachedProbe.ttl) return cachedProbe.execution
  if (!probePromise) {
    probePromise = probeRtk()
      .then((outcome) => {
        cachedProbe = {
          checkedAt: Date.now(),
          ttl: outcome.transient ? RTK_PROBE_FAILURE_TTL_MS : RTK_PROBE_TTL_MS,
          execution: outcome.execution
        }
        return outcome.execution
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
