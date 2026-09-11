import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isPortable } from '@main/core/platform'
import { assistantDataService } from '@main/data/services/AssistantService'
import { getAppEdition } from '@main/utils/appEdition'
import { parseUniqueModelId } from '@shared/data/types/model'
import {
  DOCTOR_CHECK_CATALOG,
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
import { doctorScopeKey } from '@shared/utils/doctor'

import { collectDiagnosticSystemInfo } from '../systemInfo'
import type { DiagnosticWarning } from '../types'
import { type EngineCheck, runDoctorChecks } from './engine'
import { doctorCheckRegistry } from './registry'
import type { DoctorContext, DoctorEngineDefinition, DoctorFixOutcome, DoctorProbeOutcome } from './types'

const DEFAULT_TIMEOUT_MS: Record<DoctorTier, number> = { quick: 1000, live: 15000, deep: 60000 }
const LANE_LIMITS = { live: 3 }
const TIERS_FOR_RUN: Record<DoctorRunTier, readonly DoctorTier[]> = { quick: ['quick'], live: ['quick', 'live'] }

type DoctorEngineCheck = EngineCheck<DoctorCheckId, DoctorProbeOutcome<DoctorCheckId>>
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

function toEngineCheck(id: DoctorCheckId, memo: RunMemo, subject: DoctorSubject | null): DoctorEngineCheck {
  const meta = DOCTOR_CHECK_CATALOG[id]
  // The registry is keyed by Id so this lookup is exhaustive; widen the `subject` narrowing once for the engine.
  const definition = doctorCheckRegistry[id] as unknown as DoctorEngineDefinition
  return {
    id,
    requires: meta.requires,
    timeoutMs: definition.timeoutMs ?? DEFAULT_TIMEOUT_MS[meta.tier],
    lane: meta.tier,
    run: (signal) => definition.run(runContext(signal, memo, subject))
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
 * `doctor.state.${scope}`, so every window renders the same run and the report dies with the
 * process (it is time-bound anyway, see `DOCTOR_REPORT_TTL_MS`). Scopes are independent: a
 * chat's diagnosis never disturbs the global report, and each scope has at most one run.
 */
@Injectable('DoctorService')
@ServicePhase(Phase.WhenReady)
export class DoctorService extends BaseService {
  private readonly activeRuns = new Map<DoctorScopeKey, ActiveRun>()
  /** The facts each scope last ran with, so a fix can re-probe the same subject. */
  private readonly subjects = new Map<DoctorScopeKey, DoctorSubject | null>()
  private allReady = false

  protected override onAllReady(): void {
    this.allReady = true
  }

  /** The renderer names a subject; only main knows how to expand it (an agent's model, its servers). */
  private resolveSubject(ref: DoctorSubjectRef | undefined): DoctorSubject | null {
    if (!ref) return null
    if (ref.kind === 'chat') return { providerId: ref.providerId, modelId: ref.modelId }
    const assistant = assistantDataService.getById(ref.agentId)
    const model = assistant.modelId ? parseUniqueModelId(assistant.modelId) : null
    return { agentId: ref.agentId, ...model, mcpServerIds: assistant.mcpServerIds }
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
    subject?: DoctorSubjectRef
    checkIds?: readonly DoctorCheckId[]
  }): Promise<DoctorRunResult> {
    if (!this.allReady) throw new Error('Doctor is not ready')
    const scope = doctorScopeKey(input.subject)
    const active = this.activeRuns.get(scope)
    if (active) return { status: 'busy', runId: active.runId }
    const subject = this.resolveSubject(input.subject)
    const ids = this.selectChecks(
      input.checkIds ??
        (Object.keys(DOCTOR_CHECK_CATALOG) as DoctorCheckId[]).filter((id) => {
          const meta = DOCTOR_CHECK_CATALOG[id]
          return TIERS_FOR_RUN[input.tier].includes(meta.tier) && applies(meta.scope, subject)
        }),
      input.tier,
      subject
    )
    const runId = randomUUID()
    const controller = new AbortController()
    this.activeRuns.set(scope, { runId, controller })
    this.subjects.set(scope, subject)
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
      this.publish(scope, running)
      const results = await this.execute(ids, subject, controller.signal, (results, activeCheckIds) =>
        this.publish(scope, { ...running, results, activeCheckIds })
      )
      if (controller.signal.aborted) {
        this.publish(scope, { status: 'canceled', runId })
        return { status: 'canceled', runId }
      }
      const basics = await this.collectBasics()
      if (controller.signal.aborted) {
        this.publish(scope, { status: 'canceled', runId })
        return { status: 'canceled', runId }
      }
      const finishedAt = new Date()
      const report: DoctorReport = {
        schemaVersion: 1,
        runId,
        scope,
        tier: input.tier,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        expiresAt: new Date(finishedAt.getTime() + DOCTOR_REPORT_TTL_MS).toISOString(),
        basics,
        results,
        summary: summarize(results)
      }
      this.publish(scope, { status: 'completed', report })
      return { status: 'completed', report }
    } catch (error) {
      // `running` was already published; without a terminal state every window spins forever.
      this.publish(scope, { status: 'idle' })
      throw error
    } finally {
      this.activeRuns.delete(scope)
    }
  }

  /** A run outlives the service otherwise, publishing onto the shared cache after teardown. */
  protected onStop(): void {
    for (const { controller } of this.activeRuns.values()) controller.abort()
  }

  cancel(scope: DoctorScopeKey, runId: string): DoctorCancelResult {
    const active = this.activeRuns.get(scope)
    if (!active || active.runId !== runId) return { status: 'not_running' }
    active.controller.abort()
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
    if (this.activeRuns.has(scope)) return { status: 'stale', reason: 'run_superseded' }
    const stale = this.validateFix(request)
    if (stale) return stale
    const controller = new AbortController()
    this.activeRuns.set(scope, { runId: request.runId, controller })
    try {
      const state = this.currentState(scope)
      if (state.status !== 'completed') return { status: 'stale', reason: 'run_superseded' }
      const subject = this.subjects.get(scope) ?? null
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
        outcome =
          request.checkId === 'mcp-servers-connected'
            ? await doctorCheckRegistry[request.checkId].fixes[request.fixId]({ ...context, target: request.target })
            : await doctorCheckRegistry[request.checkId].fixes[request.fixId](context)
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
    const finding = state.report.results.find((item) => item.id === request.checkId)
    if (!finding || !offersFix(finding, request.fixId, request.target))
      return { status: 'stale', reason: 'finding_changed' }
    return undefined
  }

  private patchReport(scope: DoctorScopeKey, runId: string, results: readonly DoctorCheckResult[]): void {
    const state = this.currentState(scope)
    if (state.status !== 'completed' || state.report.runId !== runId) return
    const updated = new Map(results.map((result) => [result.id, result]))
    const merged = state.report.results.map((result) => updated.get(result.id) ?? result)
    this.publish(scope, {
      status: 'completed',
      report: { ...state.report, results: merged, summary: summarize(merged) }
    })
  }

  private currentState(scope: DoctorScopeKey): DoctorState {
    return application.get('CacheService').getShared(`doctor.state.${scope}`) ?? { status: 'idle' }
  }

  private publish(scope: DoctorScopeKey, state: DoctorState): void {
    application.get('CacheService').setShared(`doctor.state.${scope}`, state)
  }

  private async execute(
    ids: readonly DoctorCheckId[],
    subject: DoctorSubject | null,
    signal?: AbortSignal,
    onProgress?: (results: readonly DoctorCheckResult[], activeCheckIds: readonly DoctorCheckId[]) => void
  ): Promise<DoctorCheckResult[]> {
    const settled: DoctorCheckResult[] = []
    const activeCheckIds = new Set<DoctorCheckId>()
    const memo: RunMemo = new Map()
    const results = (await runDoctorChecks({
      checks: ids.map((id) => toEngineCheck(id, memo, subject)),
      signal,
      laneLimits: LANE_LIMITS,
      onStart: (checkId) => {
        activeCheckIds.add(checkId)
        onProgress?.([...settled], [...activeCheckIds])
      },
      onResult: (result) => {
        const doctorResult = result as DoctorCheckResult
        activeCheckIds.delete(doctorResult.id)
        settled.push(doctorResult)
        onProgress?.([...settled], [...activeCheckIds])
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
