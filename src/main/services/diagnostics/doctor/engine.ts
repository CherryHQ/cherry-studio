/**
 * Pure check runner: prerequisite layering, per-check timeout, run cancellation, skip
 * cascade, error capture. Knows nothing about the catalog or Electron so it can be
 * tested with arbitrary ids.
 */

import { setTimeout as sleep } from 'node:timers/promises'

import PQueue from 'p-queue'

export interface EngineCheck<Id extends string, Outcome> {
  readonly id: Id
  readonly requires: readonly Id[]
  readonly timeoutMs: number
  /** Checks sharing a lane are capped by `laneLimits`; others run unbounded. */
  readonly lane: string
  run(signal: AbortSignal): Promise<Outcome>
}

export type EngineResult<Id extends string, Outcome> = { readonly id: Id; readonly durationMs: number } & (
  | Outcome
  | { readonly status: 'skip'; readonly skippedBy: Id }
  | { readonly status: 'error'; readonly message: string }
)

export interface EngineOptions<Id extends string, Outcome> {
  readonly checks: readonly EngineCheck<Id, Outcome>[]
  /** Cancels the whole run: running probes are aborted, unstarted ones settle as canceled errors. */
  readonly signal?: AbortSignal
  readonly laneLimits?: Readonly<Record<string, number>>
  readonly onResult?: (result: EngineResult<Id, Outcome>) => void
  readonly now?: () => number
}

export const CANCELED_MESSAGE = 'Canceled'
const BLOCKING_STATUSES: ReadonlySet<string> = new Set(['fail', 'error', 'skip'])

export class DoctorEngineError extends Error {}

/** Kahn layering over `requires`, restricted to the selected checks. Throws on cycles or unknown ids. */
function layer<Id extends string, Outcome>(checks: readonly EngineCheck<Id, Outcome>[]): EngineCheck<Id, Outcome>[][] {
  const byId = new Map(checks.map((check) => [check.id, check]))
  const remaining = new Map(checks.map((check) => [check.id, check.requires.filter((dep) => byId.has(dep))]))
  for (const check of checks) {
    for (const dep of check.requires) {
      if (!byId.has(dep)) throw new DoctorEngineError(`Check "${check.id}" requires unknown check "${dep}"`)
    }
  }
  const layers: EngineCheck<Id, Outcome>[][] = []
  while (remaining.size > 0) {
    const ready = [...remaining].filter(([, deps]) => deps.length === 0).map(([id]) => id)
    if (ready.length === 0)
      throw new DoctorEngineError(`Cycle in check prerequisites: ${[...remaining.keys()].join(', ')}`)
    layers.push(ready.map((id) => byId.get(id)!))
    for (const id of ready) remaining.delete(id)
    for (const [id, deps] of remaining)
      remaining.set(
        id,
        deps.filter((dep) => !ready.includes(dep))
      )
  }
  return layers
}

async function probe<Outcome>(
  check: EngineCheck<string, Outcome>,
  runSignal: AbortSignal | undefined,
  now: () => number
): Promise<{ durationMs: number } & (Outcome | { status: 'error'; message: string })> {
  const started = now()
  const timeout = AbortSignal.timeout(check.timeoutMs)
  const signal = runSignal ? AbortSignal.any([runSignal, timeout]) : timeout
  const deadlineController = new AbortController()
  // The sleep rejects on cancel and resolves on timeout, so a probe that ignores its signal still settles.
  const deadline = sleep(check.timeoutMs, undefined, {
    signal: runSignal ? AbortSignal.any([runSignal, deadlineController.signal]) : deadlineController.signal
  }).then(() => {
    throw new Error(`Timed out after ${check.timeoutMs}ms`)
  })
  try {
    const outcome = await Promise.race([check.run(signal), deadline])
    return { ...outcome, durationMs: now() - started }
  } catch (error) {
    // Whatever the probe threw while aborted, the cause the caller needs is the abort reason.
    const message = runSignal?.aborted
      ? CANCELED_MESSAGE
      : timeout.aborted
        ? `Timed out after ${check.timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error)
    return { status: 'error', message, durationMs: now() - started }
  } finally {
    deadlineController.abort()
  }
}

export async function runDoctorChecks<Id extends string, Outcome extends { readonly status: string }>(
  options: EngineOptions<Id, Outcome>
): Promise<EngineResult<Id, Outcome>[]> {
  const now = options.now ?? (() => performance.now())
  const lanes = new Map(
    Object.entries(options.laneLimits ?? {}).map(([name, concurrency]) => [name, new PQueue({ concurrency })])
  )
  const results = new Map<Id, EngineResult<Id, Outcome>>()

  const settle = (result: EngineResult<Id, Outcome>) => {
    results.set(result.id, result)
    options.onResult?.(result)
  }

  for (const checks of layer(options.checks)) {
    await Promise.all(
      checks.map(async (check) => {
        const blocker = check.requires.find((dep) => BLOCKING_STATUSES.has(results.get(dep)?.status ?? ''))
        if (blocker !== undefined) {
          settle({ id: check.id, status: 'skip', skippedBy: blocker, durationMs: 0 })
          return
        }
        if (options.signal?.aborted) {
          settle({ id: check.id, status: 'error', message: CANCELED_MESSAGE, durationMs: 0 })
          return
        }
        const lane = lanes.get(check.lane)
        const run = () => probe(check, options.signal, now)
        settle({ id: check.id, ...(lane ? await lane.add(run, { throwOnTimeout: true }) : await run()) })
      })
    )
  }
  // Preserve the caller's order so the report reads like the catalog.
  return options.checks.map((check) => results.get(check.id)!)
}
