import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import { application } from '@application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isPortable } from '@main/core/platform'
import { agentService } from '@main/data/services/AgentService'
import { getAppEdition } from '@main/utils/appEdition'
import { DataApiErrorFactory, isDataApiNotFoundError } from '@shared/data/api/errors'
import { createUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import {
  DOCTOR_CHECK_CATALOG,
  type DoctorConfirmResult,
  type DoctorExecutionSnapshot,
  type DoctorPendingCheck,
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
  type DoctorTier,
  type DoctorScopeKey,
  type DoctorSubject,
  type DoctorSubjectRef
} from '@shared/types/doctor'
import type { DoctorConnectivityResult, DoctorConnectivitySubject } from '@shared/types/doctorConnectivity'
import { doctorScopeKey } from '@shared/utils/doctor'

import { collectDiagnosticSystemInfo } from '../systemInfo'
import type { DiagnosticWarning } from '../types'
import { DoctorExecution } from './execution'
import { doctorCheckRegistry } from './registry'
import type { DoctorContext, DoctorFixOutcome } from './types'

const TIERS_FOR_RUN: Record<DoctorRunTier, readonly DoctorTier[]> = { quick: ['quick'], live: ['quick', 'live'] }

/** Probes shared between the checks of one run (`DoctorContext.share`); the first caller's signal drives them. */
type RunMemo = Map<string, Promise<unknown>>
type ActiveRun = { readonly runId: string; readonly controller: AbortController }

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
  private readonly connectivityRuns = new Map<DoctorScopeKey, ActiveRun>()
  private readonly executions = new Map<
    DoctorScopeKey,
    {
      runId: string
      expiresAt: number
      execution: DoctorExecution
      onResults?: (snapshot: DoctorExecutionSnapshot) => void
    }
  >()
  private allReady = false

  protected override onAllReady(): void {
    this.allReady = true
  }

  /** The renderer names a subject; only main knows how to expand it (an agent's model, its servers). */
  private resolveSubject(ref: DoctorSubjectRef): DoctorSubject | null {
    if (ref.kind === 'global') return null
    if (ref.kind === 'chat') return { providerId: ref.providerId, modelId: ref.modelId }
    const agent = agentService.getAgent(ref.agentId)
    if (!agent) throw DataApiErrorFactory.notFound('Agent', ref.agentId)
    const model = agent.model ? parseUniqueModelId(agent.model) : null
    return { agentId: ref.agentId, ...model, mcpServerIds: agent.mcps ?? [] }
  }

  private createExecution(scope: DoctorScopeKey, runId: string, ref: DoctorSubjectRef, ids: readonly DoctorCheckId[]) {
    for (const [key, record] of this.executions) {
      if (record.expiresAt <= Date.now()) this.executions.delete(key)
    }
    const facts = this.resolveSubject(ref)
    const execution = new DoctorExecution(ids, facts, () => {
      const current = this.executions.get(scope)
      if (current?.execution !== execution || current.expiresAt <= Date.now()) return false
      try {
        return isDeepStrictEqual(this.resolveSubject(ref), facts)
      } catch (error) {
        if (isDataApiNotFoundError(error)) return false
        throw error
      }
    })
    const record = { runId, execution, expiresAt: Date.now() + DOCTOR_REPORT_TTL_MS }
    this.executions.set(scope, record)
    return this.executions.get(scope)!
  }

  async checkConnectivity(input: {
    subject: DoctorConnectivitySubject
    runId: string
  }): Promise<DoctorConnectivityResult> {
    if (!this.allReady) throw new Error('Doctor is not ready')
    const scope = doctorScopeKey(input.subject)
    const active = this.connectivityRuns.get(scope)
    if (active) return { status: 'busy', runId: active.runId }
    const subject = this.resolveSubject(input.subject)
    if (!subject?.providerId || !subject.modelId) throw new Error('No model is configured for this subject')
    const record = this.createExecution(scope, input.runId, input.subject, [
      'network-model-endpoint',
      'provider-model-list',
      'provider-model-conversation'
    ])
    const controller = new AbortController()
    this.connectivityRuns.set(scope, { runId: input.runId, controller })
    try {
      const snapshot = await record.execution.execute(controller.signal)
      controller.signal.throwIfAborted()
      return {
        status: 'completed',
        runId: input.runId,
        scope,
        report: {
          uniqueModelId: createUniqueModelId(subject.providerId, subject.modelId),
          expiresAt: new Date(record.expiresAt).toISOString(),
          ...snapshot
        }
      }
    } catch (error) {
      this.executions.delete(scope)
      if (controller.signal.aborted) return { status: 'canceled', runId: input.runId }
      throw error
    } finally {
      this.connectivityRuns.delete(scope)
    }
  }

  async confirmCheck(input: { scope: DoctorScopeKey; runId: string; requestId: string }): Promise<DoctorConfirmResult> {
    if (!this.allReady) throw new Error('Doctor is not ready')
    const { scope, runId, requestId } = input
    const record = this.executions.get(scope)
    if (!record || record.runId !== runId || record.expiresAt <= Date.now()) return { status: 'stale' }
    if (this.connectivityRuns.has(scope) || (scope === 'global' && this.activeRun)) return { status: 'busy' }
    const approval = record.execution.claim(requestId)
    if (!approval) return { status: 'stale' }
    const controller = new AbortController()
    this.connectivityRuns.set(scope, { runId, controller })
    try {
      const snapshot = await record.execution.execute(controller.signal, undefined, approval)
      if (controller.signal.aborted) return { status: 'canceled' }
      record.onResults?.(snapshot)
      return { status: 'completed', scope, runId, ...snapshot }
    } finally {
      this.connectivityRuns.delete(scope)
    }
  }

  cancelConnectivity(scope: DoctorScopeKey, runId: string): DoctorCancelResult {
    const active = this.connectivityRuns.get(scope)
    const record = this.executions.get(scope)
    if (record?.runId === runId) {
      record.onResults?.({ ...record.execution.snapshot(), pendingChecks: [] })
      this.executions.delete(scope)
      if (active?.runId === runId) active.controller.abort()
      return { status: 'canceled' }
    }
    return { status: 'not_running' }
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
    const confirming = this.connectivityRuns.get('global')
    if (confirming) return { status: 'busy', runId: confirming.runId }
    const ids = this.selectChecks(
      input.checkIds ??
        (Object.keys(DOCTOR_CHECK_CATALOG) as DoctorCheckId[]).filter(
          (id) =>
            TIERS_FOR_RUN[input.tier].includes(DOCTOR_CHECK_CATALOG[id].tier) &&
            !('includeByDefault' in DOCTOR_CHECK_CATALOG[id])
        ),
      input.tier
    )
    const runId = randomUUID()
    const controller = new AbortController()
    this.activeRun = { runId, controller }
    const record = this.createExecution('global', runId, { kind: 'global' }, ids)
    const startedAt = new Date()
    try {
      const running: DoctorState = {
        status: 'running',
        runId,
        tier: input.tier,
        startedAt: startedAt.toISOString(),
        results: [],
        activeCheckIds: []
      }
      this.publish(running)
      const { results, pendingChecks } = await record.execution.execute(controller.signal, (results, activeCheckIds) =>
        this.publish({ ...running, results, activeCheckIds })
      )
      if (controller.signal.aborted) {
        this.executions.delete('global')
        this.publish({ status: 'canceled', runId })
        return { status: 'canceled', runId }
      }
      const basics = await this.collectBasics()
      if (controller.signal.aborted) {
        this.executions.delete('global')
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
        ...(pendingChecks.length ? { pendingChecks } : {}),
        summary: summarize(results)
      }
      record.expiresAt = Date.parse(report.expiresAt)
      record.onResults = (snapshot) => this.patchReport(runId, snapshot.results, snapshot.pendingChecks)
      this.publish({ status: 'completed', report })
      return { status: 'completed', report }
    } catch (error) {
      // `running` was already published; without a terminal state every window spins forever.
      this.executions.delete('global')
      this.publish({ status: 'idle' })
      throw error
    } finally {
      this.activeRun = null
    }
  }

  /** A run outlives the service otherwise, publishing onto the shared cache after teardown. */
  protected onStop(): void {
    this.allReady = false
    for (const { controller } of this.connectivityRuns.values()) controller.abort()
    this.activeRun?.controller.abort()
    this.executions.clear()
  }

  cancel(runId: string): DoctorCancelResult {
    if (!this.activeRun || this.activeRun.runId !== runId) return this.cancelConnectivity('global', runId)
    this.activeRun.controller.abort()
    this.executions.delete('global')
    return { status: 'canceled' }
  }

  /**
   * A fix is bound to the finding of one run. It is refused when that run was superseded or expired,
   * and again when a fresh probe no longer offers the fix — so it never acts on a stale conclusion.
   * It occupies `activeRun` for its duration, so a fix and a run can never overlap in either order.
   */
  async fix(request: DoctorFixRequest): Promise<DoctorFixResult> {
    if (!this.allReady) throw new Error('Doctor is not ready')
    if (this.activeRun || this.connectivityRuns.has('global')) return { status: 'stale', reason: 'run_superseded' }
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

  private patchReport(
    runId: string,
    results: readonly DoctorCheckResult[],
    pendingChecks?: readonly DoctorPendingCheck[]
  ): void {
    const state = this.currentState()
    if (state.status !== 'completed' || state.report.runId !== runId) return
    const merged = [...new Map([...state.report.results, ...results].map((result) => [result.id, result])).values()]
    this.executions.get('global')?.execution.updateResults(merged)
    this.publish({
      status: 'completed',
      report: {
        ...state.report,
        results: merged,
        ...(pendingChecks ? { pendingChecks } : {}),
        summary: summarize(merged)
      }
    })
  }

  private currentState(): DoctorState {
    return application.get('CacheService').getShared('doctor.state') ?? { status: 'idle' }
  }

  private publish(state: DoctorState): void {
    application.get('CacheService').setShared('doctor.state', state)
  }

  private async execute(ids: readonly DoctorCheckId[], signal: AbortSignal): Promise<readonly DoctorCheckResult[]> {
    const snapshot = await new DoctorExecution(ids, null, () => false).execute(signal)
    if (snapshot.pendingChecks.length) throw new Error('Check requires explicit confirmation')
    return snapshot.results
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
