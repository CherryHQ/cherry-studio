import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isPortable } from '@main/core/platform'
import { getAppEdition } from '@main/utils/appEdition'
import {
  DOCTOR_CHECK_CATALOG,
  DOCTOR_REPORT_TTL_MS,
  type DoctorBasics,
  type DoctorCancelResult,
  type DoctorCheckId,
  type DoctorCheckResult,
  type DoctorCheckStatus,
  type DoctorFixableCheckId,
  type DoctorFixId,
  type DoctorFixRequest,
  type DoctorFixResult,
  type DoctorReport,
  type DoctorRunResult,
  type DoctorRunTier,
  type DoctorState,
  type DoctorTier
} from '@shared/types/doctor'

import { collectDiagnosticSystemInfo } from '../systemInfo'
import type { DiagnosticWarning } from '../types'
import { type EngineCheck, runDoctorChecks } from './engine'
import { doctorCheckRegistry } from './registry'
import type { DoctorCheckDefinition, DoctorContext, DoctorFixOutcome, DoctorProbeOutcome } from './types'

const DEFAULT_TIMEOUT_MS: Record<DoctorTier, number> = { quick: 1000, live: 15000, deep: 60000 }
const LANE_LIMITS = { live: 3 }
const TIERS_FOR_RUN: Record<DoctorRunTier, readonly DoctorTier[]> = { quick: ['quick'], live: ['quick', 'live'] }

type DoctorEngineCheck = EngineCheck<DoctorCheckId, DoctorProbeOutcome<DoctorCheckId>>
/** Probes shared between the checks of one run (`DoctorContext.share`); the first caller's signal drives them. */
type RunMemo = Map<string, Promise<unknown>>

function runContext(signal: AbortSignal, memo: RunMemo): DoctorContext {
  return {
    signal,
    share: (key, factory) => {
      let shared = memo.get(key)
      if (!shared) {
        shared = factory(signal)
        memo.set(key, shared)
      }
      return shared as ReturnType<typeof factory>
    }
  }
}

function toEngineCheck(id: DoctorCheckId, memo: RunMemo): DoctorEngineCheck {
  const meta = DOCTOR_CHECK_CATALOG[id]
  // The registry is keyed by Id so this lookup is exhaustive; widen once for the engine.
  const definition = doctorCheckRegistry[id] as DoctorCheckDefinition<DoctorCheckId>
  return {
    id,
    requires: meta.requires,
    timeoutMs: definition.timeoutMs ?? DEFAULT_TIMEOUT_MS[meta.tier],
    lane: meta.tier,
    run: (signal) => definition.run(runContext(signal, memo))
  }
}

/** The registry type guarantees every catalog-declared fix has a handler, so no cast is needed. */
function fixHandler<Id extends DoctorFixableCheckId>(checkId: Id, fixId: DoctorFixId<Id>) {
  const definition: DoctorCheckDefinition<Id> = doctorCheckRegistry[checkId]
  return definition.fixes[fixId]
}

/**
 * Closes a selection over `requires`. The engine rejects a selection that omits a prerequisite,
 * and a check cannot be judged without the layer below it, so a prerequisite always runs.
 */
function withPrerequisites(ids: readonly DoctorCheckId[]): DoctorCheckId[] {
  const selected = new Set<DoctorCheckId>()
  const visit = (id: DoctorCheckId) => {
    if (selected.has(id)) return
    selected.add(id)
    for (const required of DOCTOR_CHECK_CATALOG[id].requires) visit(required)
  }
  for (const id of ids) visit(id)
  return [...selected]
}

function summarize(results: readonly DoctorCheckResult[]): Record<DoctorCheckStatus, number> {
  const summary: Record<DoctorCheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 }
  for (const result of results) summary[result.status] += 1
  return summary
}

function offersFix(result: DoctorCheckResult, fixId: string): boolean {
  return (
    (result.status === 'warn' || result.status === 'fail') &&
    result.actions.some((action) => action.kind === 'fix' && action.fixId === fixId)
  )
}

/**
 * Runs checks and publishes progress + the final report on the shared cache key
 * `doctor.state`, so every window renders the same run and the report dies with the
 * process (it is time-bound anyway, see `DOCTOR_REPORT_TTL_MS`).
 */
@Injectable('DoctorService')
@ServicePhase(Phase.WhenReady)
export class DoctorService extends BaseService {
  private activeRun: { readonly runId: string; readonly controller: AbortController } | null = null

  /** Runs never coexist: a second call while one is in flight gets `busy` with the id it may cancel. */
  async run(input: { tier: DoctorRunTier; checkIds?: readonly DoctorCheckId[] }): Promise<DoctorRunResult> {
    if (this.activeRun) return { status: 'busy', runId: this.activeRun.runId }
    const runId = randomUUID()
    const controller = new AbortController()
    this.activeRun = { runId, controller }
    const startedAt = new Date()
    try {
      const tiers = TIERS_FOR_RUN[input.tier]
      const ids = (input.checkIds ?? Object.keys(DOCTOR_CHECK_CATALOG)).filter((id): id is DoctorCheckId =>
        tiers.includes(DOCTOR_CHECK_CATALOG[id as DoctorCheckId].tier)
      )
      const running: DoctorState = {
        status: 'running',
        runId,
        tier: input.tier,
        startedAt: startedAt.toISOString(),
        results: []
      }
      this.publish(running)
      const results = await this.execute(ids, controller.signal, (settled) =>
        this.publish({ ...running, results: settled })
      )
      if (controller.signal.aborted) {
        this.publish({ status: 'canceled', runId })
        return { status: 'canceled', runId }
      }
      const finishedAt = new Date()
      const report: DoctorReport = {
        schemaVersion: 1,
        runId,
        tier: input.tier,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        expiresAt: new Date(finishedAt.getTime() + DOCTOR_REPORT_TTL_MS).toISOString(),
        basics: await this.collectBasics(),
        results,
        summary: summarize(results)
      }
      this.publish({ status: 'completed', report })
      return { status: 'completed', report }
    } catch (error) {
      // `running` was already published; without a terminal state every window spins forever.
      this.publish({ status: 'idle' })
      throw error
    } finally {
      this.activeRun = null
    }
  }

  /** A run outlives the service otherwise, publishing onto the shared cache after teardown. */
  protected onStop(): void {
    this.activeRun?.controller.abort()
  }

  cancel(runId: string): DoctorCancelResult {
    if (!this.activeRun || this.activeRun.runId !== runId) return { status: 'not_running' }
    this.activeRun.controller.abort()
    return { status: 'canceled' }
  }

  /**
   * A fix is bound to the finding of one run. It is refused when that run was superseded or expired,
   * and again when a fresh probe no longer offers the fix — so it never acts on a stale conclusion.
   * It occupies `activeRun` for its duration, so a fix and a run can never overlap in either order.
   */
  async fix(request: DoctorFixRequest): Promise<DoctorFixResult> {
    const state = this.currentState()
    if (this.activeRun || state.status !== 'completed' || state.report.runId !== request.runId) {
      return { status: 'stale', reason: 'run_superseded' }
    }
    if (Date.parse(state.report.expiresAt) <= Date.now()) return { status: 'stale', reason: 'run_superseded' }
    const controller = new AbortController()
    this.activeRun = { runId: request.runId, controller }
    try {
      const before = await this.probeOne(request.checkId, controller.signal)
      if (!offersFix(before, request.fixId)) return { status: 'stale', reason: 'finding_changed', result: before }

      let outcome: DoctorFixOutcome
      try {
        outcome = await fixHandler(request.checkId, request.fixId)(runContext(controller.signal, new Map()))
      } catch (error) {
        outcome = { status: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
      // Re-probe so the caller renders what the fix actually achieved, not what it hoped for.
      const result = await this.probeOne(request.checkId, controller.signal)
      return outcome.status === 'failed' ? { ...outcome, result } : { status: outcome.status, result }
    } finally {
      this.activeRun = null
    }
  }

  /** `execute` also runs the check's prerequisites, so select the requested one by id, not by position. */
  private async probeOne(id: DoctorCheckId, signal: AbortSignal): Promise<DoctorCheckResult> {
    const results = await this.execute([id], signal)
    return results.find((result) => result.id === id)!
  }

  private currentState(): DoctorState {
    return application.get('CacheService').getShared('doctor.state') ?? { status: 'idle' }
  }

  private publish(state: DoctorState): void {
    application.get('CacheService').setShared('doctor.state', state)
  }

  private async execute(
    ids: readonly DoctorCheckId[],
    signal?: AbortSignal,
    onProgress?: (settled: readonly DoctorCheckResult[]) => void
  ): Promise<DoctorCheckResult[]> {
    const settled: DoctorCheckResult[] = []
    const memo: RunMemo = new Map()
    const results = (await runDoctorChecks({
      checks: withPrerequisites(ids).map((id) => toEngineCheck(id, memo)),
      signal,
      laneLimits: LANE_LIMITS,
      onResult: (result) => {
        settled.push(result as DoctorCheckResult)
        onProgress?.([...settled])
      }
    })) as DoctorCheckResult[]
    // A re-probe outside a run (fix) patches the completed report in place.
    const state = this.currentState()
    if (!onProgress && state.status === 'completed') {
      const updated = new Map(results.map((result) => [result.id, result]))
      const merged = state.report.results.map((result) => updated.get(result.id) ?? result)
      this.publish({ status: 'completed', report: { ...state.report, results: merged, summary: summarize(merged) } })
    }
    return results
  }

  private async collectBasics(): Promise<DoctorBasics> {
    const preferences = application.get('PreferenceService')
    const info = await collectDiagnosticSystemInfo(new Set<DiagnosticWarning>())
    return {
      version: info.application?.version ?? 'unknown',
      edition: getAppEdition(),
      channel: preferences.get('app.dist.test_plan.enabled') ? preferences.get('app.dist.test_plan.channel') : 'latest',
      platform: info.operatingSystem.platform,
      arch: info.operatingSystem.arch,
      osRelease: info.operatingSystem.release,
      runtime: info.runtime,
      isPackaged: info.application?.isPackaged ?? false,
      isPortable,
      userDataPath: application.getPath('app.userdata')
    }
  }
}
