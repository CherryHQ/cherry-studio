import path from 'node:path'

import { gte as semverGte, valid as semverValid } from 'semver'

import { application } from '@application'
import { loggerService } from '@logger'
import { isWin } from '@main/core/platform'
import { CommandFailedError, executeCommand } from '@main/utils/processRunner'
const logger = loggerService.withContext('Utils:Rtk')

const RTK_MIN_VERSION = '0.23.0'
const REWRITE_TIMEOUT_MS = 10_000
const PROBE_TIMEOUT_MS = 10_000
const PROBE_EXEC_TIMEOUT_MS = 10_000
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

async function probeRtk(): Promise<ProbeOutcome> {
  let phase = 'shim_check'
  let startedAt = performance.now()
  try {
    const controller = new AbortController()
    const resolution = await application.get('BinaryManager').resolveToolExecution('rtk', {
      signal: controller.signal,
      deadline: startedAt + PROBE_TIMEOUT_MS
    })
    if (resolution.status === 'failed') {
      logger.warn(`rtk probe failed at ${resolution.phase}`, {
        tool: 'rtk',
        phase: resolution.phase,
        reason: resolution.reason,
        elapsedMs: resolution.elapsedMs,
        stepElapsedMs: resolution.stepElapsedMs,
        stepBudgetMs: resolution.stepBudgetMs,
        budgetMs: PROBE_TIMEOUT_MS,
        transient: true,
        error: 'Tool execution resolution failed'
      })
      return { execution: null, transient: true }
    }
    if (resolution.status === 'unavailable') {
      logger.warn('rtk binary not found; command rewrite disabled until RTK is installed from Settings → Plugins')
      return { execution: null, transient: false }
    }

    phase = 'version'
    startedAt = performance.now()
    const rejectVersion = (reason: string): ProbeOutcome => {
      logger.warn('rtk probe failed at version', {
        tool: 'rtk',
        phase,
        reason,
        elapsedMs: performance.now() - startedAt,
        budgetMs: PROBE_EXEC_TIMEOUT_MS,
        transient: false,
        error: 'RTK version validation failed'
      })
      return { execution: null, transient: false }
    }
    const pathApi = isWin ? path.win32 : path.posix
    if (
      [resolution.path, resolution.resolvedPath].some((candidate) =>
        ['.cmd', '.bat'].includes(pathApi.extname(candidate).toLowerCase())
      )
    )
      return rejectVersion('batch_wrapper')

    const execution: RtkExecution = { path: resolution.path, env: resolution.env }
    const stdout = await executeCommand(execution.path, ['--version'], {
      capture: true,
      env: execution.env,
      timeout: PROBE_EXEC_TIMEOUT_MS
    })
    const token = stdout.trim().replace(/^rtk\s+/, '')
    const version = semverValid(token)
    if (!version) return rejectVersion('malformed_version')
    if (!semverGte(version, RTK_MIN_VERSION)) return rejectVersion('unsupported_version')
    logger.info('rtk available', { version, path: execution.path })
    return { execution, transient: false }
  } catch {
    const elapsedMs = performance.now() - startedAt
    const budgetMs = phase === 'version' ? PROBE_EXEC_TIMEOUT_MS : PROBE_TIMEOUT_MS
    logger.warn(`rtk probe failed at ${phase}`, {
      tool: 'rtk',
      phase,
      reason: elapsedMs >= budgetMs ? 'timeout' : 'query_failed',
      elapsedMs,
      stepElapsedMs: elapsedMs,
      stepBudgetMs: budgetMs,
      budgetMs,
      transient: true,
      error: 'RTK probe execution failed'
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
