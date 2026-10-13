import path from 'node:path'

import { gte as semverGte } from 'semver'

import { application } from '@application'
import { loggerService } from '@logger'
import { getBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { executeCommand } from '@main/utils/processRunner'
import { getRawShellEnv } from '@main/utils/shellEnv'
const logger = loggerService.withContext('Utils:Rtk')

const RTK_MIN_VERSION = '0.23.0'
const REWRITE_TIMEOUT_MS = 3000
// Keep the Bash hook's wait short while allowing slow wrappers to finish in the background.
// A hung backend still needs a ceiling so availability can be retried.
const PROBE_INLINE_WAIT_MS = 3000
const PROBE_TOTAL_BUDGET_MS = 30_000
const PROBE_EXEC_TIMEOUT_MS = 12_000
const RTK_PROBE_TTL_MS = 60_000
const RTK_PROBE_RETRY_MS = 5_000

interface RtkExecution {
  path: string
  env: NodeJS.ProcessEnv
}

type ProbeOutcome =
  | { kind: 'definite'; state: 'absent'; execution: null }
  | { kind: 'definite'; state: 'batch'; execution: null; path: string }
  | { kind: 'definite'; state: 'old'; execution: null; version: string }
  | { kind: 'definite'; state: 'available'; execution: RtkExecution; version?: string }
  | { kind: 'indeterminate'; reason: 'budget' | 'error'; error?: string }

let cachedProbe: { checkedAt: number; execution: RtkExecution | null; kind: ProbeOutcome['kind'] } | null = null
let probePromise: Promise<RtkExecution | null> | null = null
let probeOutlivedInline = false

/** Resolve `promise`, or `undefined` if it does not settle within `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

async function resolveRtk(): Promise<ProbeOutcome> {
  const snapshot = (await application.get('BinaryManager').getToolSnapshots(['rtk'])).rtk
  if (snapshot.availability.source === 'none') {
    return { kind: 'definite', state: 'absent', execution: null }
  }

  // cmd.exe cannot reliably escape the model's shell command through a batch wrapper.
  // Refuse that boundary because rewrite is only an optimization.
  if (['.cmd', '.bat'].includes(path.extname(snapshot.availability.path).toLowerCase())) {
    return { kind: 'definite', state: 'batch', execution: null, path: snapshot.availability.path }
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
      return { kind: 'definite', state: 'old', execution: null, version }
    }
    return { kind: 'definite', state: 'available', execution, version }
  }
  return { kind: 'definite', state: 'available', execution }
}

async function probeRtk(): Promise<ProbeOutcome> {
  try {
    return (await withTimeout(resolveRtk(), PROBE_TOTAL_BUDGET_MS)) ?? { kind: 'indeterminate', reason: 'budget' }
  } catch (error) {
    return { kind: 'indeterminate', reason: 'error', error: error instanceof Error ? error.message : String(error) }
  }
}

function cacheOutcome(outcome: ProbeOutcome): RtkExecution | null {
  const previous = cachedProbe
  if (outcome.kind === 'definite') {
    switch (outcome.state) {
      case 'absent':
        logger.warn('rtk binary not found; command rewrite disabled until RTK is installed from Settings → Plugins')
        break
      case 'batch':
        logger.warn('rtk resolves to a batch wrapper; command rewrite disabled', { path: outcome.path })
        break
      case 'old':
        logger.warn(`rtk version too old (need >= ${RTK_MIN_VERSION})`, { version: outcome.version })
        break
      case 'available':
        if (outcome.version) logger.info('rtk available', { version: outcome.version, path: outcome.execution.path })
        break
    }
  } else {
    const logLevel = previous?.kind === 'indeterminate' ? 'debug' : 'warn'
    if (outcome.reason === 'budget') {
      logger[logLevel](
        `rtk availability probe exceeded ${PROBE_TOTAL_BUDGET_MS}ms; command rewrite skipped, retrying in ${RTK_PROBE_RETRY_MS}ms`,
        { inlineWaitMs: PROBE_INLINE_WAIT_MS }
      )
    } else {
      logger[logLevel](`rtk availability probe failed; retrying in ${RTK_PROBE_RETRY_MS}ms`, { error: outcome.error })
    }
  }
  const execution = outcome.kind === 'definite' ? outcome.execution : (previous?.execution ?? null)
  cachedProbe = { checkedAt: Date.now(), execution, kind: outcome.kind }
  return execution
}

async function getRtkExecution(): Promise<RtkExecution | null> {
  const lifetime = cachedProbe?.kind === 'indeterminate' ? RTK_PROBE_RETRY_MS : RTK_PROBE_TTL_MS
  if (cachedProbe && Date.now() - cachedProbe.checkedAt < lifetime) return cachedProbe.execution
  if (!probePromise) {
    probeOutlivedInline = false
    probePromise = probeRtk()
      .then(cacheOutcome)
      .finally(() => {
        probePromise = null
      })
  }
  if (probeOutlivedInline || cachedProbe?.kind === 'indeterminate') return cachedProbe?.execution ?? null
  const execution = await withTimeout(probePromise, PROBE_INLINE_WAIT_MS)
  if (execution !== undefined) return execution
  probeOutlivedInline = true
  return cachedProbe?.execution ?? null
}

/**
 * Rewrite a shell command using rtk for token-optimized output.
 * Returns the rewritten command, or null if no rewrite is available.
 */
export async function rtkRewrite(command: string): Promise<string | null> {
  const execution = await getRtkExecution()
  if (!execution) return null

  try {
    const stdout = await executeCommand(execution.path, ['rewrite', command], {
      capture: true,
      env: execution.env,
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
