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
  type DoctorCheckScope,
  type DoctorCheckStatus,
  type DoctorFixRequest,
  type DoctorFixResult,
  type DoctorReport,
  type DoctorRunResult,
  type DoctorRunTier,
  type DoctorScopeKey,
  type DoctorState,
  type DoctorSubject,
  type DoctorSubjectRef,
  type DoctorTier
} from '@shared/types/doctor'
import {
  DOCTOR_CONNECTIVITY_CHECK_IDS,
  type DoctorConnectivityResult,
  type DoctorConnectivitySubject
} from '@shared/types/doctorConnectivity'
import { doctorScopeKey, doctorStateCacheKey } from '@shared/utils/doctor'

import { collectDiagnosticSystemInfo } from '../systemInfo'
import type { DiagnosticWarning } from '../types'
import { DoctorExecution } from './execution'
import { doctorCheckRegistry } from './registry'
import type { DoctorContext, DoctorEngineDefinition, DoctorFixOutcome } from './types'

const TIERS_FOR_RUN: Record<DoctorRunTier, readonly DoctorTier[]> = { quick: ['quick'], live: ['quick', 'live'] }

/** Probes shared between the checks of one run (`DoctorContext.share`); the first caller's signal drives them. */
type RunMemo = Map<string, Promise<unknown>>
type ActiveRun = { readonly runId: string; readonly controller: AbortController }

function runContext(signal: AbortSignal, memo: RunMemo, subject: DoctorSubject | null): DoctorContext {
  return {
    signal,
    subject,
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

/** A global run takes every check; a contextual run takes those whose declared facts the subject carries. */
function applies(scope: DoctorCheckScope, subject: DoctorSubject | null): boolean {
  if (subject === null) return true
  if (typeof scope === 'string') return scope === 'any'
  return scope.every((key) => key in subject)
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
 * `doctorStateCacheKey(scope)`, so every window renders the same run and the report dies with the
 * process (it is time-bound anyway, see `DOCTOR_REPORT_TTL_MS`). Scopes are independent: a
 * chat's diagnosis never disturbs the global report, and each scope has at most one run.
 */
@Injectable('DoctorService')
@ServicePhase(Phase.WhenReady)
export class DoctorService extends BaseService {
  private readonly activeRuns = new Map<DoctorScopeKey, ActiveRun>()
  private readonly connectivityRuns = new Map<DoctorScopeKey, ActiveRun>()
  /** The facts each scope last ran with, so a fix can re-probe the same subject. */
  private readonly subjects = new Map<
    DoctorScopeKey,
    {
      runId: string
      ref: DoctorSubjectRef
      facts: DoctorSubject | null
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
    const model =
      ref.providerId && ref.modelId
        ? { providerId: ref.providerId, modelId: ref.modelId }
        : agent.model
          ? parseUniqueModelId(agent.model)
          : null
    return { agentId: ref.agentId, ...model, mcpServerIds: agent.mcps ?? [] }
  }

  private createExecution(scope: DoctorScopeKey, runId: string, ref: DoctorSubjectRef, ids: readonly DoctorCheckId[]) {
    for (const [key, record] of this.subjects) {
      if (record.expiresAt <= Date.now() && !this.activeRuns.has(key) && !this.connectivityRuns.has(key)) {
        this.subjects.delete(key)
        application.get('CacheService').deleteShared(doctorStateCacheKey(key))
      }
    }
    const facts = this.resolveSubject(ref)
    const execution = new DoctorExecution(ids, facts, () => {
      const current = this.subjects.get(scope)
      if (current?.execution !== execution || current.expiresAt <= Date.now()) return false
      try {
        return isDeepStrictEqual(this.resolveSubject(ref), facts)
      } catch (error) {
        if (isDataApiNotFoundError(error)) return false
        throw error
      }
    })
    const record = { runId, ref, facts, execution, expiresAt: Date.now() + DOCTOR_REPORT_TTL_MS }
    this.subjects.set(scope, record)
    return this.subjects.get(scope)!
  }

  async checkConnectivity(input: {
    subject: DoctorConnectivitySubject
    runId: string
  }): Promise<DoctorConnectivityResult> {
    if (!this.allReady) throw new Error('Doctor is not ready')
    const scope = doctorScopeKey(input.subject)
    const active = this.connectivityRuns.get(scope) ?? this.activeRuns.get(scope)
    if (active) return { status: 'busy', runId: active.runId }
    const subject = this.resolveSubject(input.subject)
    if (!subject?.providerId || !subject.modelId) throw new Error('No model is configured for this subject')
    const ids = this.selectChecks([...DOCTOR_CONNECTIVITY_CHECK_IDS], 'live', subject)
    const record = this.createExecution(scope, input.runId, input.subject, ids)
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
      this.subjects.delete(scope)
      if (controller.signal.aborted) return { status: 'canceled', runId: input.runId }
      throw error
    } finally {
      this.connectivityRuns.delete(scope)
    }
  }

  async confirmCheck(input: { scope: DoctorScopeKey; runId: string; requestId: string }): Promise<DoctorConfirmResult> {
    if (!this.allReady) throw new Error('Doctor is not ready')
    const { scope, runId, requestId } = input
    const record = this.subjects.get(scope)
    if (!record || record.runId !== runId || record.expiresAt <= Date.now()) return { status: 'stale' }
    if (this.connectivityRuns.has(scope) || this.activeRuns.has(scope)) return { status: 'busy' }
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
    const record = this.subjects.get(scope)
    if (record?.runId === runId && (active?.runId === runId || record.execution.snapshot().pendingChecks.length > 0)) {
      record.onResults?.({ ...record.execution.snapshot(), pendingChecks: [] })
      this.subjects.delete(scope)
      if (active?.runId === runId) active.controller.abort()
      return { status: 'canceled' }
    }
    return { status: 'not_running' }
  }

  private defaultCheckIds(tier: DoctorRunTier, subject: DoctorSubject | null): DoctorCheckId[] {
    return (Object.keys(DOCTOR_CHECK_CATALOG) as DoctorCheckId[]).filter((id) => {
      const meta = DOCTOR_CHECK_CATALOG[id]
      return !('includeByDefault' in meta) && TIERS_FOR_RUN[tier].includes(meta.tier) && applies(meta.scope, subject)
    })
  }

  private selectChecks(
    ids: readonly DoctorCheckId[],
    tier: DoctorRunTier,
    subject: DoctorSubject | null
  ): DoctorCheckId[] {
    const selected = new Set<DoctorCheckId>()
    const visit = (id: DoctorCheckId, requiredBy?: DoctorCheckId): void => {
      if (selected.has(id)) return
      const meta = DOCTOR_CHECK_CATALOG[id]
      if (!meta || !TIERS_FOR_RUN[tier].includes(meta.tier))
        throw new Error(`Check ${id} is unavailable in tier ${tier}`)
      // A prerequisite outside the subject would run with facts its `scope` promised but the run lacks.
      if (!applies(meta.scope, subject)) {
        throw new Error(
          requiredBy
            ? `Check ${requiredBy} requires ${id}, which does not apply to this subject`
            : `Check ${id} does not apply to this subject`
        )
      }
      selected.add(id)
      for (const dependency of meta.requires) visit(dependency, id)
    }
    for (const id of ids) visit(id)
    return [...selected]
  }

  /** One run per scope: a second call while one is in flight gets `busy` with the id it may cancel. */
  async run(input: {
    tier: DoctorRunTier
    subject: DoctorSubjectRef
    checkIds?: readonly DoctorCheckId[]
  }): Promise<DoctorRunResult> {
    if (!this.allReady) throw new Error('Doctor is not ready')
    const subject = this.resolveSubject(input.subject)
    const ids = this.selectChecks(input.checkIds ?? this.defaultCheckIds(input.tier, subject), input.tier, subject)
    return this.runSelected(input.subject, input.tier, ids)
  }

  /** Runs the contextual quick checks plus only the connectivity checks applicable to the resolved subject. */
  async runContextualDiagnosis(subjectRef: DoctorConnectivitySubject): Promise<DoctorRunResult> {
    if (!this.allReady) throw new Error('Doctor is not ready')
    const subject = this.resolveSubject(subjectRef)
    const contextualIds = DOCTOR_CONNECTIVITY_CHECK_IDS.filter((id) => applies(DOCTOR_CHECK_CATALOG[id].scope, subject))
    const ids = this.selectChecks([...this.defaultCheckIds('quick', subject), ...contextualIds], 'live', subject)
    return this.runSelected(subjectRef, 'live', ids)
  }

  private async runSelected(
    subjectRef: DoctorSubjectRef,
    tier: DoctorRunTier,
    ids: readonly DoctorCheckId[]
  ): Promise<DoctorRunResult> {
    const scope = doctorScopeKey(subjectRef)
    const active = this.activeRuns.get(scope) ?? this.connectivityRuns.get(scope)
    if (active) return { status: 'busy', runId: active.runId }
    const runId = randomUUID()
    const controller = new AbortController()
    this.activeRuns.set(scope, { runId, controller })
    const record = this.createExecution(scope, runId, subjectRef, ids)
    const startedAt = new Date()
    try {
      const running: DoctorState = {
        status: 'running',
        runId,
        tier,
        selectedCheckIds: ids,
        startedAt: startedAt.toISOString(),
        results: [],
        activeCheckIds: []
      }
      this.publish(scope, running)
      const { results, pendingChecks } = await record.execution.execute(controller.signal, (results, activeCheckIds) =>
        this.publish(scope, { ...running, results, activeCheckIds })
      )
      if (controller.signal.aborted) {
        this.subjects.delete(scope)
        this.publish(scope, { status: 'canceled', runId, selectedCheckIds: ids })
        return { status: 'canceled', runId }
      }
      const basics = await this.collectBasics()
      if (controller.signal.aborted) {
        this.subjects.delete(scope)
        this.publish(scope, { status: 'canceled', runId, selectedCheckIds: ids })
        return { status: 'canceled', runId }
      }
      const finishedAt = new Date()
      const report: DoctorReport = {
        schemaVersion: 1,
        runId,
        scope,
        tier,
        selectedCheckIds: ids,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        expiresAt: new Date(finishedAt.getTime() + DOCTOR_REPORT_TTL_MS).toISOString(),
        basics,
        results,
        ...(pendingChecks.length ? { pendingChecks } : {}),
        summary: summarize(results)
      }
      record.expiresAt = Date.parse(report.expiresAt)
      record.onResults = (snapshot) => this.patchReport(scope, runId, snapshot.results, snapshot.pendingChecks)
      this.publish(scope, { status: 'completed', report })
      return { status: 'completed', report }
    } catch (error) {
      // `running` was already published; without a terminal state every window spins forever.
      this.subjects.delete(scope)
      this.publish(scope, { status: 'failed', runId, selectedCheckIds: ids })
      throw error
    } finally {
      this.activeRuns.delete(scope)
    }
  }

  /** A run outlives the service otherwise, publishing onto the shared cache after teardown. */
  protected onStop(): void {
    this.allReady = false
    for (const { controller } of this.activeRuns.values()) controller.abort()
    for (const { controller } of this.connectivityRuns.values()) controller.abort()
    this.subjects.clear()
  }

  cancel(scope: DoctorScopeKey, runId: string): DoctorCancelResult {
    const active = this.activeRuns.get(scope)
    if (!active || active.runId !== runId) {
      return this.connectivityRuns.get(scope)?.runId === runId
        ? this.cancelConnectivity(scope, runId)
        : { status: 'not_running' }
    }
    active.controller.abort()
    this.subjects.delete(scope)
    return { status: 'canceled' }
  }

  /**
   * A fix is bound to the finding of one run. It is refused when that run was superseded or expired,
   * and again when a fresh probe no longer offers the fix — so it never acts on a stale conclusion.
   * It occupies the scope's active slot for its duration, so a fix and a run never overlap in either order.
   */
  async fix(request: DoctorFixRequest): Promise<DoctorFixResult> {
    if (!this.allReady) throw new Error('Doctor is not ready')
    const { scope } = request
    if (this.activeRuns.has(scope) || this.connectivityRuns.has(scope))
      return { status: 'stale', reason: 'run_superseded' }
    const stale = this.validateFix(request)
    if (stale) return stale
    const controller = new AbortController()
    this.activeRuns.set(scope, { runId: request.runId, controller })
    try {
      const state = this.currentState(scope)
      if (state.status !== 'completed') return { status: 'stale', reason: 'run_superseded' }
      const record = this.subjects.get(scope)
      if (!record || record.runId !== request.runId) return { status: 'stale', reason: 'run_superseded' }
      const subject = record.facts
      const ids = this.selectChecks([request.checkId], state.report.tier, subject)
      const probe = async () => {
        const results = await this.execute(ids, subject, controller.signal)
        const result = results.find((item) => item.id === request.checkId)
        if (!result) throw new Error(`Missing result for ${request.checkId}`)
        return { results, result }
      }
      const before = await probe()
      const changed = this.validateFix(request)
      if (changed) return changed
      this.patchReport(scope, request.runId, before.results)
      if (!offersFix(before.result, request.fixId, request.target)) {
        return { status: 'stale', reason: 'finding_changed', result: before.result }
      }
      controller.signal.throwIfAborted()
      let outcome: DoctorFixOutcome
      try {
        const context = runContext(controller.signal, new Map(), subject)
        const definition = doctorCheckRegistry[request.checkId] as unknown as DoctorEngineDefinition
        const handler = definition.fixes[request.fixId]
        if (!handler) throw new Error(`Missing fix ${request.fixId} for ${request.checkId}`)
        outcome = await handler({ ...context, ...('target' in request ? { target: request.target } : {}) })
      } catch (error) {
        outcome = { status: 'failed', message: error instanceof Error ? error.message : String(error) }
      }
      const after = await probe()
      this.patchReport(scope, request.runId, after.results)
      return outcome.status === 'failed'
        ? { ...outcome, result: after.result }
        : { status: outcome.status, result: after.result }
    } finally {
      this.activeRuns.delete(scope)
    }
  }

  private validateFix(request: DoctorFixRequest): DoctorFixResult | undefined {
    const state = this.currentState(request.scope)
    if (state.status !== 'completed' || state.report.runId !== request.runId)
      return { status: 'stale', reason: 'run_superseded' }
    if (!(Date.parse(state.report.expiresAt) > Date.now())) return { status: 'stale', reason: 'report_expired' }
    const record = this.subjects.get(request.scope)
    if (!record || record.runId !== request.runId) return { status: 'stale', reason: 'run_superseded' }
    if (!record.execution.isCurrent()) return { status: 'stale', reason: 'finding_changed' }
    const finding = state.report.results.find((item) => item.id === request.checkId)
    if (!finding || !offersFix(finding, request.fixId, request.target))
      return { status: 'stale', reason: 'finding_changed' }
    return undefined
  }

  private patchReport(
    scope: DoctorScopeKey,
    runId: string,
    results: readonly DoctorCheckResult[],
    pendingChecks?: readonly DoctorPendingCheck[]
  ): void {
    const state = this.currentState(scope)
    if (state.status !== 'completed' || state.report.runId !== runId) return
    const merged = [...new Map([...state.report.results, ...results].map((result) => [result.id, result])).values()]
    this.subjects.get(scope)?.execution.updateResults(merged)
    this.publish(scope, {
      status: 'completed',
      report: {
        ...state.report,
        results: merged,
        ...(pendingChecks ? { pendingChecks } : {}),
        summary: summarize(merged)
      }
    })
  }

  private currentState(scope: DoctorScopeKey): DoctorState {
    return application.get('CacheService').getShared(doctorStateCacheKey(scope)) ?? { status: 'idle' }
  }

  private publish(scope: DoctorScopeKey, state: DoctorState): void {
    application.get('CacheService').setShared(doctorStateCacheKey(scope), state)
  }

  private async execute(
    ids: readonly DoctorCheckId[],
    subject: DoctorSubject | null,
    signal: AbortSignal
  ): Promise<readonly DoctorCheckResult[]> {
    const snapshot = await new DoctorExecution(ids, subject, () => false).execute(signal)
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
