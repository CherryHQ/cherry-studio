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

function summarize(results: readonly DoctorCheckResult[]): Record<DoctorCheckStatus, number> {
  const summary: Record<DoctorCheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0, error: 0 }
  for (const result of results) summary[result.status] += 1
  return summary
}

function offersFix(result: DoctorCheckResult, fixId: string, target?: string): boolean {
  if (result.status !== 'warn' && result.status !== 'fail') return false
  return result.actions.some((action) => action.kind === 'fix' && action.fixId === fixId && action.target === target)
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
  private allReady = false

  protected override onAllReady(): void {
    this.allReady = true
  }

  private selectChecks(ids: readonly DoctorCheckId[], tier: DoctorRunTier): DoctorCheckId[] {
    const selected = new Set<DoctorCheckId>()
    const visit = (id: DoctorCheckId): void => {
      if (selected.has(id)) return
      const meta = DOCTOR_CHECK_CATALOG[id]
      if (!meta || !TIERS_FOR_RUN[tier].includes(meta.tier))
        throw new Error(`Check ${id} is unavailable in tier ${tier}`)
      selected.add(id)
      for (const dependency of meta.requires) visit(dependency)
    }
    ids.forEach(visit)
    return [...selected]
  }

  /** Runs never coexist: a second call while one is in flight gets `busy` with the id it may cancel. */
  async run(input: { tier: DoctorRunTier; checkIds?: readonly DoctorCheckId[] }): Promise<DoctorRunResult> {
    if (!this.allReady) throw new Error('Doctor is not ready')
    if (this.activeRun) return { status: 'busy', runId: this.activeRun.runId }
    const ids = this.selectChecks(
      input.checkIds ??
        (Object.keys(DOCTOR_CHECK_CATALOG) as DoctorCheckId[]).filter((id) =>
          TIERS_FOR_RUN[input.tier].includes(DOCTOR_CHECK_CATALOG[id].tier)
        ),
      input.tier
    )
    const runId = randomUUID()
    const controller = new AbortController()
    this.activeRun = { runId, controller }
    const startedAt = new Date()
    try {
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
      const basics = await this.collectBasics()
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
        basics,
        results,
        summary: summarize(results)
      }
      this.publish({ status: 'completed', report })
      return { status: 'completed', report }
    } catch (error) {
      this.publish({ status: 'canceled', runId })
      throw error
    } finally {
      this.activeRun = null
    }
  }

  cancel(runId: string): DoctorCancelResult {
    if (!this.activeRun || this.activeRun.runId !== runId) return { status: 'not_running' }
    this.activeRun.controller.abort()
    return { status: 'canceled' }
  }

  /**
   * A fix is bound to the finding of one run. It is refused when that run was superseded,
   * and again when a fresh probe no longer offers the fix — so it never acts on a stale conclusion.
   */
  async fix(request: DoctorFixRequest): Promise<DoctorFixResult> {
    if (!this.allReady) throw new Error('Doctor is not ready')
    if (this.activeRun) throw new Error('Doctor is busy')
    const stale = this.validateFix(request)
    if (stale) return stale
    const controller = new AbortController()
    this.activeRun = { runId: request.runId, controller }
    try {
      const state = this.currentState()
      if (state.status !== 'completed') return { status: 'stale', reason: 'run_superseded' }
      const ids = this.selectChecks([request.checkId], state.report.tier)
      const probe = async () => {
        const results = await this.execute(ids, controller.signal)
        const result = results.find((item) => item.id === request.checkId)
        if (!result) throw new Error(`Missing result for ${request.checkId}`)
        return { results, result }
      }
      const before = await probe()
      const changed = this.validateFix(request)
      if (changed) return changed
      this.patchReport(request.runId, before.results)
      if (!offersFix(before.result, request.fixId, request.target)) {
        return { status: 'stale', reason: 'finding_changed', result: before.result }
      }
      controller.signal.throwIfAborted()
      let outcome: DoctorFixOutcome
      try {
        const context = runContext(controller.signal, new Map())
        outcome =
          request.checkId === 'mcp-servers-connected'
            ? await doctorCheckRegistry[request.checkId].fixes[request.fixId]({ ...context, target: request.target })
            : await doctorCheckRegistry[request.checkId].fixes[request.fixId](context)
      } catch (error) {
        outcome = { status: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
      const after = await probe()
      this.patchReport(request.runId, after.results)
      return outcome.status === 'failed'
        ? { ...outcome, result: after.result }
        : { status: outcome.status, result: after.result }
    } finally {
      this.activeRun = null
    }
  }

  private validateFix(request: DoctorFixRequest): DoctorFixResult | undefined {
    const state = this.currentState()
    if (state.status !== 'completed' || state.report.runId !== request.runId)
      return { status: 'stale', reason: 'run_superseded' }
    if (!(Date.parse(state.report.expiresAt) > Date.now())) return { status: 'stale', reason: 'report_expired' }
    const finding = state.report.results.find((item) => item.id === request.checkId)
    if (!finding || !offersFix(finding, request.fixId, request.target))
      return { status: 'stale', reason: 'finding_changed' }
    return undefined
  }

  private patchReport(runId: string, results: readonly DoctorCheckResult[]): void {
    const state = this.currentState()
    if (state.status !== 'completed' || state.report.runId !== runId) return
    const updated = new Map(results.map((result) => [result.id, result]))
    const merged = state.report.results.map((result) => updated.get(result.id) ?? result)
    this.publish({ status: 'completed', report: { ...state.report, results: merged, summary: summarize(merged) } })
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
      checks: ids.map((id) => toEngineCheck(id, memo)),
      signal,
      laneLimits: LANE_LIMITS,
      onResult: (result) => {
        settled.push(result as DoctorCheckResult)
        onProgress?.([...settled])
      }
    })) as DoctorCheckResult[]
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
