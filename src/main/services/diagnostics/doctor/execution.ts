import { randomUUID } from 'node:crypto'

import { application } from '@application'
import {
  DOCTOR_CHECK_CATALOG,
  type DoctorCheckId,
  type DoctorCheckResult,
  type DoctorExecutionSnapshot,
  type DoctorPendingCheck,
  type DoctorSubject,
  type DoctorTier
} from '@shared/types/doctor'

import { runDoctorChecks } from './engine'
import { doctorCheckRegistry } from './registry'
import type { DoctorContext, DoctorEngineDefinition, DoctorPreparedConfirmation, DoctorProbeOutcome } from './types'

const TIMEOUTS: Record<DoctorTier, number> = { quick: 1000, live: 15000, deep: 60000 }

/** One run's completed work and pending decisions; DoctorService owns its lifetime and scope. */
export class DoctorExecution {
  private readonly memo = new Map<string, Promise<unknown>>()
  private results: readonly DoctorCheckResult[] = []
  private readonly pending = new Map<DoctorCheckId, DoctorPreparedConfirmation & { requestId: string }>()

  constructor(
    private readonly ids: readonly DoctorCheckId[],
    private readonly subject: DoctorSubject | null,
    private readonly isSubjectCurrent: () => boolean
  ) {
    this.memo.set(
      'provider:default-model-id',
      Promise.resolve(application.get('PreferenceService').get('chat.default_model_id'))
    )
  }

  snapshot(): DoctorExecutionSnapshot {
    const pendingChecks: DoctorPendingCheck[] = [...this.pending].map(([checkId, { requestId, confirmation }]) => ({
      checkId,
      requestId,
      confirmation
    }))
    return { results: this.results, pendingChecks }
  }

  updateResults(results: readonly DoctorCheckResult[]): void {
    this.results = results
  }

  isCurrent(): boolean {
    return this.isSubjectCurrent()
  }

  claim(requestId: string): { checkId: DoctorCheckId; isCurrent: () => boolean } | undefined {
    for (const [checkId, prepared] of this.pending) {
      if (prepared.requestId !== requestId) continue
      this.pending.delete(checkId)
      if (!this.isSubjectCurrent() || !prepared.isCurrent()) return undefined
      return { checkId, isCurrent: () => this.isSubjectCurrent() && prepared.isCurrent() }
    }
    return undefined
  }

  private context(signal: AbortSignal): DoctorContext {
    return {
      signal,
      subject: this.subject,
      share: (key, factory) => {
        let value = this.memo.get(key)
        if (!value) {
          value = factory(signal)
          this.memo.set(key, value)
        }
        return value as ReturnType<typeof factory>
      }
    }
  }

  async execute(
    signal: AbortSignal,
    onProgress?: (results: readonly DoctorCheckResult[], activeCheckIds: readonly DoctorCheckId[]) => void,
    approval?: { checkId: DoctorCheckId; isCurrent: () => boolean }
  ): Promise<DoctorExecutionSnapshot> {
    const active = new Set<DoctorCheckId>()
    const settled = new Map(this.results.map((result) => [result.id, result]))
    const definitions = new Map(
      this.ids.map((id) => [id, doctorCheckRegistry[id] as unknown as DoctorEngineDefinition])
    )
    this.results = (await runDoctorChecks<DoctorCheckId, DoctorProbeOutcome<DoctorCheckId>>({
      signal,
      initialResults: this.results,
      laneLimits: { live: 3 },
      checks: this.ids.map((id) => {
        const meta = DOCTOR_CHECK_CATALOG[id]
        const definition = definitions.get(id)!
        return {
          id,
          requires: meta.requires,
          lane: meta.tier,
          timeoutMs: definition.timeoutMs ?? TIMEOUTS[meta.tier],
          run: (signal) => {
            signal.throwIfAborted()
            if (
              'execution' in meta &&
              meta.execution === 'confirmation' &&
              (approval?.checkId !== id || !approval.isCurrent())
            ) {
              throw new Error('Check confirmation is no longer valid')
            }
            return definition.run(this.context(signal))
          }
        }
      }),
      admit: async (id) => {
        const meta = DOCTOR_CHECK_CATALOG[id]
        if (!('execution' in meta) || meta.execution !== 'confirmation' || approval?.checkId === id) {
          return { status: 'run' }
        }
        if (!this.pending.has(id)) {
          const prepared = await definitions.get(id)!.getConfirmation!(this.context(signal))
          if (!('confirmation' in prepared)) return { status: 'settled', outcome: prepared }
          this.pending.set(id, { ...prepared, requestId: randomUUID() })
        }
        return { status: 'defer' }
      },
      onStart: (id) => {
        active.add(id)
        onProgress?.([...settled.values()], [...active])
      },
      onResult: (result) => {
        active.delete(result.id)
        settled.set(result.id, result as DoctorCheckResult)
        onProgress?.([...settled.values()], [...active])
      }
    })) as DoctorCheckResult[]
    return this.snapshot()
  }
}
