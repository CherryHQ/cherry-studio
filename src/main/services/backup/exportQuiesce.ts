import { performance } from 'node:perf_hooks'

import { application } from '@application'
import { loggerService } from '@logger'
import type { Disposable } from '@main/core/lifecycle'

import { BackupCancelledError, BackupQuiesceError } from './errors'

const logger = loggerService.withContext('backup/exportQuiesce')
export const EXPORT_SEAL_DEADLINE_MS = 30_000
const EXPORT_QUIESCE_REASON = 'backup export: seal database and resource baseline'

interface DrainVerdict {
  readonly stragglerIds: readonly string[]
  readonly startupRecoveryPending?: boolean
}

interface NamedDrain {
  readonly name: string
  readonly drain: (timeoutMs: number) => Promise<DrainVerdict>
}

export interface SealedProfileView<Snapshot, Baseline> {
  readonly snapshot: Snapshot
  readonly baseline: Baseline
}

export interface CaptureSealedProfileViewInputs<Snapshot, Baseline> {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  /**
   * Synchronous by contract: `VACUUM INTO` cannot be interrupted. The
   * coordinator checks cancellation/deadline immediately after it returns.
   */
  readonly createSnapshot: () => void
  readonly inspectSnapshot: () => Snapshot | Promise<Snapshot>
  readonly captureBaseline: (snapshot: Snapshot, signal: AbortSignal) => Baseline | Promise<Baseline>
}

export interface AcquireProfileQuiescenceInputs {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly reason: string
}

/**
 * A fully drained profile writer boundary. The owner must either dispose it in
 * reverse order or hand process lifetime to exit without reopening writer
 * admission.
 */
export interface ProfileQuiescenceHold extends Disposable {
  readonly signal: AbortSignal
  checkpoint(phase: string): void
  waitFor<T>(work: Promise<T>, phase: string): Promise<T>
}

function disposeReverse(holds: readonly Disposable[]): Error[] {
  const errors: Error[] = []
  for (let index = holds.length - 1; index >= 0; index--) {
    try {
      holds[index].dispose()
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
  }
  return errors
}

/**
 * Pause and drain all known profile writer owners. This is intentionally a
 * fixed private orchestration list: adding a lifecycle service never silently
 * grants it backup or restore participation.
 */
export async function acquireProfileQuiescence(inputs: AcquireProfileQuiescenceInputs): Promise<ProfileQuiescenceHold> {
  const timeoutMs = inputs.timeoutMs ?? EXPORT_SEAL_DEADLINE_MS
  const deadline = performance.now() + timeoutMs
  const quiesceController = new AbortController()
  const onExternalAbort = (): void => quiesceController.abort()
  inputs.signal?.addEventListener('abort', onExternalAbort, { once: true })
  const deadlineTimer = setTimeout(() => quiesceController.abort(), Math.max(0, timeoutMs))
  deadlineTimer.unref()

  const abortError = (phase: string): Error => {
    if (inputs.signal?.aborted) return new BackupCancelledError('backup operation cancelled')
    return new BackupQuiesceError(phase)
  }
  const checkpoint = (phase: string): void => {
    if (inputs.signal?.aborted) throw new BackupCancelledError('backup operation cancelled')
    if (performance.now() >= deadline) throw new BackupQuiesceError(phase)
  }
  const remaining = (phase: string): number => {
    checkpoint(phase)
    return Math.max(1, Math.ceil(deadline - performance.now()))
  }
  const waitAbortably = async <T>(work: Promise<T>, phase: string): Promise<T> => {
    if (quiesceController.signal.aborted) throw abortError(phase)
    let removeAbortListener = (): void => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => reject(abortError(phase))
      quiesceController.signal.addEventListener('abort', onAbort, { once: true })
      removeAbortListener = () => quiesceController.signal.removeEventListener('abort', onAbort)
    })
    try {
      return await Promise.race([work, aborted])
    } finally {
      removeAbortListener()
    }
  }
  const drainGroup = async (phase: string, drains: readonly NamedDrain[]): Promise<void> => {
    const budget = remaining(phase)
    const settled = await waitAbortably(
      Promise.allSettled(drains.map(({ drain }) => Promise.resolve().then(() => drain(budget)))),
      phase
    )
    const stragglers: string[] = []
    for (let index = 0; index < settled.length; index++) {
      const result = settled[index]
      const name = drains[index].name
      if (result.status === 'rejected') {
        logger.warn('Backup writer drain failed', result.reason as Error, { phase, participant: name })
        stragglers.push(`${name}:drain-error`)
        continue
      }
      stragglers.push(...result.value.stragglerIds.map((id) => `${name}:${id}`))
      if (result.value.startupRecoveryPending) stragglers.push(`${name}:startup-recovery`)
    }
    if (stragglers.length > 0) {
      logger.warn('Backup writer drain did not reach a clean verdict', { phase, stragglerIds: stragglers })
      throw new BackupQuiesceError(phase, stragglers)
    }
    checkpoint(phase)
  }

  const channel = application.get('ChannelManager')
  const ai = application.get('AiStreamManager')
  const agent = application.get('AgentSessionRuntimeService')
  const jobs = application.get('JobManager')
  const warmQuery = application.get('ClaudeCodeWarmQueryManager')
  const profileWrites = application.get('ProfileWriteBarrierService')
  const mcp = application.get('McpRuntimeService')

  const holds: Disposable[] = []
  let disposed = false
  const clearDeadline = (): void => {
    clearTimeout(deadlineTimer)
    inputs.signal?.removeEventListener('abort', onExternalAbort)
  }

  try {
    checkpoint('preparing')

    // Intake is a separate phase: pausing it flushes the acknowledged debounce
    // buffer. Those admissions must land before the AI gate closes.
    holds.push(channel.pause(inputs.reason))
    await drainGroup('channel-intake', [
      { name: 'channel-intake', drain: (budget) => channel.drainInFlight({ timeoutMs: budget }) }
    ])

    // Parent runtimes close before the shared write barrier, otherwise a
    // grandfathered parent could block while trying to acquire a downstream
    // profile-write lease that backup has already closed.
    holds.push(channel.pauseAdapterRuntime(inputs.reason))
    holds.push(ai.pause(inputs.reason))
    holds.push(agent.pause(inputs.reason))
    holds.push(jobs.pause(inputs.reason))
    holds.push(warmQuery.pause(inputs.reason))
    await drainGroup('writer-runtimes', [
      {
        name: 'channel-runtime',
        drain: (budget) => channel.drainAdapterRuntimeInFlight({ timeoutMs: budget })
      },
      { name: 'ai', drain: (budget) => ai.drainInFlight({ timeoutMs: budget }) },
      { name: 'agent', drain: (budget) => agent.drainInFlight({ timeoutMs: budget }) },
      { name: 'job', drain: (budget) => jobs.drainInFlight({ timeoutMs: budget }) },
      { name: 'warm-query', drain: (budget) => warmQuery.drainInFlight({ timeoutMs: budget }) }
    ])

    holds.push(profileWrites.pause(inputs.reason))
    await drainGroup('profile-write-barrier', [
      { name: 'profile-write', drain: (budget) => profileWrites.drainInFlight({ timeoutMs: budget }) }
    ])

    // MCP is downstream of agent/AI and of direct profile writers, so it is
    // closed last and released first.
    holds.push(mcp.pause(inputs.reason))
    await drainGroup('mcp-runtime', [{ name: 'mcp', drain: (budget) => mcp.drainInFlight({ timeoutMs: budget }) }])

    return {
      signal: quiesceController.signal,
      checkpoint,
      waitFor: waitAbortably,
      dispose(): void {
        if (disposed) return
        disposed = true
        clearDeadline()
        const releaseErrors = disposeReverse(holds)
        if (releaseErrors.length === 0) return
        logger.error('Profile writer holds did not all release', {
          count: releaseErrors.length,
          errors: releaseErrors.map((error) => error.message)
        })
        throw new BackupQuiesceError('release')
      }
    }
  } catch (error) {
    const releaseErrors = disposeReverse(holds)
    if (releaseErrors.length > 0) {
      logger.error('Profile writer holds did not all release after quiesce failed', {
        count: releaseErrors.length,
        errors: releaseErrors.map((error) => error.message)
      })
    }
    clearDeadline()
    throw error
  }
}

/**
 * Freeze all writer owners long enough to produce one DB/filesystem boundary,
 * then always reopen admission after snapshot and baseline capture finish.
 */
export async function captureSealedProfileView<Snapshot, Baseline>(
  inputs: CaptureSealedProfileViewInputs<Snapshot, Baseline>
): Promise<SealedProfileView<Snapshot, Baseline>> {
  const hold = await acquireProfileQuiescence({
    signal: inputs.signal,
    timeoutMs: inputs.timeoutMs,
    reason: EXPORT_QUIESCE_REASON
  })
  let result: SealedProfileView<Snapshot, Baseline> | undefined
  let failure: unknown
  try {
    inputs.createSnapshot()
    hold.checkpoint('database-snapshot')
    const snapshot = await hold.waitFor(Promise.resolve(inputs.inspectSnapshot()), 'snapshot-requirements')
    hold.checkpoint('snapshot-requirements')
    const baseline = await hold.waitFor(
      Promise.resolve(inputs.captureBaseline(snapshot, hold.signal)),
      'resource-baseline'
    )
    hold.checkpoint('resource-baseline')
    result = { snapshot, baseline }
  } catch (error) {
    failure = error
  }

  try {
    hold.dispose()
  } catch (error) {
    if (failure === undefined) failure = error
  }
  if (failure !== undefined) throw failure
  return result!
}
