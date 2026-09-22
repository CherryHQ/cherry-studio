import { spawn } from 'node:child_process'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import type {
  PrometheusCheckResult,
  PrometheusCheckStatus,
  PrometheusDoctorReport,
  PrometheusFixOutcome,
  PrometheusFixStatus
} from '@shared/types/prometheus'

const logger = loggerService.withContext('prometheusDoctor')

/**
 * Runs the Prometheus pack's own doctor and parses its output.
 *
 * Why spawn rather than register native checks: the-boss's `DoctorCheckRegistry` is closed over
 * `DoctorCheckId`, and `DomainOfId` requires a check's domain to equal its id prefix — there is no
 * `mini` domain, so a `mini-*` id cannot typecheck. The pack's `lib/doctor/contract.md` specifies
 * this spawn-and-parse boundary as the intended mechanism.
 *
 * The output is a cross-process interface the pack documents as stable: one JSON object per line,
 * then a summary line. Exit 0 = nothing failed, 1 = something failed, 2 = the doctor could not run.
 */

/** Guard: the pack's four statuses. Anything else means the contract drifted. */
const CHECK_STATUSES: readonly string[] = ['pass', 'warn', 'fail', 'skip']
const FIX_STATUSES: readonly string[] = ['fixed', 'requires_relaunch', 'refused']

/** Exit code the pack uses for "could not run at all", as opposed to "checks failed". */
const EXIT_COULD_NOT_RUN = 2

/** A run is abandoned past this point; a hung check must not leave the UI spinning forever. */
const RUN_TIMEOUT_MS = 60_000

type SpawnResult = { code: number | null; stdout: string; stderr: string }

function packRoot(): string {
  return application.getPath('feature.prometheus.pack.runtime')
}

/**
 * Spawn the doctor under Electron's own Node. `ELECTRON_RUN_AS_NODE` is the established pattern
 * here (see `utils/processRunner.ts`) and means no system Node install is required — which matters
 * on Windows, where one usually is not present.
 */
function runDoctor(args: readonly string[], signal?: AbortSignal): Promise<SpawnResult> {
  const root = packRoot()
  const script = path.join(root, 'scripts', 'doctor.mjs')

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      signal
    })

    let stdout = ''
    let stderr = ''
    // The pack caps its own output; this is a defence against a runaway child, not a limit
    // the contract implies.
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS)

    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/**
 * Parse the doctor's stdout into results.
 *
 * A line that is not JSON, or is JSON of the wrong shape, is skipped rather than failing the run:
 * the pack's checks are the payload, and one malformed line must not discard ten good ones. Every
 * skip is logged so a contract drift is visible rather than silent.
 */
export function parseDoctorOutput(stdout: string): PrometheusDoctorReport {
  const results: PrometheusCheckResult[] = []
  let sawSummary = false

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      logger.warn('Ignoring a non-JSON line from the Prometheus doctor')
      continue
    }

    if (typeof parsed !== 'object' || parsed === null) continue
    const record = parsed as Record<string, unknown>

    // The final line is the tally, not a check.
    if (record.summary === true) {
      sawSummary = true
      continue
    }

    if (typeof record.id !== 'string' || typeof record.title !== 'string') continue
    if (typeof record.status !== 'string' || !CHECK_STATUSES.includes(record.status)) {
      logger.warn('Ignoring a doctor line with an unrecognized status', { id: record.id })
      continue
    }

    results.push({
      id: record.id,
      title: record.title,
      status: record.status as PrometheusCheckStatus,
      summary: typeof record.summary === 'string' ? record.summary : '',
      detail: typeof record.detail === 'string' ? record.detail : undefined,
      // A fix is offered only when the check says so; the button is rendered from this.
      fixId: readFixId(record.actions)
    })
  }

  return { results, complete: sawSummary }
}

/** `actions: [{ kind: 'fix', fixId }]` — the one action kind the pack emits. */
function readFixId(actions: unknown): string | undefined {
  if (!Array.isArray(actions)) return undefined
  for (const action of actions) {
    if (typeof action !== 'object' || action === null) continue
    const record = action as Record<string, unknown>
    if (record.kind === 'fix' && typeof record.fixId === 'string') return record.fixId
  }
  return undefined
}

/**
 * Run every check.
 *
 * Exit code 2 means the doctor itself could not run, which is NOT the same as "every check
 * failed" — nothing was learned, so reporting a clean result would be a lie. That case surfaces
 * as `available: false` and the UI says diagnostics are unavailable.
 */
export async function runPrometheusDoctor(signal?: AbortSignal): Promise<PrometheusDoctorReport> {
  try {
    const { code, stdout, stderr } = await runDoctor([], signal)

    if (code === EXIT_COULD_NOT_RUN) {
      logger.warn('The Prometheus doctor could not run', { stderr: stderr.slice(0, 500) })
      return { results: [], complete: false, available: false }
    }

    const report = parseDoctorOutput(stdout)
    if (!report.complete) {
      // No summary line: the process died partway. Partial results are still worth showing,
      // but they must not be presented as a finished run.
      logger.warn('The Prometheus doctor ended before its summary line', { code })
    }
    return { ...report, available: true }
  } catch (error) {
    if (signal?.aborted) throw error
    logger.error('Failed to run the Prometheus doctor', error as Error)
    return { results: [], complete: false, available: false }
  }
}

/**
 * Apply one fix.
 *
 * `refused` is a first-class outcome, not an error: `copy-skills` refuses on a machine where the
 * full Prometheus pack is installed, which is a deliberate decision the pack makes to avoid
 * shadowing the full pack's skills. The pack exits 1 for a refusal, so the exit code alone cannot
 * distinguish it — the status comes from the emitted line. Surfacing the refusal is required;
 * swallowing it would leave a button that silently does nothing.
 */
export async function applyPrometheusFix(fixId: string, signal?: AbortSignal): Promise<PrometheusFixOutcome> {
  try {
    const { code, stdout, stderr } = await runDoctor(['--fix', fixId], signal)

    if (code === EXIT_COULD_NOT_RUN) {
      return { status: 'failed', message: stderr.trim().split('\n')[0] ?? 'The repair could not run' }
    }

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      try {
        const record = JSON.parse(trimmed) as Record<string, unknown>
        if (typeof record.status === 'string' && FIX_STATUSES.includes(record.status)) {
          return {
            status: record.status as PrometheusFixStatus,
            message: typeof record.summary === 'string' ? record.summary : ''
          }
        }
      } catch {
        continue
      }
    }

    return { status: 'failed', message: 'The repair produced no result' }
  } catch (error) {
    if (signal?.aborted) throw error
    logger.error('Failed to apply a Prometheus fix', error as Error)
    return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}
