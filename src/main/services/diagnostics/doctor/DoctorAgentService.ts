import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { applyWrite, undoWrite, writeRisk } from '@main/ai/agents/doctor/doctorWrites'
import { loadBuiltinAgentEnsureInput } from '@main/ai/agents/ensureBuiltinAgent'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import { startAgentSessionRun, type StreamListener } from '@main/ai/streamManager'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { getAppLanguage } from '@main/i18n'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { UniqueModelId } from '@shared/data/types/model'
import type { DoctorReport, DoctorScopeKey } from '@shared/types/doctor'
import type {
  DoctorAgentApplyResult,
  DoctorAgentCancelResult,
  DoctorAgentChange,
  DoctorAgentProposal,
  DoctorAgentRun,
  DoctorAgentStartResult,
  DoctorAgentState,
  DoctorAgentUndoResult,
  DoctorAgentWrite
} from '@shared/types/doctorAgent'
import { doctorAgentStateCacheKey, doctorStateCacheKey, projectDoctorReport } from '@shared/utils/doctor'

const logger = loggerService.withContext('DoctorAgentService')

const RUN_TIMEOUT_MS = 5 * 60_000
const TEXT_PUBLISH_INTERVAL_MS = 200

interface ActiveRun {
  readonly runId: string
  readonly sessionId: string
  readonly topicId: string
  readonly timer: NodeJS.Timeout
}

export type DoctorAgentWriteOutcome =
  | { readonly status: 'applied'; readonly change: DoctorAgentChange }
  | { readonly status: 'proposed'; readonly proposal: DoctorAgentProposal }
  | { readonly status: 'failed'; readonly message: string }

/**
 * Runs the doctor built-in Agent headlessly over a completed Doctor report and owns everything it
 * may change: the proposal list, the change ledger and undo. State is published on
 * `doctorAgentStateCacheKey(scope)`; the panel never talks to the Agent session directly.
 */
@Injectable('DoctorAgentService')
@ServicePhase(Phase.WhenReady)
export class DoctorAgentService extends BaseService {
  private readonly active = new Map<DoctorScopeKey, ActiveRun>()
  /** Session → scope, so a tool call can find the run it belongs to without carrying the scope. */
  private readonly sessions = new Map<string, DoctorScopeKey>()

  protected override onStop(): void {
    for (const scope of Array.from(this.active.keys())) this.abort(scope, 'service stopping')
  }

  async start(input: { scope: DoctorScopeKey; reportRunId: string }): Promise<DoctorAgentStartResult> {
    const { scope, reportRunId } = input
    const busy = this.active.get(scope)
    if (busy) return { status: 'busy', runId: busy.runId }
    const report = this.currentReport(scope)
    if (!report || report.runId !== reportRunId) return { status: 'stale' }

    const agent = this.ensureDoctorAgent()
    if (!agent.model) return { status: 'no_model' }

    const session = agentSessionService.create(
      { agentId: agent.id, name: 'System Doctor', workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM } },
      'background'
    )
    const runId = randomUUID()
    const topicId = buildAgentSessionTopicId(session.id)
    const run: DoctorAgentRun = {
      runId,
      reportRunId,
      sessionId: session.id,
      startedAt: new Date().toISOString(),
      text: '',
      toolCalls: [],
      proposals: [],
      changes: []
    }
    this.sessions.set(session.id, scope)
    this.active.set(scope, {
      runId,
      sessionId: session.id,
      topicId,
      timer: setTimeout(() => this.abort(scope, 'timed out'), RUN_TIMEOUT_MS)
    })
    this.publish(scope, { status: 'running', ...run })

    try {
      const started = await startAgentSessionRun({
        sessionId: session.id,
        userParts: [{ type: 'text', text: this.buildPrompt(scope, report) }],
        listeners: [this.createListener(scope, runId)],
        headless: true,
        requireIdle: { expectedAgentId: agent.id }
      })
      if (started.mode !== 'started') {
        this.finish(scope, runId, (current) => ({
          status: 'failed',
          error: `not started: ${started.reason}`,
          ...current
        }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.finish(scope, runId, (current) => ({ status: 'failed', error: message, ...current }))
      throw error
    }
    return { status: 'started', runId }
  }

  cancel(scope: DoctorScopeKey, runId: string): DoctorAgentCancelResult {
    const active = this.active.get(scope)
    if (!active || active.runId !== runId) return { status: 'not_running' }
    this.abort(scope, 'canceled by user')
    return { status: 'canceled' }
  }

  async apply(input: { scope: DoctorScopeKey; runId: string; proposalId: string }): Promise<DoctorAgentApplyResult> {
    const state = this.currentState(input.scope)
    if (state.status === 'idle' || state.runId !== input.runId) return { status: 'stale' }
    const proposal = state.proposals.find((item) => item.id === input.proposalId)
    if (!proposal || proposal.status !== 'pending') return { status: 'stale' }
    if (proposal.write.kind === 'doctor_fix' && this.currentReport(input.scope)?.runId !== state.reportRunId) {
      this.patchProposal(input.scope, input.runId, proposal.id, { status: 'rejected', error: 'report superseded' })
      return { status: 'stale' }
    }
    try {
      const applied = await applyWrite(proposal.write)
      const change = this.recordChange(input.scope, input.runId, proposal.write, proposal.summary, applied, proposal.id)
      this.patchProposal(input.scope, input.runId, proposal.id, { status: 'applied' })
      return { status: 'applied', change, ...(applied.fix ? { fix: applied.fix } : {}) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.patchProposal(input.scope, input.runId, proposal.id, { status: 'failed', error: message })
      return { status: 'failed', message }
    }
  }

  async undo(input: { scope: DoctorScopeKey; runId: string; changeId: string }): Promise<DoctorAgentUndoResult> {
    const state = this.currentState(input.scope)
    if (state.status === 'idle' || state.runId !== input.runId) return { status: 'stale' }
    const change = state.changes.find((item) => item.id === input.changeId)
    if (!change || !change.undoable || change.undone) return { status: 'stale' }
    try {
      await undoWrite(change.write, change.before)
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
    const undone = { ...change, undone: true }
    this.update(input.scope, input.runId, (current) => ({
      ...current,
      changes: current.changes.map((item) => (item.id === change.id ? undone : item))
    }))
    return { status: 'undone', change: undone }
  }

  /** Tool entry point: run low-risk writes now, queue the rest for the user. */
  async requestWrite(sessionId: string, write: DoctorAgentWrite, summary: string): Promise<DoctorAgentWriteOutcome> {
    const { scope, runId } = this.runForSession(sessionId)
    if (writeRisk(write) === 'confirm') {
      const proposal: DoctorAgentProposal = { id: randomUUID(), write, summary, status: 'pending' }
      this.update(scope, runId, (current) => ({ ...current, proposals: [...current.proposals, proposal] }))
      return { status: 'proposed', proposal }
    }
    try {
      const applied = await applyWrite(write)
      return { status: 'applied', change: this.recordChange(scope, runId, write, summary, applied) }
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
  }

  reportForSession(sessionId: string): unknown {
    const { scope } = this.runForSession(sessionId)
    const report = this.currentReport(scope)
    return report ? projectDoctorReport(report, 'upload') : { status: 'missing' }
  }

  reportBindingForSession(sessionId: string): { scope: DoctorScopeKey; reportRunId: string } {
    const { scope, reportRunId } = this.runForSession(sessionId)
    return { scope, reportRunId }
  }

  private runForSession(sessionId: string): { scope: DoctorScopeKey; runId: string; reportRunId: string } {
    const scope = this.sessions.get(sessionId)
    const state = scope ? this.currentState(scope) : undefined
    if (!scope || !state || state.status !== 'running' || state.sessionId !== sessionId) {
      throw new Error('This session is not an active doctor analysis')
    }
    return { scope, runId: state.runId, reportRunId: state.reportRunId }
  }

  private ensureDoctorAgent() {
    const agent = agentService.ensureBuiltinAgent(loadBuiltinAgentEnsureInput(BUILTIN_AGENT_ROLE.DOCTOR))
    if (agent.model) return agent
    // The Agent may predate the user's first model; follow the current default before giving up.
    const defaultModel = application.get('PreferenceService').get('chat.default_model_id') as UniqueModelId | null
    if (!defaultModel) return agent
    try {
      return agentService.updateAgent(agent.id, { model: defaultModel }) ?? agent
    } catch (error) {
      logger.warn('Could not assign the default model to the doctor Agent', error as Error)
      return agent
    }
  }

  private buildPrompt(scope: DoctorScopeKey, report: DoctorReport): string {
    return [
      `Analyze this System Doctor report. Scope: ${scope}. Reply in the language "${getAppLanguage()}".`,
      'Nobody will answer questions in this turn. Investigate with the available tools, then write the final analysis.',
      '',
      '```json',
      JSON.stringify(projectDoctorReport(report, 'upload')),
      '```'
    ].join('\n')
  }

  private createListener(scope: DoctorScopeKey, runId: string): StreamListener {
    let text = ''
    const toolCalls: string[] = []
    let flushTimer: NodeJS.Timeout | undefined
    const flush = () => {
      flushTimer = undefined
      this.update(scope, runId, (current) => ({ ...current, text, toolCalls: [...toolCalls] }))
    }
    const scheduleFlush = () => {
      flushTimer ??= setTimeout(flush, TEXT_PUBLISH_INTERVAL_MS)
    }
    const settle = (status: 'completed' | 'canceled' | 'failed', error?: string) => {
      if (flushTimer) clearTimeout(flushTimer)
      this.finish(scope, runId, (current) => {
        const run = { ...current, text, toolCalls: [...toolCalls] }
        return status === 'failed' ? { status, error: error ?? 'unknown error', ...run } : { status, ...run }
      })
    }
    return {
      id: `doctor-agent:${runId}`,
      onChunk(chunk) {
        if (chunk.type === 'text-delta') {
          text += chunk.delta
          scheduleFlush()
        } else if (chunk.type === 'tool-input-start') {
          toolCalls.push(chunk.toolName)
          scheduleFlush()
        }
      },
      onDone: () => settle('completed'),
      onPaused: () => settle(this.active.get(scope)?.runId === runId ? 'completed' : 'canceled'),
      onError: (result) => settle('failed', result.error.message ?? 'Execution failed'),
      isAlive: () => this.active.get(scope)?.runId === runId
    }
  }

  private recordChange(
    scope: DoctorScopeKey,
    runId: string,
    write: DoctorAgentWrite,
    summary: string,
    applied: { before: unknown; undoable: boolean },
    proposalId?: string
  ): DoctorAgentChange {
    const change: DoctorAgentChange = {
      id: randomUUID(),
      write,
      summary,
      before: applied.before,
      undoable: applied.undoable,
      undone: false,
      appliedAt: new Date().toISOString(),
      ...(proposalId ? { proposalId } : {})
    }
    this.update(scope, runId, (current) => ({ ...current, changes: [...current.changes, change] }))
    return change
  }

  private patchProposal(
    scope: DoctorScopeKey,
    runId: string,
    proposalId: string,
    patch: Partial<Pick<DoctorAgentProposal, 'status' | 'error'>>
  ): void {
    this.update(scope, runId, (current) => ({
      ...current,
      proposals: current.proposals.map((item) => (item.id === proposalId ? { ...item, ...patch } : item))
    }))
  }

  private abort(scope: DoctorScopeKey, reason: string): void {
    const active = this.active.get(scope)
    if (!active) return
    logger.info('Aborting doctor analysis', { scope, runId: active.runId, reason })
    application.get('AiStreamManager').abort(active.topicId, `doctor-agent: ${reason}`)
    // The stream's terminal callback settles the state; the sentinel below covers a stream that never started.
    this.finish(scope, active.runId, (current) => ({ status: 'canceled', ...current }))
  }

  /** Terminal transition: runs once per run, releases the timer and the session binding. */
  private finish(scope: DoctorScopeKey, runId: string, next: (run: DoctorAgentRun) => DoctorAgentState): void {
    const active = this.active.get(scope)
    if (!active || active.runId !== runId) return
    clearTimeout(active.timer)
    this.active.delete(scope)
    this.sessions.delete(active.sessionId)
    const state = this.currentState(scope)
    if (state.status !== 'idle' && state.runId === runId) this.publish(scope, next(toRun(state)))
  }

  private update(scope: DoctorScopeKey, runId: string, next: (run: DoctorAgentRun) => DoctorAgentRun): void {
    const state = this.currentState(scope)
    if (state.status === 'idle' || state.runId !== runId) return
    const run = next(toRun(state))
    this.publish(
      scope,
      state.status === 'failed' ? { status: 'failed', error: state.error, ...run } : { status: state.status, ...run }
    )
  }

  private currentReport(scope: DoctorScopeKey): DoctorReport | undefined {
    const state = application.get('CacheService').getShared(doctorStateCacheKey(scope))
    if (!state || state.status !== 'completed') return undefined
    return Date.parse(state.report.expiresAt) > Date.now() ? state.report : undefined
  }

  private currentState(scope: DoctorScopeKey): DoctorAgentState {
    return application.get('CacheService').getShared(doctorAgentStateCacheKey(scope)) ?? { status: 'idle' }
  }

  private publish(scope: DoctorScopeKey, state: DoctorAgentState): void {
    application.get('CacheService').setShared(doctorAgentStateCacheKey(scope), state)
  }
}

function toRun(state: Exclude<DoctorAgentState, { status: 'idle' }>): DoctorAgentRun {
  const { runId, reportRunId, sessionId, startedAt, text, toolCalls, proposals, changes } = state
  return { runId, reportRunId, sessionId, startedAt, text, toolCalls, proposals, changes }
}
