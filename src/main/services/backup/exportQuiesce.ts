import { performance } from 'node:perf_hooks'

import { application } from '@application'
import { loggerService } from '@logger'
import type { Disposable } from '@main/core/lifecycle'

import { BackupCancelledError, BackupQuiesceError } from './errors'

const logger = loggerService.withContext('backup/exportQuiesce')
export const EXPORT_SEAL_DEADLINE_MS = 30_000
const QUIESCE_REASON = 'backup export: seal database and resource baseline'

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
 * Freeze all known writer owners long enough to produce one DB/filesystem
 * boundary. This is intentionally a fixed private orchestration list: adding a
 * lifecycle service never silently grants it backup participation.
 */
export async function captureSealedProfileView<Snapshot, Baseline>(
  inputs: CaptureSealedProfileViewInputs<Snapshot, Baseline>
): Promise<SealedProfileView<Snapshot, Baseline>> {
  const timeoutMs = inputs.timeoutMs ?? EXPORT_SEAL_DEADLINE_MS
  const deadline = performance.now() + timeoutMs
  const captureController = new AbortController()
  const onExternalAbort = (): void => captureController.abort()
  inputs.signal?.addEventListener('abort', onExternalAbort, { once: true })
  const deadlineTimer = setTimeout(() => captureController.abort(), Math.max(0, timeoutMs))
  deadlineTimer.unref()

  const abortError = (phase: string): Error => {
    if (inputs.signal?.aborted) return new BackupCancelledError('backup export cancelled')
    return new BackupQuiesceError(phase)
  }
  const checkpoint = (phase: string): void => {
    if (inputs.signal?.aborted) throw new BackupCancelledError('backup export cancelled')
    if (performance.now() >= deadline) throw new BackupQuiesceError(phase)
  }
  const remaining = (phase: string): number => {
    checkpoint(phase)
    return Math.max(1, Math.ceil(deadline - performance.now()))
  }
  const waitAbortably = async <T>(work: Promise<T>, phase: string): Promise<T> => {
    if (captureController.signal.aborted) throw abortError(phase)
    let removeAbortListener = (): void => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => reject(abortError(phase))
      captureController.signal.addEventListener('abort', onAbort, { once: true })
      removeAbortListener = () => captureController.signal.removeEventListener('abort', onAbort)
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
  let result: SealedProfileView<Snapshot, Baseline> | undefined
  let failure: unknown
  let failed = false

  try {
    checkpoint('preparing')

    // Intake is a separate phase: pausing it flushes the acknowledged debounce
    // buffer. Those admissions must land before the AI gate closes.
    holds.push(channel.pause(QUIESCE_REASON))
    await drainGroup('channel-intake', [
      { name: 'channel-intake', drain: (budget) => channel.drainInFlight({ timeoutMs: budget }) }
    ])

    // Parent runtimes close before the shared write barrier, otherwise a
    // grandfathered parent could block while trying to acquire a downstream
    // profile-write lease that backup has already closed.
    holds.push(channel.pauseAdapterRuntime(QUIESCE_REASON))
    holds.push(ai.pause(QUIESCE_REASON))
    holds.push(agent.pause(QUIESCE_REASON))
    holds.push(jobs.pause(QUIESCE_REASON))
    holds.push(warmQuery.pause(QUIESCE_REASON))
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

    holds.push(profileWrites.pause(QUIESCE_REASON))
    await drainGroup('profile-write-barrier', [
      { name: 'profile-write', drain: (budget) => profileWrites.drainInFlight({ timeoutMs: budget }) }
    ])

    // MCP is downstream of agent/AI and of direct profile writers, so it is
    // closed last and released first.
    holds.push(mcp.pause(QUIESCE_REASON))
    await drainGroup('mcp-runtime', [{ name: 'mcp', drain: (budget) => mcp.drainInFlight({ timeoutMs: budget }) }])

    inputs.createSnapshot()
    checkpoint('database-snapshot')
    const snapshot = await waitAbortably(Promise.resolve(inputs.inspectSnapshot()), 'snapshot-requirements')
    checkpoint('snapshot-requirements')
    const baseline = await waitAbortably(
      Promise.resolve(inputs.captureBaseline(snapshot, captureController.signal)),
      'resource-baseline'
    )
    checkpoint('resource-baseline')
    result = { snapshot, baseline }
  } catch (error) {
    failed = true
    failure =
      error instanceof BackupCancelledError && !inputs.signal?.aborted && captureController.signal.aborted
        ? new BackupQuiesceError('resource-baseline')
        : error
  } finally {
    const releaseErrors = disposeReverse(holds)
    if (releaseErrors.length > 0) {
      logger.error('Backup writer holds did not all release', {
        count: releaseErrors.length,
        errors: releaseErrors.map((error) => error.message)
      })
      if (!failed) {
        failed = true
        failure = new BackupQuiesceError('release')
      }
    }
    clearTimeout(deadlineTimer)
    inputs.signal?.removeEventListener('abort', onExternalAbort)
  }

  if (failed) throw failure
  return result!
}
