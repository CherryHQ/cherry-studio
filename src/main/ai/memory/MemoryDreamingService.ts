import { Mutex } from 'async-mutex'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { loggerService } from '@logger'
import { createInFlightWorkTracker } from '@main/core/concurrency/inFlightWork'
import type { JobContext } from '@main/core/job/types'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { MemoryScope } from '@shared/types/memory'

import type { MemoryMutationSource } from './memoryBackups'
import { memoryDreamingJobHandler } from './memoryDreamingJobHandler'
import { DreamingError, fitDreamingInputs, generateDreamingPlan, resolveDreamingModel } from './memoryDreamingModel'
import { prepareDreamingPlan } from './memoryDreamingPlan'
import {
  memoryScopeKey,
  needsDreaming,
  observeMemory,
  readDreamingState,
  readDreamingStates,
  writeDreamingState,
  type DreamingState
} from './memoryDreamingState'
import { MEMORY_ENTRY, MemoryError, memoryHash } from './memoryFiles'
import type { MemorySession } from './MemoryService'
import type { MemoryCommitResult, MemoryRead } from './MemoryStore'

const logger = loggerService.withContext('MemoryDreamingService')
const AUTO_KEY = 'feature.memory.dreaming.enabled'
const manualReady = (state: DreamingState, now: number) =>
  state.manual && (state.manualAttempts === 0 || now - (state.lastRunAt ?? 0) >= 10 * 60_000)

@Injectable('MemoryDreamingService')
@ServicePhase(Phase.WhenReady)
@DependsOn([
  'MemoryService',
  'MemoryMigrationService',
  'JobManager',
  'AiService',
  'AiStreamManager',
  'AgentSessionRuntimeService'
])
export class MemoryDreamingService extends BaseService {
  private readonly queue = new Mutex()
  private readonly work = createInFlightWorkTracker()
  private stopped = true
  private epoch = 0
  private active?: { scope: MemoryScope; controller: AbortController }

  protected onInit(): void {
    application.get('JobManager').registerHandler('memory.dreaming', memoryDreamingJobHandler)
  }

  protected onStart(): void {
    this.stopped = false
    for (const state of readDreamingStates()) {
      state.generation++
      state.manual = false
      if (state.status === 'running' || state.status === 'queued') state.status = 'cancelled'
      writeDreamingState(state)
    }
    this.registerDisposable(
      application
        .get('MemoryService')
        .onChanged(({ scope, source, result }) => this.recordChanges(scope, source, result))
    )
    this.registerDisposable(
      application.get('MemoryService').onInvalidated((scope) => {
        if (scope) this.invalidate(scope, false)
        else {
          this.epoch++
          this.active?.controller.abort('paused')
        }
      })
    )
    this.registerDisposable(
      agentService.onMemoryAccessRevoked((agentId) => {
        if (!agentService.getAgent(agentId)) this.invalidate({ kind: 'private', agentId }, true)
      })
    )
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange(AUTO_KEY, (enabled) => {
        if (!enabled) {
          for (const state of readDreamingStates()) this.invalidate(state.scope, false)
        } else this.wake()
      })
    )
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange('chat.default_model_id', () => {
        for (const state of readDreamingStates()) {
          for (const file of Object.values(state.files)) {
            file.attempts = 0
            file.retryAt = 0
          }
          if (state.reason === 'model' || state.reason === 'budget') {
            state.status = 'idle'
            state.reason = undefined
          }
          writeDreamingState(state)
        }
        this.wake()
      })
    )
    this.registerInterval(() => {
      if (this.active && this.foregroundBusy()) this.active.controller.abort('foreground')
    }, 500)
  }

  protected onAllReady(): void {
    if (!jobScheduleService.getByTypeAndName('memory.dreaming', 'wake')) {
      application.get('JobManager').registerJobSchedule({
        type: 'memory.dreaming',
        name: 'wake',
        trigger: { kind: 'interval', ms: 60_000 },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
    }
    this.wake()
  }

  status(scope: MemoryScope) {
    const { status, reason, lastRunAt, manual, files } = readDreamingState(scope)
    const preferences = application.get('PreferenceService')
    if ((manual || preferences.get(AUTO_KEY)) && !preferences.get('chat.default_model_id'))
      return { status: 'failed' as const, reason: 'model' as const, lastRunAt, pending: manual }
    const blocked = Object.values(files).find(
      (file) => file.pendingSince !== undefined && file.attempts >= 2 && file.reason
    )
    if (blocked && status === 'idle')
      return { status: 'failed' as const, reason: blocked.reason, lastRunAt, pending: manual }
    return { status, reason, lastRunAt, pending: manual || status === 'running' }
  }

  request(scope: MemoryScope): void {
    this.assertScope(scope)
    const state = readDreamingState(scope)
    if (this.active && memoryScopeKey(this.active.scope) === memoryScopeKey(scope)) return
    state.manual = true
    state.manualAttempts = 0
    state.cancelled = false
    state.status = 'queued'
    state.reason = undefined
    for (const file of Object.values(state.files)) {
      file.attempts = 0
      file.retryAt = 0
    }
    writeDreamingState(state)
    this.wake()
  }

  cancel(scope: MemoryScope): void {
    this.invalidate(scope, true)
  }

  execute(ctx: JobContext<Record<string, never>>): Promise<unknown> {
    return this.work.track(
      this.queue.runExclusive(async () => {
        ctx.signal.throwIfAborted()
        if (this.stopped || this.foregroundBusy()) return { deferred: true }
        const states = new Map(readDreamingStates().map((state) => [memoryScopeKey(state.scope), state]))
        const scopes: MemoryScope[] = [
          { kind: 'shared' },
          ...agentService.listAgents().agents.map((agent): MemoryScope => ({ kind: 'private', agentId: agent.id }))
        ]
        const now = Date.now()
        const automatic = application.get('PreferenceService').get(AUTO_KEY)
        const candidates = scopes
          .map((scope) => states.get(memoryScopeKey(scope)) ?? readDreamingState(scope))
          .filter((state) => state.manual || (automatic && !state.cancelled))
        const priority = (state: DreamingState) =>
          manualReady(state, now) ? 0 : Object.values(state.files).some((file) => needsDreaming(file, now)) ? 1 : 2
        candidates.sort((left, right) => priority(left) - priority(right) || left.lastScanAt - right.lastScanAt)
        if (!candidates[0]) return { idle: true }
        return this.organize(candidates[0].scope, ctx)
      })
    )
  }

  protected async onStop(): Promise<void> {
    this.stopped = true
    this.epoch++
    this.active?.controller.abort('stopped')
    if (!(await this.work.drain())) throw new Error('Memory organization did not drain')
  }

  private foregroundBusy(): boolean {
    return (
      application.get('AgentSessionRuntimeService').hasBusySessions() ||
      application.get('AiStreamManager').listActiveWork().length > 0
    )
  }

  private assertScope(scope: MemoryScope): void {
    if (this.stopped || (scope.kind === 'private' && !agentService.getAgent(scope.agentId)))
      throw new DOMException('Memory maintenance is unavailable', 'AbortError')
  }

  private wake(): void {
    if (this.stopped) return
    try {
      application
        .get('JobManager')
        .enqueue('memory.dreaming', {}, { idempotencyKey: 'memory.dreaming:wake', maxAttempts: 1 })
    } catch (error) {
      logger.warn('Memory organization wake is unavailable', { error })
    }
  }

  private invalidate(scope: MemoryScope, cancelled: boolean): void {
    const state = readDreamingState(scope)
    state.generation++
    state.manual = false
    state.cancelled = cancelled
    state.status = cancelled ? 'cancelled' : 'idle'
    state.reason = undefined
    writeDreamingState(state)
    if (this.active && memoryScopeKey(this.active.scope) === memoryScopeKey(scope))
      this.active.controller.abort('invalidated')
  }

  private recordChanges(scope: MemoryScope, source: MemoryMutationSource, result: MemoryCommitResult): void {
    if (source === 'dreaming') return
    const state = readDreamingState(scope)
    for (const file of result.files) {
      if (file.outcome !== 'applied') continue
      const previous = state.files[file.path]
      state.files[file.path] = {
        ...previous,
        observedHash: file.hash,
        changes: (previous?.changes ?? 0) + Number(source === 'controlled'),
        revision: (previous?.revision ?? 0) + 1,
        pendingSince: previous?.pendingSince ?? Date.now(),
        reason: undefined,
        attempts: 0,
        retryAt: 0,
        warning: previous?.warning ?? false
      }
      state.cancelled = false
    }
    writeDreamingState(state)
    if (Object.values(state.files).some((file) => file.changes >= 10)) this.wake()
  }

  private async organize(scope: MemoryScope, ctx: JobContext<Record<string, never>>): Promise<unknown> {
    const start = readDreamingState(scope)
    const generation = start.generation
    const epoch = this.epoch
    const controller = new AbortController()
    const abort = () => controller.abort(ctx.signal.reason)
    ctx.signal.addEventListener('abort', abort, { once: true })
    this.active = { scope, controller }
    const revisions = new Map<string, number>()
    let attempted = false
    let inputs: MemoryRead[] = []
    let inputBytes = 0
    const assertCurrent = (): undefined => {
      ctx.signal.throwIfAborted()
      controller.signal.throwIfAborted()
      this.assertScope(scope)
      const state = readDreamingState(scope)
      if (
        epoch !== this.epoch ||
        state.generation !== generation ||
        (!start.manual && !application.get('PreferenceService').get(AUTO_KEY))
      )
        throw new DOMException('Memory maintenance was invalidated', 'AbortError')
      if (this.foregroundBusy()) {
        controller.abort('foreground')
        controller.signal.throwIfAborted()
      }
      for (const [target, revision] of revisions)
        if (state.files[target]?.revision !== revision) throw new DreamingError('conflict')
      return undefined
    }
    let session: MemorySession | undefined
    try {
      session = application.get('MemoryService').open({ scope, assertAuthorized: assertCurrent }, 'dreaming')
      if (start.manual && !manualReady(start, Date.now())) {
        start.lastScanAt = Date.now()
        writeDreamingState(start)
        return { deferred: true }
      }
      if (scope.kind === 'private' && !(await application.get('MemoryService').prepareAgent(scope.agentId)))
        throw new DreamingError('migration')
      const paths = await session.list()
      const state = readDreamingState(scope)
      const topics = [...new Set([...paths, ...Object.keys(state.files)])]
        .filter((target) => target !== MEMORY_ENTRY)
        .sort()
      const pivot = topics.findIndex((target) => target > state.cursor)
      const rotated = pivot < 0 ? topics : [...topics.slice(pivot), ...topics.slice(0, pivot)]
      rotated.sort(
        (left, right) =>
          Number(needsDreaming(state.files[right], Date.now())) - Number(needsDreaming(state.files[left], Date.now()))
      )
      const selected = [MEMORY_ENTRY, ...rotated.slice(0, 9)]
      for (const target of selected) {
        const read = await session.read(target)
        const latest = readDreamingState(scope)
        observeMemory(latest, read, Date.now())
        latest.lastScanAt = Date.now()
        if (target !== MEMORY_ENTRY) latest.cursor = target
        const bytes = Buffer.byteLength(read.content ?? '', 'utf8')
        if (bytes > 50_000) {
          latest.files[target].attempts = 2
          latest.files[target].reason = 'budget'
        }
        writeDreamingState(latest)
        if (target === MEMORY_ENTRY && bytes > 50_000) throw new DreamingError('budget')
        if (inputBytes + bytes <= 50_000) {
          inputs.push(read)
          inputBytes += bytes
        }
      }
      let latest = readDreamingState(scope)
      inputs = inputs.filter((read) => read.path === MEMORY_ENTRY || latest.files[read.path].attempts < 2)
      if (!start.manual && !inputs.some((read) => needsDreaming(latest.files[read.path], Date.now())))
        return { scanned: inputs.length }
      if (!inputs.some((read) => latest.files[read.path].attempts < 2 && latest.files[read.path].retryAt <= Date.now()))
        return { deferred: true }
      const empty = inputs.every((read) => !read.content?.trim())
      const resolved = empty ? undefined : await resolveDreamingModel()
      const batch = resolved ? fitDreamingInputs(inputs, resolved) : undefined
      if (batch) inputs = batch.inputs
      latest = readDreamingState(scope)
      if (!start.manual && !inputs.some((read) => needsDreaming(latest.files[read.path], Date.now())))
        throw new DreamingError('budget')
      for (const read of inputs) revisions.set(read.path, latest.files[read.path].revision)
      assertCurrent()
      if (batch && resolved) {
        latest.status = 'running'
        if (start.manual) latest.manualAttempts++
        latest.lastRunAt = Date.now()
        latest.reason = undefined
        for (const read of inputs) {
          latest.files[read.path].attempts++
          latest.files[read.path].retryAt = Date.now() + 10 * 60_000
        }
        writeDreamingState(latest)
        attempted = true
      }
      const text =
        batch && resolved
          ? await generateDreamingPlan(ctx.jobId, resolved, batch, controller.signal)
          : '{"writes":[],"deletes":[]}'
      assertCurrent()
      let plan: Awaited<ReturnType<typeof prepareDreamingPlan>>
      try {
        plan = await prepareDreamingPlan(text, inputs, paths, session)
      } catch {
        throw new DreamingError('output')
      }
      const result = await session.commit(
        plan.mutations,
        async () => assertCurrent,
        [...plan.reads.values()].map((read) => read.receipt),
        undefined,
        plan.deleted.size ? paths : undefined
      )
      const partial =
        !!result.error || result.files.some((file) => file.outcome !== 'applied' && file.outcome !== 'unchanged')
      let checked = 0
      for (const [target, read] of plan.reads) {
        if (partial && !result.files.some((file) => file.path === target && file.outcome === 'applied')) continue
        const expected = plan.deleted.has(target)
          ? null
          : plan.outputs.has(target)
            ? memoryHash(Buffer.from(plan.outputs.get(target)!))
            : read.hash
        const actual = await session.read(target)
        latest = readDreamingState(scope)
        if (actual.hash !== expected || (latest.files[target]?.revision ?? 0) !== (revisions.get(target) ?? 0)) continue
        latest.files[target] = {
          observedHash: expected,
          processedHash: expected,
          processedAt: Date.now(),
          changes: 0,
          revision: revisions.get(target) ?? 0,
          attempts: 0,
          retryAt: 0,
          warning: false
        }
        writeDreamingState(latest)
        checked++
      }
      if (partial) throw new DreamingError('conflict')
      latest = readDreamingState(scope)
      latest.manual = false
      latest.status = 'idle'
      latest.reason = undefined
      latest.lastRunAt = Date.now()
      writeDreamingState(latest)
      return {
        scope: memoryScopeKey(scope),
        checked,
        changed: result.files.filter((file) => file.outcome === 'applied').length
      }
    } catch (error) {
      const latest = readDreamingState(scope)
      if (latest.generation === generation) {
        const retryable =
          attempted && latest.manualAttempts < 2 && inputs.some((read) => (latest.files[read.path]?.attempts ?? 2) < 2)
        latest.manual = start.manual && retryable
        if (ctx.signal.aborted) {
          latest.generation++
          latest.manual = false
          latest.cancelled = true
        }
        latest.lastScanAt = Date.now()
        latest.status =
          controller.signal.aborted || ctx.signal.aborted ? (latest.manual ? 'queued' : 'cancelled') : 'failed'
        latest.reason =
          error instanceof DreamingError
            ? error.reason
            : error instanceof MemoryError
              ? error.code === 'backup-capacity'
                ? 'backup'
                : error.code === 'limit'
                  ? 'budget'
                  : 'conflict'
              : 'unavailable'
        if (attempted)
          for (const read of inputs) {
            const file = latest.files[read.path]
            if (file && file.pendingSince !== undefined) file.reason = latest.reason
          }
        writeDreamingState(latest)
      }
      if (controller.signal.aborted || ctx.signal.aborted)
        throw new DOMException('Memory organization interrupted', 'AbortError')
      logger.warn('Memory organization did not complete', { scope: memoryScopeKey(scope), reason: latest.reason })
      throw new DreamingError(latest.reason ?? 'unavailable')
    } finally {
      session?.dispose()
      ctx.signal.removeEventListener('abort', abort)
      this.active = undefined
    }
  }
}
