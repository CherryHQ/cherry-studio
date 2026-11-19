import { Mutex } from 'async-mutex'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { createInFlightWorkTracker } from '@main/core/concurrency/inFlightWork'
import type { JobContext } from '@main/core/job/types'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { MemoryExtractionRange, MemoryScope } from '@shared/types/memory'

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
import type { MemoryRevision } from './memoryEntries'
import {
  extractContextCandidates,
  extractionBranch,
  InvalidExtractionSource,
  readExtractionRange,
  readExtractionSource,
  type ExtractionInput,
  type ExtractionTicket
} from './memoryExtraction'
import {
  completeExtraction,
  deferExtraction,
  enqueueExtraction,
  extractionBoundary,
  invalidateExtractions,
  readExtractionState,
  readyExtraction,
  skipExtractionTurn,
  skipExtractionTurns,
  writeExtractionState,
  type ExtractionState
} from './memoryExtractionState'
import { MEMORY_ENTRY, MemoryError, memoryHash } from './memoryFiles'
import type { MemorySession } from './MemoryService'
import type { MemoryCommitResult, MemoryRead, MemoryMutation } from './MemoryStore'
import { anchorMemoryTime } from './memoryTime'

const logger = loggerService.withContext('MemoryDreamingService')
const AUTO_KEY = 'feature.memory.dreaming.enabled'
const GENERATION_KEY = 'feature.memory.generation.enabled'
const manualReady = (state: DreamingState, now: number) =>
  state.manual &&
  (state.manualAttempts === 0 || Object.values(state.files).some((file) => file.attempts < 2 && file.retryAt <= now))

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
  private active?: { scope: MemoryScope; controller: AbortController; extraction?: ExtractionTicket }
  private extractionBoundary = Date.now()
  private readonly sourceBoundaries = new Map<string, number>()

  protected onInit(): void {
    application.get('JobManager').registerHandler('memory.dreaming', memoryDreamingJobHandler)
  }

  protected override onReady(): void {
    this.stopped = false
    this.extractionBoundary = extractionBoundary()
    if (!application.get('PreferenceService').get(GENERATION_KEY)) this.resetExtraction()
    for (const state of readDreamingStates()) {
      state.generation++
      state.manual = false
      if (state.status === 'running') state.lastResult = { outcome: 'cancelled', finishedAt: Date.now() }
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
        this.resetExtraction(`agent/${agentId}`)
        if (!agentService.getAgent(agentId)) this.invalidate({ kind: 'private', agentId }, true)
      })
    )
    this.registerDisposable(
      agentService.onAgentUpdated(({ agentId, agent }) => {
        if (agent.configuration?.shared_memory_enabled === false) this.resetExtraction(`agent/${agentId}`)
      })
    )
    this.registerDisposable(assistantDataService.onMemoryAccessRevoked((id) => this.resetExtraction(`assistant/${id}`)))
    this.registerDisposable(
      topicService.onMemoryAccessRevoked((id) => this.resetExtraction(`memory:extraction:assistant/${id}`))
    )
    this.registerDisposable(
      agentSessionService.onSessionUpdated(({ sessionId }) => {
        try {
          const session = agentSessionService.getConversationById(sessionId)
          const key = `memory:extraction:agent/${sessionId}`
          const state = readExtractionState(key)
          if (state?.pending.length && state.entityKey !== `agent/${session.agentId}`) this.resetExtraction(key)
        } catch {
          this.resetExtraction(`memory:extraction:agent/${sessionId}`)
        }
      })
    )
    this.registerDisposable(
      application.get('AiStreamManager').onConversationCompleted((event) => {
        for (const responseId of event.memoryResponseIds ?? [])
          this.captureExtraction({ kind: 'assistant', topicId: event.topicId, responseId })
      })
    )
    this.registerDisposable(
      application.get('AgentSessionRuntimeService').onTurnTerminal((event) => {
        if (event.status === 'success' && event.boundary === 'turn' && event.memoryUserMessageId)
          this.captureExtraction({
            kind: 'agent',
            sessionId: event.sessionId,
            userMessageId: event.memoryUserMessageId,
            responseId: event.assistantMessageId
          })
      })
    )
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange(GENERATION_KEY, (enabled) => {
        this.resetExtraction()
        if (enabled) this.wake()
      })
    )
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange(AUTO_KEY, (enabled) => {
        if (!enabled) {
          for (const state of readDreamingStates()) {
            if (this.active?.extraction && state.scope.kind === 'shared') continue
            this.invalidate(state.scope, false)
          }
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
    if (!jobScheduleService.getByTypeAndName('memory.dreaming', 'extraction-daily')) {
      application.get('JobManager').registerJobSchedule({
        type: 'memory.dreaming',
        name: 'extraction-daily',
        trigger: { kind: 'cron', expr: '0 21 * * *' },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'after-startup', minutes: 0 }
      })
    }
    this.wake()
  }

  status(scope: MemoryScope) {
    const { status, reason, lastRunAt, lastResult, manual, files } = readDreamingState(scope)
    const preferences = application.get('PreferenceService')
    if ((manual || preferences.get(AUTO_KEY)) && !preferences.get('chat.default_model_id'))
      return { status: 'failed' as const, reason: 'model' as const, lastRunAt, lastResult, pending: manual }
    const blocked = Object.values(files).find(
      (file) => file.pendingSince !== undefined && file.attempts >= 2 && file.reason
    )
    if (blocked && status === 'idle')
      return { status: 'failed' as const, reason: blocked.reason, lastRunAt, lastResult, pending: manual }
    return { status, reason, lastRunAt, lastResult, pending: manual || status === 'running' }
  }

  request(scope: MemoryScope): void {
    this.assertScope(scope)
    const state = readDreamingState(scope)
    if (
      this.active &&
      !this.active.controller.signal.aborted &&
      memoryScopeKey(this.active.scope) === memoryScopeKey(scope)
    )
      return
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
    if (scope.kind === 'shared') this.resetExtraction()
    this.invalidate(scope, true)
  }

  previewExtraction(range: MemoryExtractionRange, assertCaller: () => undefined) {
    // No persisted body, cursor advancement or write capability until forgetting is supported.
    const epoch = this.epoch
    const boundary = this.extractionBoundary
    const generation = readDreamingState({ kind: 'shared' }).generation
    return this.work.track(
      this.queue.runExclusive(async () => {
        const scope = { kind: 'shared' } as const
        const controller = new AbortController()
        let session: MemorySession | undefined
        let revoke: { dispose(): void } | undefined
        assertCaller()
        this.assertScope(scope)
        if (!application.get('PreferenceService').get(GENERATION_KEY)) throw new DreamingError('unavailable')
        const initial = readExtractionSource(range.source)
        const minimum = Math.max(
          boundary,
          this.sourceBoundaries.get(initial.entityKey) ?? 0,
          this.sourceBoundaries.get(initial.key) ?? 0
        )
        const assertActive = (): undefined => {
          assertCaller()
          this.assertScope(scope)
          controller.signal.throwIfAborted()
          initial.authority.assertAuthorized()
          if (
            this.epoch !== epoch ||
            this.extractionBoundary !== boundary ||
            readDreamingState(scope).generation !== generation ||
            !application.get('PreferenceService').get(GENERATION_KEY) ||
            this.foregroundBusy() ||
            Math.max(
              boundary,
              this.sourceBoundaries.get(initial.entityKey) ?? 0,
              this.sourceBoundaries.get(initial.key) ?? 0
            ) !== minimum
          )
            throw new DOMException('Memory preview invalidated', 'AbortError')
          return undefined
        }
        assertActive()
        const source = readExtractionRange(range, minimum)
        const assertCurrent = (): undefined => {
          assertActive()
          if (readExtractionRange(range, minimum).hash !== source.hash) throw new DreamingError('conflict')
          return undefined
        }
        const ticket: ExtractionTicket = {
          input: initial.input,
          entityKey: initial.entityKey,
          key: initial.key,
          messageId: initial.messageId,
          createdAt: initial.createdAt,
          hash: initial.hash
        }
        this.active = { scope, controller, extraction: ticket }
        try {
          revoke = initial.authority.onRevoked?.(() => controller.abort('source-revoked'))
          session = application.get('MemoryService').open(
            { scope, assertAuthorized: assertCurrent },
            'extraction',
            source.messages.map((message) => ({
              kind: ticket.input.kind === 'assistant' ? 'chat' : 'agent',
              conversationId: ticket.input.kind === 'assistant' ? ticket.input.topicId : ticket.input.sessionId,
              messageId: message.id,
              sourceVersion: message.version
            }))
          )
          const paths = await session.list()
          if (paths.length > 40) throw new DreamingError('budget')
          const files: MemoryRead[] = []
          let bytes = 0
          for (const path of paths) {
            const file = await session.read(path)
            bytes += Buffer.byteLength(file.content ?? '', 'utf8')
            if (bytes > 32_000) throw new DreamingError('budget')
            files.push(file)
          }
          const result = await extractContextCandidates(
            source,
            files.map(({ path, hash, content }) => ({ path, hash, content })),
            controller.signal,
            async () => {
              await session!.validateModelReads()
              return assertCurrent()
            }
          )
          if (JSON.stringify(await session.list()) !== JSON.stringify(paths)) throw new DreamingError('conflict')
          for (const file of files)
            if ((await session.read(file.path)).hash !== file.hash) throw new DreamingError('conflict')
          assertCurrent()
          return result
        } catch (error) {
          if (controller.signal.aborted) throw new DOMException('Memory preview interrupted', 'AbortError')
          throw error
        } finally {
          revoke?.dispose()
          session?.dispose()
          this.active = undefined
        }
      })
    )
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
        if (
          application.get('PreferenceService').get(GENERATION_KEY) &&
          ![...states.values()].some((state) => manualReady(state, now))
        ) {
          const pending = readyExtraction()
          if (pending) return this.extract(pending, ctx)
        }
        const automatic = application.get('PreferenceService').get(AUTO_KEY)
        const candidates = scopes
          .map((scope) => states.get(memoryScopeKey(scope)) ?? readDreamingState(scope))
          .filter((state) => state.manual || (automatic && !state.cancelled))
        const priority = (state: DreamingState) => {
          if (manualReady(state, now)) return 0
          const entry = state.files[MEMORY_ENTRY]
          if (entry && entry.attempts >= 2 && entry.reason === 'budget') return 2
          return Object.values(state.files).some((file) => needsDreaming(file, now)) ? 1 : 2
        }
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
    if (state.status === 'running') state.lastResult = { outcome: 'cancelled', finishedAt: Date.now() }
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
    if (
      scope.kind === 'shared' &&
      (source === 'clear' || source === 'recovery') &&
      ((source === 'clear' && !result.error) ||
        result.files.some((file) => file.outcome === 'applied' || file.outcome === 'pending'))
    )
      this.resetExtraction()
    if (source === 'dreaming') return
    const state = readDreamingState(scope)
    for (const file of result.files) {
      if (file.outcome !== 'applied') continue
      const previous = state.files[file.path]
      state.files[file.path] = {
        ...previous,
        observedHash: file.hash,
        changes: (previous?.changes ?? 0) + Number(source === 'controlled' || source === 'extraction'),
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

  private resetExtraction(sourceKey?: string): void {
    if (sourceKey) this.sourceBoundaries.set(sourceKey, Date.now())
    else this.extractionBoundary = Date.now()
    invalidateExtractions(sourceKey)
    const ticket = this.active?.extraction
    if (ticket && (!sourceKey || ticket.entityKey === sourceKey || ticket.key === sourceKey))
      this.active?.controller.abort('source-invalidated')
  }

  private captureExtraction(input: ExtractionInput): void {
    if (this.stopped || !application.get('PreferenceService').get(GENERATION_KEY)) return
    try {
      const resolved = readExtractionSource(input, true)
      const source: ExtractionTicket = {
        input,
        entityKey: resolved.entityKey,
        key: resolved.key,
        messageId: resolved.messageId,
        createdAt: resolved.createdAt,
        hash: resolved.hash
      }
      if (
        source.createdAt <=
        Math.max(
          this.extractionBoundary,
          this.sourceBoundaries.get(source.entityKey) ?? 0,
          this.sourceBoundaries.get(source.key) ?? 0
        )
      )
        return
      try {
        source.contextHash = this.readRecentContext(source).hash
      } catch (error) {
        if (!(error instanceof DreamingError && error.reason === 'budget')) throw error
      }
      const firstPending = readExtractionState(source.key)?.pending[0]?.messageId ?? source.messageId
      if (!enqueueExtraction(source, this.extractionBoundary, extractionBranch(input, firstPending))) return
      this.wake()
    } catch {
      // Ineligible or deleted conversations are not extraction sources.
    }
  }

  private readRecentContext(ticket: ExtractionTicket, admittedTurns?: ReadonlySet<string>) {
    const state = readExtractionState(ticket.key)
    return readExtractionRange(
      { source: ticket.input, fromMessageId: '' },
      Math.max(
        this.extractionBoundary,
        this.sourceBoundaries.get(ticket.entityKey) ?? 0,
        this.sourceBoundaries.get(ticket.key) ?? 0,
        extractionBoundary(ticket.key),
        extractionBoundary(ticket.entityKey),
        state?.boundary ?? 0
      ),
      true,
      state?.excludedThrough,
      new Set(state?.editedTurns),
      admittedTurns
    )
  }

  private readBatch(state: ExtractionState) {
    const end = state.pending.findIndex((item) => item.messageId === state.batchEnd)
    if (end < 0) throw new DreamingError('conflict')
    const ticket = state.pending[end]
    const context = this.readRecentContext(ticket)
    const source =
      context.hash === ticket.contextHash
        ? context
        : this.readRecentContext(ticket, new Set(state.pending.slice(0, end + 1).map((item) => item.messageId)))
    const included = new Set(source.messages.filter((message) => message.role === 'user').map((message) => message.id))
    const skippedBudget = state.pending.slice(0, end + 1).filter((item) => !included.has(item.messageId)).length
    return { source, ticket, skippedBudget }
  }

  private async extract(
    pending: { key: string; state: ExtractionState },
    ctx: JobContext<Record<string, never>>
  ): Promise<unknown> {
    let batch: ReturnType<MemoryDreamingService['readBatch']>
    const end = pending.state.pending.findIndex((ticket) => ticket.messageId === pending.state.batchEnd)
    const tickets = pending.state.pending.slice(0, end + 1)
    try {
      if (!tickets.length) throw new DreamingError('conflict')
      const first = tickets[0]
      const selected = extractionBranch(first.input, first.messageId, false)
      const invalid: string[] = []
      for (const ticket of tickets) {
        if (!selected.has(ticket.input.responseId)) {
          invalid.push(ticket.messageId)
          continue
        }
        try {
          if (readExtractionSource(ticket.input, true).hash !== ticket.hash) {
            invalid.push(ticket.messageId)
            if (!pending.state.editedTurns.includes(ticket.messageId)) pending.state.editedTurns.push(ticket.messageId)
          }
        } catch (error) {
          if (!(error instanceof InvalidExtractionSource)) throw error
          invalid.push(ticket.messageId)
        }
      }
      if (invalid.length) {
        writeExtractionState(pending.key, pending.state)
        const skippedSource = skipExtractionTurns(pending.key, invalid, 'source')
        pending.state = readExtractionState(pending.key)!
        if (!pending.state.batchEnd) return { saved: 0, skippedSource }
      }
      batch = this.readBatch(pending.state)
    } catch (error) {
      if (error instanceof InvalidExtractionSource) {
        const skippedSource = skipExtractionTurns(
          pending.key,
          tickets.map((ticket) => ticket.messageId),
          'source'
        )
        return { saved: 0, skippedSource }
      }
      if (error instanceof DreamingError && error.reason === 'budget' && pending.state.batchEnd) {
        skipExtractionTurn(pending.key, pending.state.batchEnd)
        return { saved: 0, skippedBudget: 1 }
      }
      deferExtraction(pending.key, false, error instanceof DreamingError ? error.reason : 'unavailable')
      throw error
    }
    const { ticket, source } = batch
    writeExtractionState(pending.key, pending.state)
    const scope = { kind: 'shared' } as const
    const controller = new AbortController()
    const abort = () => controller.abort(ctx.signal.reason)
    ctx.signal.addEventListener('abort', abort, { once: true })
    this.active = { scope, controller, extraction: ticket }
    const generation = readDreamingState(scope).generation
    let session: MemorySession | undefined
    let revoke: { dispose(): void } | undefined
    const assertCurrent = (): undefined => {
      ctx.signal.throwIfAborted()
      controller.signal.throwIfAborted()
      this.assertScope(scope)
      if (!application.get('PreferenceService').get(GENERATION_KEY))
        throw new DOMException('Memory generation is disabled', 'AbortError')
      if (this.foregroundBusy()) throw new DOMException('Foreground work started', 'AbortError')
      const current = readExtractionState(ticket.key)
      if (
        !current?.pending.some((item) => item.messageId === ticket.messageId) ||
        current.batchEnd !== pending.state.batchEnd ||
        current.pending[0].messageId !== pending.state.pending[0].messageId ||
        this.readBatch(current).source.hash !== source.hash ||
        !extractionBranch(ticket.input, source.messages[0].id).has(source.messages[0].id)
      )
        throw new DreamingError('conflict')
      return undefined
    }
    try {
      assertCurrent()
      revoke = source.source.authority.onRevoked?.(() => controller.abort('source-revoked'))
      session = application.get('MemoryService').open(
        { scope, assertAuthorized: assertCurrent },
        'extraction',
        source.messages.map((message) => ({
          kind: ticket.input.kind === 'assistant' ? 'chat' : 'agent',
          conversationId: ticket.input.kind === 'assistant' ? ticket.input.topicId : ticket.input.sessionId,
          messageId: message.id,
          sourceVersion: message.version
        }))
      )
      const paths = await session.list()
      if (paths.length > 40) throw new DreamingError('budget')
      const files: MemoryRead[] = []
      let bytes = 0
      for (const path of paths) {
        const file = await session.read(path)
        // A filtered view cannot authorize an append over protected entry metadata.
        if (!file.receipt) throw new DreamingError('conflict')
        bytes += Buffer.byteLength(file.content ?? '', 'utf8')
        if (bytes > 32_000) throw new DreamingError('budget')
        files.push(file)
      }
      const entry = files.find((file) => file.path === MEMORY_ENTRY)
      if (!entry) throw new DreamingError('conflict')
      const start = readDreamingState(scope)
      start.status = 'running'
      start.lastRunAt = Date.now()
      start.reason = undefined
      writeDreamingState(start)
      const prepared = pending.state.prepared
      const unfinished = new Set<string>()
      if (prepared) {
        const sameSource = prepared.sourceHash === source.hash && prepared.end === ticket.messageId
        const expected = prepared.files ?? [{ path: MEMORY_ENTRY, before: prepared.before, after: prepared.after }]
        const allAfter = expected.every((item) => files.find((file) => file.path === item.path)?.hash === item.after)
        if (sameSource && allAfter) {
          completeExtraction(ticket.key, ticket.messageId, 'completed', batch.skippedBudget)
          start.status = 'idle'
          start.lastResult = { outcome: 'completed', finishedAt: Date.now() }
          writeDreamingState(start)
          return { recovered: true, saved: 0 }
        }
        const knownVersions = expected.every((item) => {
          const hash = files.find((file) => file.path === item.path)?.hash
          if (hash === item.before && hash !== item.after) unfinished.add(item.path)
          return hash === item.before || hash === item.after
        })
        if (
          !knownVersions ||
          (!sameSource && expected.some((item) => files.find((file) => file.path === item.path)?.hash !== item.before))
        ) {
          const end = pending.state.pending.findIndex((item) => item.messageId === ticket.messageId)
          const skippedConflict = skipExtractionTurns(
            ticket.key,
            pending.state.pending.slice(0, end + 1).map((item) => item.messageId),
            'conflict'
          )
          start.status = 'failed'
          start.reason = 'conflict'
          start.lastResult = { outcome: 'failed', finishedAt: Date.now(), reason: 'conflict' }
          writeDreamingState(start)
          return { saved: 0, skippedConflict }
        }
      }
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const proposal = await extractContextCandidates(source, files, controller.signal, async () => {
        await session!.validateModelReads()
        return assertCurrent()
      })
      proposal.candidates = proposal.candidates.map((candidate) => ({
        ...candidate,
        text: anchorMemoryTime(candidate, source.messages, timeZone)
      }))
      const additions = [
        ...new Set(
          proposal.candidates
            .filter((candidate) => candidate.action === 'add' && candidate.scope === 'personal')
            .map((candidate) => candidate.text)
        )
      ].filter(
        (text) => !files.some((file) => file.content?.includes(text) || file.content?.includes(JSON.stringify(text)))
      )
      const original = entry.content ?? ''
      const content = additions.length
        ? `${original}${original.endsWith('\n') || !original ? '' : '\n'}${additions.map((text) => `- ${JSON.stringify(text)}`).join('\n')}\n`
        : original
      const corrections = proposal.candidates.filter(
        (candidate) => candidate.action === 'correct' && candidate.scope === 'personal'
      )
      const planned: Array<{ file: MemoryRead; mutation: MemoryMutation & { content: string } }> = []
      for (const file of files) {
        const revisions = new Map<string, MemoryRevision>()
        for (const candidate of corrections) {
          for (const reference of candidate.existing.filter((reference) => reference.path === file.path)) {
            const previous = revisions.get(reference.quote)
            if (previous && previous.text !== candidate.text) throw new DreamingError('output')
            revisions.set(reference.quote, {
              quote: reference.quote,
              text: candidate.text,
              reason: candidate.correction!,
              recordedAt: new Date(
                Math.max(
                  ...candidate.evidence.map(
                    (evidence) => source.messages.find((message) => message.id === evidence.messageId)!.createdAt
                  )
                )
              ).toISOString(),
              sources: candidate.evidence.map((evidence) => ({
                kind: ticket.input.kind === 'assistant' ? 'chat' : 'agent',
                conversationId: ticket.input.kind === 'assistant' ? ticket.input.topicId : ticket.input.sessionId,
                messageId: evidence.messageId,
                sourceVersion: evidence.version
              }))
            })
          }
        }
        if (revisions.size)
          planned.push({
            file,
            mutation: await session.prepareRevisions(
              file.receipt,
              [...revisions.values()],
              file.path === MEMORY_ENTRY ? additions : []
            )
          })
        else if (file.path === MEMORY_ENTRY && content !== original)
          planned.push({ file, mutation: { kind: 'write', receipt: file.receipt, content } })
      }
      if (
        prepared?.files &&
        prepared.files.some(
          (item) => item.after !== item.before && files.find((file) => file.path === item.path)?.hash === item.after
        ) &&
        [...unfinished].some((target) => !planned.some(({ file }) => file.path === target))
      )
        throw new DreamingError('output')
      await session.validateModelReads()
      assertCurrent()
      const progress = readExtractionState(ticket.key)!
      const fileVersions = planned.map(({ file, mutation }) => ({
        path: file.path,
        before: file.hash,
        after: memoryHash(Buffer.from(mutation.content))
      }))
      progress.prepared = {
        end: ticket.messageId,
        sourceHash: source.hash,
        before: entry.hash,
        after: memoryHash(
          Buffer.from(planned.find(({ file }) => file.path === MEMORY_ENTRY)?.mutation.content ?? original)
        ),
        files: fileVersions,
        through: prepared?.through
      }
      writeExtractionState(ticket.key, progress)
      const clearPrepared = () => {
        const current = readExtractionState(ticket.key)
        if (current?.prepared?.end === ticket.messageId && current.prepared.sourceHash === source.hash) {
          current.prepared = undefined
          writeExtractionState(ticket.key, current)
        }
      }
      let result: MemoryCommitResult
      try {
        result = await session.commit(
          planned.map(({ mutation }) => mutation),
          async () => assertCurrent,
          files.map((file) => file.receipt),
          undefined,
          paths
        )
      } catch (error) {
        // MemoryStore returns per-file outcomes once writes start; rejection precedes the write phase.
        clearPrepared()
        throw error
      }
      const applied = result.files.some((file) => file.outcome === 'applied')
      if (result.files.some((file) => file.outcome === 'conflict' || file.outcome === 'pending'))
        throw new DreamingError('conflict')
      if (result.error && !applied) {
        clearPrepared()
        throw new DreamingError('conflict')
      }
      if (
        fileVersions.some(
          (expected) =>
            (result.files.find((file) => file.path === expected.path)?.hash ?? expected.before) !== expected.after
        )
      )
        throw new DreamingError('conflict')
      completeExtraction(
        ticket.key,
        ticket.messageId,
        proposal.batches.map(({ outcome }) => outcome).join(','),
        batch.skippedBudget
      )
      const latest = readDreamingState(scope)
      if (latest.generation === generation) {
        latest.status = result.error ? 'failed' : 'idle'
        latest.reason = result.error ? 'backup' : undefined
        latest.lastResult = {
          outcome: result.error ? 'failed' : 'completed',
          finishedAt: Date.now(),
          ...(result.error ? { reason: 'backup' as const } : {})
        }
        writeDreamingState(latest)
      }
      return {
        extracted: result.files.filter((file) => file.outcome === 'applied').length,
        saved: additions.length + corrections.length,
        ...(result.error ? { warning: result.error } : {}),
        skippedBudget: batch.skippedBudget,
        outcomes: proposal.candidates.map(({ action }) => action),
        batches: proposal.batches
      }
    } catch (error) {
      const timedOut = ctx.signal.reason instanceof Error && ctx.signal.reason.name === 'JobHandlerTimeoutError'
      const cancelled =
        !timedOut &&
        (controller.signal.aborted ||
          ctx.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError'))
      deferExtraction(ticket.key, cancelled, error instanceof DreamingError ? error.reason : 'unavailable')
      const latest = readDreamingState(scope)
      if (latest.generation === generation) {
        latest.status = cancelled ? 'cancelled' : 'failed'
        latest.reason =
          error instanceof DreamingError
            ? error.reason
            : error instanceof MemoryError && error.code === 'backup-capacity'
              ? 'backup'
              : error instanceof MemoryError && error.code === 'limit'
                ? 'budget'
                : 'unavailable'
        latest.lastResult = {
          outcome: cancelled ? 'cancelled' : 'failed',
          finishedAt: Date.now(),
          reason: latest.reason
        }
        writeDreamingState(latest)
      }
      throw cancelled
        ? new DOMException('Memory extraction interrupted', 'AbortError')
        : new DreamingError(latest.reason ?? 'unavailable')
    } finally {
      revoke?.dispose()
      session?.dispose()
      ctx.signal.removeEventListener('abort', abort)
      this.active = undefined
    }
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
    const attempts = new Map<string, number>()
    let attempted = false
    let inputs: MemoryRead[] = []
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
        if (bytes <= 50_000) inputs.push(read)
      }
      let latest = readDreamingState(scope)
      inputs = inputs.filter(
        (read) =>
          read.path === MEMORY_ENTRY ||
          (latest.files[read.path].attempts < 2 && latest.files[read.path].retryAt <= Date.now())
      )
      if (latest.files[MEMORY_ENTRY].attempts >= 2 && latest.files[MEMORY_ENTRY].reason === 'budget')
        return { deferred: true }
      if (!start.manual && !inputs.some((read) => needsDreaming(latest.files[read.path], Date.now())))
        return { scanned: inputs.length }
      if (!inputs.some((read) => latest.files[read.path].attempts < 2 && latest.files[read.path].retryAt <= Date.now()))
        return { deferred: true }
      const empty = inputs.every((read) => !read.content?.trim())
      const resolved = empty ? undefined : await resolveDreamingModel()
      const batch = resolved ? fitDreamingInputs(inputs, resolved) : undefined
      if (batch) {
        assertCurrent()
        inputs = batch.inputs
        latest = readDreamingState(scope)
        for (const read of batch.unfit) {
          const file = latest.files[read.path]
          if (file.observedHash !== read.hash) continue
          file.attempts = 2
          file.reason = 'budget'
        }
        writeDreamingState(latest)
      }
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
          attempts.set(read.path, latest.files[read.path].attempts)
          latest.files[read.path].attempts++
          latest.files[read.path].retryAt = Date.now() + 10 * 60_000
        }
        writeDreamingState(latest)
        attempted = true
      }
      await session.validateModelReads()
      const text =
        batch && resolved
          ? await generateDreamingPlan(ctx.jobId, resolved, batch, controller.signal)
          : '{"writes":[],"deletes":[]}'
      await session.validateModelReads()
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
      latest.lastResult = { outcome: 'completed', finishedAt: latest.lastRunAt }
      writeDreamingState(latest)
      return {
        scope: memoryScopeKey(scope),
        checked,
        changed: result.files.filter((file) => file.outcome === 'applied').length
      }
    } catch (error) {
      const timedOut = ctx.signal.reason instanceof Error && ctx.signal.reason.name === 'JobHandlerTimeoutError'
      const interrupted = !timedOut && (controller.signal.aborted || ctx.signal.aborted)
      const latest = readDreamingState(scope)
      if (latest.generation === generation) {
        if (error instanceof DreamingError)
          for (const read of error.unfit) {
            const file = latest.files[read.path]
            if (file?.observedHash !== read.hash) continue
            file.attempts = 2
            file.reason = 'budget'
          }
        const preempted = controller.signal.reason === 'foreground' && !ctx.signal.aborted
        if (preempted && attempted) {
          for (const read of inputs) {
            const file = latest.files[read.path]
            const previous = attempts.get(read.path)
            if (
              previous === undefined ||
              file?.observedHash !== read.hash ||
              file.revision !== revisions.get(read.path)
            )
              continue
            if (file.attempts !== previous + 1) continue
            file.attempts = previous
            file.retryAt = Date.now() + 60_000
          }
          if (start.manual && latest.manualAttempts === start.manualAttempts + 1)
            latest.manualAttempts = start.manualAttempts
          attempted = false
        }
        const retryable =
          attempted && latest.manualAttempts < 2 && inputs.some((read) => (latest.files[read.path]?.attempts ?? 2) < 2)
        latest.manual = start.manual && (preempted || retryable)
        if (ctx.signal.aborted && !timedOut) {
          latest.generation++
          latest.manual = false
          latest.cancelled = true
        }
        latest.lastScanAt = Date.now()
        latest.status = interrupted ? (latest.manual ? 'queued' : 'cancelled') : 'failed'
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
        latest.lastResult = {
          outcome: interrupted ? 'cancelled' : 'failed',
          finishedAt: Date.now(),
          reason: latest.reason
        }
        if (attempted)
          for (const read of inputs) {
            const file = latest.files[read.path]
            if (file && file.pendingSince !== undefined) file.reason = latest.reason
          }
        writeDreamingState(latest)
      }
      if (interrupted) throw new DOMException('Memory organization interrupted', 'AbortError')
      logger.warn('Memory organization did not complete', { scope: memoryScopeKey(scope), reason: latest.reason })
      throw new DreamingError(latest.reason ?? 'unavailable')
    } finally {
      session?.dispose()
      ctx.signal.removeEventListener('abort', abort)
      this.active = undefined
    }
  }
}
