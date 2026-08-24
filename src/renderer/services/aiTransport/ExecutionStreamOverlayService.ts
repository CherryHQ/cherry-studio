import { loggerService } from '@logger'
import {
  ConversationActiveNodeMove,
  type ConversationExecutionId,
  type ConversationRef,
  conversationRefKey,
  type ConversationTurnId
} from '@shared/ai/conversation'
import type { ActiveNodeDecision, ConversationExecutionProjection } from '@shared/ai/transport'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { isToolUIPart, readUIMessageStream, type UIMessageChunk } from 'ai'

import {
  ConversationStreamRecoveryDisposition,
  ConversationStreamRecoveryReason,
  type ConversationStreamRecoveryRequest,
  ConversationStreamSubscription,
  type ExecutionTerminal
} from './ConversationStreamSubscription'
import { projectActiveExecutions } from './executionProjection'

const logger = loggerService.withContext('ExecutionStreamOverlayService')

export interface ExecutionFinishEvent {
  turnId: ConversationTurnId
  executionId: ConversationExecutionId
  message: CherryUIMessage
  isAbort: boolean
  isError: boolean
}

export enum ExecutionOverlayPhase {
  Active = 'active',
  Settled = 'settled'
}

export interface ExecutionOverlayRecord {
  turnId: ConversationTurnId
  executionId: ConversationExecutionId
  phase: ExecutionOverlayPhase
  message: CherryUIMessage
  isAbort: boolean
  isError: boolean
}

export interface ExecutionOverlayActiveNodeOverride {
  previousActiveNodeId: string | null
  activeNodeId: string
}

export interface ExecutionOverlayView {
  overlay: Record<string, CherryMessagePart[]>
  liveAssistants: CherryUIMessage[]
  records: ExecutionOverlayRecord[]
  optimisticMessages: CherryUIMessage[]
  projectedExecutions: ConversationExecutionProjection[]
  activeNodeOverride: ExecutionOverlayActiveNodeOverride | null
  refreshError: Error | null
}

type FinishListener = (executionId: ConversationExecutionId, event: ExecutionFinishEvent) => void

interface ReaderHandle {
  readonly branch: ReadableStream<UIMessageChunk>
  readonly execution: ConversationExecutionProjection
  readonly seedFromEmpty: boolean | undefined
  readonly getSeedMessages: () => CherryUIMessage[]
  cancel: () => void
  unregister: () => void
}

interface PendingSnapshot {
  epoch: number
  readerVersion: number
  snapshot: CherryUIMessage
}

interface ConsumerContribution {
  executions: readonly ConversationExecutionProjection[]
  getSeedMessages: () => CherryUIMessage[]
}

interface ExecutionCandidate {
  execution: ConversationExecutionProjection
  seedFromEmpty?: boolean
  seed: ConsumerContribution
}

interface Settlement {
  turnId: ConversationTurnId
  isAbort: boolean
  isError: boolean
}

interface HandoffState {
  pendingTurnIds: Set<ConversationTurnId>
  retireRecoveries: Map<string, ConversationStreamRecoveryRequest>
  retryRecoveries: Map<string, ConversationStreamRecoveryRequest>
  attempt: number
  retryTimer: number | null
  inFlight: boolean
}

export enum ConversationOverlayDurability {
  Durable = 'durable',
  Ephemeral = 'ephemeral'
}

export type ConversationOverlayRecoveryBinding =
  | {
      readonly durability: ConversationOverlayDurability.Durable
      readonly refresh: () => Promise<unknown>
    }
  | {
      readonly durability: ConversationOverlayDurability.Ephemeral
    }

interface Entry {
  conversation: ConversationRef
  key: string
  sub: ConversationStreamSubscription
  dropped: boolean
  refCount: number
  desired: Map<object, ConsumerContribution>
  optimisticMessages: Map<string, CherryUIMessage>
  optimisticMessageTurnIds: Map<string, ConversationTurnId>
  optimisticExecutions: Map<ConversationExecutionId, ConversationExecutionProjection>
  optimisticSeeds: Map<ConversationExecutionId, () => CherryUIMessage[]>
  activeNodeOverride: ExecutionOverlayActiveNodeOverride | null
  refreshError: Error | null
  durability: ConversationOverlayDurability
  refreshPorts: Set<() => Promise<unknown>>
  notFoundTombstones: Map<ConversationExecutionId, ConversationTurnId>
  handoff: HandoffState | null
  snapshots: Map<ConversationExecutionId, CherryUIMessage>
  settlements: Map<ConversationExecutionId, Settlement>
  view: ExecutionOverlayView
  pendingSnapshots: Map<ConversationExecutionId, PendingSnapshot>
  readerVersions: Map<ConversationExecutionId, number>
  readers: Map<ConversationExecutionId, ReaderHandle>
  liveReaderCount: number
  epoch: number
  commitTimer: number | null
  commitDeadline: number | null
  lastCommitAt: number
  listeners: Set<() => void>
  finishListeners: Set<FinishListener>
  lastActiveAt: number
  needsRemountReconcile: boolean
}

const MAX_ENTRIES = 32
const HANDOFF_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000]
const MIN_COMMIT_INTERVAL_MS = 100
const MAX_COMMIT_INTERVAL_MS = 3000
const COMMIT_CHARS_PER_MS = 2000

function assertNever(value: never): never {
  throw new Error(`Unhandled Conversation overlay variant: ${String(value)}`)
}

const EMPTY_VIEW: ExecutionOverlayView = Object.freeze({
  overlay: Object.freeze({}),
  liveAssistants: Object.freeze([]) as unknown as CherryUIMessage[],
  records: Object.freeze([]) as unknown as ExecutionOverlayRecord[],
  optimisticMessages: Object.freeze([]) as unknown as CherryUIMessage[],
  projectedExecutions: Object.freeze([]) as unknown as ConversationExecutionProjection[],
  activeNodeOverride: null,
  refreshError: null
})

function commitIntervalMs(pending: Iterable<PendingSnapshot>): number {
  let chars = 0
  for (const item of pending) {
    for (const part of item.snapshot.parts ?? []) {
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string') chars += text.length
    }
  }
  return Math.min(MAX_COMMIT_INTERVAL_MS, Math.max(MIN_COMMIT_INTERVAL_MS, chars / COMMIT_CHARS_PER_MS))
}

function pickSeed(
  uiMessages: CherryUIMessage[],
  outputNodeId?: string,
  seedFromEmpty = false
): CherryUIMessage | undefined {
  if (!outputNodeId) return undefined
  if (seedFromEmpty) return { id: outputNodeId, role: 'assistant', parts: [] } as CherryUIMessage
  const found = uiMessages.find((message) => message.id === outputNodeId)
  if (!found) return { id: outputNodeId, role: 'assistant', parts: [] } as CherryUIMessage
  return { ...found, parts: structuredClone(found.parts ?? []) }
}

function canReuseSettledPart(previous: CherryMessagePart, next: CherryMessagePart): boolean {
  if (previous.type !== next.type) return false
  if (previous.type === 'text' && next.type === 'text') {
    return previous.state !== 'streaming' && next.state !== 'streaming' && previous.text === next.text
  }
  if (previous.type === 'reasoning' && next.type === 'reasoning') {
    return previous.state !== 'streaming' && next.state !== 'streaming' && previous.text === next.text
  }
  if (isToolUIPart(previous) && isToolUIPart(next)) {
    const before = previous as unknown as { preliminary?: boolean; state?: string; toolCallId?: string }
    const after = next as unknown as { preliminary?: boolean; state?: string; toolCallId?: string }
    if (before.toolCallId !== after.toolCallId || before.state !== after.state) return false
    if (before.state === 'output-available') return before.preliminary !== true && after.preliminary !== true
    return before.state === 'output-error' || before.state === 'output-denied' || before.state === 'cancelled'
  }
  return (
    previous.type === 'file' ||
    previous.type === 'source-url' ||
    previous.type === 'source-document' ||
    previous.type === 'step-start'
  )
}

function shareSettledPartReferences(
  previous: CherryMessagePart[] | undefined,
  next: CherryMessagePart[]
): CherryMessagePart[] {
  if (!previous?.length || next.length === 0) return next
  let reusedAny = false
  let reusedAll = previous.length === next.length
  const shared = next.map((part, index) => {
    const previousPart = previous[index]
    if (previousPart === part || (previousPart && canReuseSettledPart(previousPart, part))) {
      reusedAny = true
      return previousPart
    }
    reusedAll = false
    return part
  })
  if (reusedAll) return previous
  return reusedAny ? shared : next
}

function sameExecutionContribution(
  previous: readonly ConversationExecutionProjection[] | undefined,
  next: readonly ConversationExecutionProjection[]
): boolean {
  if (!previous || previous.length !== next.length) return false
  return next.every((execution, index) => {
    const before = previous[index]
    return (
      before.turnId === execution.turnId &&
      before.executionId === execution.executionId &&
      before.modelId === execution.modelId &&
      before.outputNodeId === execution.outputNodeId &&
      before.seedFromEmpty === execution.seedFromEmpty
    )
  })
}

function sameOverlayView(left: ExecutionOverlayView, right: ExecutionOverlayView): boolean {
  const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
    a.length === b.length && a.every((item, index) => item === b[index])
  const leftOverlayKeys = Object.keys(left.overlay)
  return (
    left.activeNodeOverride === right.activeNodeOverride &&
    left.refreshError === right.refreshError &&
    leftOverlayKeys.length === Object.keys(right.overlay).length &&
    leftOverlayKeys.every((key) => left.overlay[key] === right.overlay[key]) &&
    sameList(left.liveAssistants, right.liveAssistants) &&
    sameList(left.records, right.records) &&
    sameList(left.optimisticMessages, right.optimisticMessages) &&
    sameList(left.projectedExecutions, right.projectedExecutions)
  )
}

function computeView(
  snapshots: ReadonlyMap<ConversationExecutionId, CherryUIMessage>,
  settlements: ReadonlyMap<ConversationExecutionId, Settlement>,
  executions: ReadonlyMap<ConversationExecutionId, ConversationExecutionProjection>,
  optimisticMessages: ReadonlyMap<string, CherryUIMessage>,
  projectedExecutions: ConversationExecutionProjection[],
  activeNodeOverride: ExecutionOverlayActiveNodeOverride | null,
  refreshError: Error | null
): ExecutionOverlayView {
  const overlay: Record<string, CherryMessagePart[]> = {}
  for (const snapshot of snapshots.values()) {
    if (snapshot.parts?.length) overlay[snapshot.id] = snapshot.parts as CherryMessagePart[]
  }
  const records = [...snapshots].flatMap(([executionId, message]) => {
    if (message.role !== 'assistant') return []
    const settlement = settlements.get(executionId)
    const execution = executions.get(executionId)
    const turnId = settlement?.turnId ?? execution?.turnId
    if (!turnId) return []
    return [
      {
        turnId,
        executionId,
        phase: settlement ? ExecutionOverlayPhase.Settled : ExecutionOverlayPhase.Active,
        message,
        isAbort: settlement?.isAbort ?? false,
        isError: settlement?.isError ?? false
      }
    ]
  })
  return {
    overlay,
    liveAssistants: [...snapshots.values()].filter((message) => message.role === 'assistant'),
    records,
    optimisticMessages: [...optimisticMessages.values()],
    projectedExecutions,
    activeNodeOverride,
    refreshError
  }
}

export class ExecutionStreamOverlayService {
  readonly #entries = new Map<string, Entry>()

  acquire(conversation: ConversationRef): void {
    const entry = this.#getOrCreate(conversation)
    entry.refCount += 1
    entry.lastActiveAt = Date.now()
    this.#flushPending(entry, entry.epoch)
  }

  release(conversation: ConversationRef, consumer: object): void {
    const entry = this.#entries.get(conversationRefKey(conversation))
    if (!entry) return
    entry.desired.delete(consumer)
    entry.refCount = Math.max(0, entry.refCount - 1)
    if (entry.refCount === 0) entry.needsRemountReconcile = true
    this.#maybeDrop(entry)
  }

  syncExecutions(
    conversation: ConversationRef,
    consumer: object,
    executions: readonly ConversationExecutionProjection[],
    getSeedMessages: () => CherryUIMessage[]
  ): void {
    const entry = this.#entries.get(conversationRefKey(conversation))
    if (!entry) return
    const previous = entry.desired.get(consumer)?.executions
    entry.desired.set(consumer, { executions, getSeedMessages })

    const candidates = new Map<ConversationExecutionId, ExecutionCandidate>()
    for (const [executionId, execution] of entry.optimisticExecutions) {
      const getOptimisticSeed = entry.optimisticSeeds.get(executionId)
      if (!getOptimisticSeed) continue
      candidates.set(executionId, {
        execution,
        seedFromEmpty: execution.seedFromEmpty,
        seed: { executions: [execution], getSeedMessages: getOptimisticSeed }
      })
    }
    for (const contribution of entry.desired.values()) {
      for (const execution of contribution.executions) {
        const existing = candidates.get(execution.executionId)
        if (!existing) {
          candidates.set(execution.executionId, {
            execution,
            seedFromEmpty: execution.seedFromEmpty,
            seed: contribution
          })
        } else if (execution.seedFromEmpty && !existing.seedFromEmpty) {
          candidates.set(execution.executionId, { ...existing, seedFromEmpty: true })
        }
      }
    }
    const union = new Map<ConversationExecutionId, ExecutionCandidate>()
    for (const execution of projectActiveExecutions([...candidates.values()].map(({ execution }) => execution))) {
      const candidate = candidates.get(execution.executionId)
      if (candidate) union.set(execution.executionId, candidate)
    }
    for (const [executionId, turnId] of entry.notFoundTombstones) {
      const candidate = union.get(executionId)
      if (!candidate || candidate.execution.turnId !== turnId) {
        entry.notFoundTombstones.delete(executionId)
      } else {
        union.delete(executionId)
      }
    }

    if (entry.needsRemountReconcile) {
      entry.needsRemountReconcile = false
      const liveExecutionIds = new Set([...union.keys(), ...entry.readers.keys()])
      let next = entry.snapshots
      for (const executionId of entry.snapshots.keys()) {
        if (liveExecutionIds.has(executionId)) continue
        entry.sub.retireExecution(executionId)
        entry.pendingSnapshots.delete(executionId)
        entry.settlements.delete(executionId)
        entry.readerVersions.delete(executionId)
        if (next === entry.snapshots) next = new Map(entry.snapshots)
        next.delete(executionId)
      }
      this.#commitSnapshots(entry, next)
    }

    for (const [executionId, handle] of [...entry.readers]) {
      if (union.has(executionId) || !entry.sub.isSettled(executionId)) continue
      handle.cancel()
      handle.unregister()
      entry.readers.delete(executionId)
      entry.readerVersions.delete(executionId)
    }
    for (const [executionId, candidate] of union) {
      if (entry.readers.has(executionId) || entry.sub.isSettled(executionId)) continue
      this.#startReader(entry, candidate.execution, candidate.seedFromEmpty, candidate.seed.getSeedMessages)
    }
    if (!sameExecutionContribution(previous, executions)) this.#publishView(entry)
  }

  subscribe(conversation: ConversationRef, listener: () => void): () => void {
    const entry = this.#entries.get(conversationRefKey(conversation))
    if (!entry) return () => {}
    entry.listeners.add(listener)
    return () => entry.listeners.delete(listener)
  }

  getView(conversation: ConversationRef): ExecutionOverlayView {
    return this.#entries.get(conversationRefKey(conversation))?.view ?? EMPTY_VIEW
  }

  seedReservations(
    conversation: ConversationRef,
    messages: readonly CherryUIMessage[],
    executions: readonly ConversationExecutionProjection[],
    activeNodeDecision: ActiveNodeDecision | undefined,
    previousActiveNodeId: string | null,
    getSeedMessages: () => CherryUIMessage[]
  ): void {
    const entry = this.#entries.get(conversationRefKey(conversation))
    if (!entry) return
    const turnId = executions[0]?.turnId
    for (const message of messages) {
      entry.optimisticMessages.set(message.id, message)
      if (turnId) entry.optimisticMessageTurnIds.set(message.id, turnId)
    }
    for (const execution of executions) {
      entry.optimisticExecutions.set(execution.executionId, execution)
      entry.optimisticSeeds.set(execution.executionId, getSeedMessages)
      if (!entry.readers.has(execution.executionId) && !entry.sub.isSettled(execution.executionId)) {
        this.#startReader(entry, execution, execution.seedFromEmpty, getSeedMessages)
      }
    }
    if (activeNodeDecision?.move !== ConversationActiveNodeMove.Keep) {
      const activeNodeId = messages.at(-1)?.id
      if (activeNodeId) entry.activeNodeOverride = { previousActiveNodeId, activeNodeId }
    }
    this.#publishView(entry)
  }

  onFinish(conversation: ConversationRef, listener: FinishListener): () => void {
    const entry = this.#entries.get(conversationRefKey(conversation))
    if (!entry) return () => {}
    entry.finishListeners.add(listener)
    return () => entry.finishListeners.delete(listener)
  }

  registerRecoveryPort(conversation: ConversationRef, binding: ConversationOverlayRecoveryBinding): () => void {
    const entry = this.#entries.get(conversationRefKey(conversation))
    if (!entry) return () => {}
    if (binding.durability === ConversationOverlayDurability.Ephemeral) return () => {}
    entry.durability = ConversationOverlayDurability.Durable
    const refresh = binding.refresh
    entry.refreshPorts.add(refresh)
    if (entry.handoff && !entry.handoff.inFlight) {
      this.#clearHandoffTimer(entry)
      this.#runHandoffRefresh(entry)
    }
    return () => entry.refreshPorts.delete(refresh)
  }

  setRefreshError(conversation: ConversationRef, error: Error | null): void {
    const entry = this.#entries.get(conversationRefKey(conversation))
    if (!entry || entry.refreshError === error) return
    entry.refreshError = error
    this.#publishView(entry)
  }

  disposeOverlay(conversation: ConversationRef, messageId: string): void {
    const entry = this.#entries.get(conversationRefKey(conversation))
    if (!entry) return
    const snapshot = [...entry.snapshots].find(([, value]) => value.id === messageId)
    const pending = [...entry.pendingSnapshots].find(([, value]) => value.snapshot.id === messageId)
    const executionId = snapshot?.[0] ?? pending?.[0]
    if (!executionId || entry.readers.has(executionId)) return
    const settlement = entry.settlements.get(executionId)
    if (settlement) this.#beginHandoff(entry, settlement.turnId)
  }

  reset(conversation: ConversationRef): void {
    const entry = this.#entries.get(conversationRefKey(conversation))
    if (!entry) return
    const settledTurnIds = new Set([...entry.settlements.values()].map(({ turnId }) => turnId))
    for (const turnId of settledTurnIds) this.#beginHandoff(entry, turnId)
  }

  clear(conversation: ConversationRef): void {
    const entry = this.#entries.get(conversationRefKey(conversation))
    if (!entry) return
    this.#clearHandoffTimer(entry)
    entry.handoff = null
    this.#invalidatePending(entry)
    for (const handle of entry.readers.values()) {
      handle.cancel()
      handle.unregister()
    }
    for (const executionId of new Set([
      ...entry.snapshots.keys(),
      ...entry.pendingSnapshots.keys(),
      ...entry.settlements.keys(),
      ...entry.optimisticExecutions.keys(),
      ...entry.readers.keys()
    ])) {
      entry.sub.retireExecution(executionId)
    }
    entry.readers.clear()
    entry.readerVersions.clear()
    entry.settlements.clear()
    entry.optimisticMessages.clear()
    entry.optimisticMessageTurnIds.clear()
    entry.optimisticExecutions.clear()
    entry.optimisticSeeds.clear()
    entry.notFoundTombstones.clear()
    entry.activeNodeOverride = null
    entry.refreshError = null
    if (entry.snapshots.size > 0) this.#commitSnapshots(entry, new Map())
    else this.#publishView(entry)
  }

  #beginHandoff(entry: Entry, turnId: ConversationTurnId): void {
    if (entry.handoff) {
      entry.handoff.pendingTurnIds.add(turnId)
      entry.handoff.attempt = 0
      if (entry.handoff.inFlight) return
      this.#clearHandoffTimer(entry)
    } else {
      entry.handoff = {
        pendingTurnIds: new Set([turnId]),
        retireRecoveries: new Map(),
        retryRecoveries: new Map(),
        attempt: 0,
        retryTimer: null,
        inFlight: false
      }
    }
    this.#runHandoffRefresh(entry)
  }

  #beginRecoveryHandoff(
    entry: Entry,
    request: ConversationStreamRecoveryRequest,
    disposition: ConversationStreamRecoveryDisposition.Retired | ConversationStreamRecoveryDisposition.RetryAttach
  ): void {
    const handoff =
      entry.handoff ??
      (entry.handoff = {
        pendingTurnIds: new Set(),
        retireRecoveries: new Map(),
        retryRecoveries: new Map(),
        attempt: 0,
        retryTimer: null,
        inFlight: false
      })
    const target =
      disposition === ConversationStreamRecoveryDisposition.Retired ? handoff.retireRecoveries : handoff.retryRecoveries
    target.set(request.recoveryId, request)
    handoff.attempt = 0
    if (handoff.inFlight) return
    this.#clearHandoffTimer(entry)
    this.#runHandoffRefresh(entry)
  }

  #runHandoffRefresh(entry: Entry): void {
    const handoff = entry.handoff
    if (!handoff || handoff.inFlight || entry.dropped) return
    const refresh = [...entry.refreshPorts].at(-1)
    if (!refresh) return
    this.#clearHandoffTimer(entry)
    handoff.inFlight = true
    const turnIds = new Set(handoff.pendingTurnIds)
    const retireRecoveries = new Map(handoff.retireRecoveries)
    const retryRecoveries = new Map(handoff.retryRecoveries)
    this.setRefreshError(entry.conversation, null)
    void (async () => {
      try {
        await refresh()
      } catch (error) {
        if (entry.handoff !== handoff) return
        handoff.inFlight = false
        const refreshError = error instanceof Error ? error : new Error(String(error))
        this.setRefreshError(entry.conversation, refreshError)
        logger.warn('conversation projection refresh failed; retaining overlay', {
          conversation: entry.conversation,
          error: refreshError
        })
        this.#scheduleHandoffRetry(entry)
        return
      }
      if (entry.handoff !== handoff) return
      handoff.inFlight = false
      for (const request of retireRecoveries.values()) {
        this.#completeRecovery(entry, request, ConversationStreamRecoveryDisposition.Retired)
      }
      for (const request of retryRecoveries.values()) {
        entry.sub.completeRecovery({
          recoveryId: request.recoveryId,
          attachmentGeneration: request.attachmentGeneration,
          executionId: request.executionId,
          disposition: ConversationStreamRecoveryDisposition.RetryAttach
        })
      }
      this.#retireTurns(entry, turnIds)
      for (const turnId of turnIds) handoff.pendingTurnIds.delete(turnId)
      for (const recoveryId of retireRecoveries.keys()) handoff.retireRecoveries.delete(recoveryId)
      for (const recoveryId of retryRecoveries.keys()) handoff.retryRecoveries.delete(recoveryId)
      if (handoff.pendingTurnIds.size > 0 || handoff.retireRecoveries.size > 0 || handoff.retryRecoveries.size > 0) {
        this.#runHandoffRefresh(entry)
      } else {
        entry.handoff = null
        this.setRefreshError(entry.conversation, null)
      }
    })()
  }

  #scheduleHandoffRetry(entry: Entry): void {
    const handoff = entry.handoff
    if (!handoff || entry.dropped) return
    const delay = HANDOFF_RETRY_DELAYS_MS[Math.min(handoff.attempt, HANDOFF_RETRY_DELAYS_MS.length - 1)]
    handoff.attempt += 1
    handoff.retryTimer = window.setTimeout(() => {
      handoff.retryTimer = null
      this.#runHandoffRefresh(entry)
    }, delay)
  }

  #clearHandoffTimer(entry: Entry): void {
    if (entry.handoff?.retryTimer != null) window.clearTimeout(entry.handoff.retryTimer)
    if (entry.handoff) entry.handoff.retryTimer = null
  }

  #retireTurns(entry: Entry, turnIds: ReadonlySet<ConversationTurnId>): void {
    if (turnIds.size === 0) return
    let next = entry.snapshots
    const executionIds = new Set([
      ...entry.snapshots.keys(),
      ...entry.pendingSnapshots.keys(),
      ...entry.settlements.keys(),
      ...entry.optimisticExecutions.keys(),
      ...entry.readers.keys()
    ])
    for (const executionId of executionIds) {
      const turnId = entry.settlements.get(executionId)?.turnId ?? entry.optimisticExecutions.get(executionId)?.turnId
      if (!turnId || !turnIds.has(turnId)) continue
      const handle = entry.readers.get(executionId)
      if (handle) {
        handle.cancel()
        handle.unregister()
      }
      entry.sub.retireExecution(executionId)
      entry.readers.delete(executionId)
      entry.pendingSnapshots.delete(executionId)
      entry.settlements.delete(executionId)
      entry.optimisticExecutions.delete(executionId)
      entry.optimisticSeeds.delete(executionId)
      entry.readerVersions.delete(executionId)
      if (next.has(executionId)) {
        if (next === entry.snapshots) next = new Map(entry.snapshots)
        next.delete(executionId)
      }
    }
    for (const [messageId, turnId] of entry.optimisticMessageTurnIds) {
      if (!turnIds.has(turnId)) continue
      entry.optimisticMessageTurnIds.delete(messageId)
      entry.optimisticMessages.delete(messageId)
      if (entry.activeNodeOverride?.activeNodeId === messageId) entry.activeNodeOverride = null
    }
    if (entry.pendingSnapshots.size === 0) this.#cancelCommit(entry)
    if (next === entry.snapshots) this.#publishView(entry)
    else this.#commitSnapshots(entry, next)
  }

  #completeRecovery(
    entry: Entry,
    request: ConversationStreamRecoveryRequest,
    disposition: ConversationStreamRecoveryDisposition.Retired
  ): void {
    entry.sub.completeRecovery({
      recoveryId: request.recoveryId,
      attachmentGeneration: request.attachmentGeneration,
      executionId: request.executionId,
      disposition
    })
    this.#retireExecutionData(entry, request.executionId, request.projection.outputNodeId)
  }

  #retireExecutionData(entry: Entry, executionId: ConversationExecutionId, outputNodeId: string | undefined): void {
    const handle = entry.readers.get(executionId)
    if (handle) {
      handle.cancel()
      handle.unregister()
    }
    entry.sub.retireExecution(executionId)
    entry.readers.delete(executionId)
    entry.pendingSnapshots.delete(executionId)
    entry.settlements.delete(executionId)
    entry.optimisticExecutions.delete(executionId)
    entry.optimisticSeeds.delete(executionId)
    entry.readerVersions.delete(executionId)
    const next = new Map(entry.snapshots)
    next.delete(executionId)
    if (outputNodeId) {
      entry.optimisticMessageTurnIds.delete(outputNodeId)
      entry.optimisticMessages.delete(outputNodeId)
      if (entry.activeNodeOverride?.activeNodeId === outputNodeId) entry.activeNodeOverride = null
    }
    if (entry.pendingSnapshots.size === 0) this.#cancelCommit(entry)
    this.#commitSnapshots(entry, next)
    this.#publishView(entry)
  }

  #rebaseExecution(entry: Entry, request: ConversationStreamRecoveryRequest): void {
    const handle = entry.readers.get(request.executionId)
    if (entry.sub.isSettled(request.executionId)) return
    if (!handle || handle.execution.turnId !== request.turnId) {
      entry.sub.completeRecovery({
        recoveryId: request.recoveryId,
        attachmentGeneration: request.attachmentGeneration,
        executionId: request.executionId,
        disposition: ConversationStreamRecoveryDisposition.Retired
      })
      return
    }
    handle.cancel()
    entry.readers.delete(request.executionId)
    entry.pendingSnapshots.delete(request.executionId)
    entry.settlements.delete(request.executionId)
    entry.readerVersions.delete(request.executionId)
    if (entry.snapshots.has(request.executionId)) {
      const next = new Map(entry.snapshots)
      next.delete(request.executionId)
      this.#commitSnapshots(entry, next)
    }
    const branch = entry.sub.completeRecovery({
      recoveryId: request.recoveryId,
      attachmentGeneration: request.attachmentGeneration,
      executionId: request.executionId,
      disposition: ConversationStreamRecoveryDisposition.Rebased
    })
    if (!branch) return
    this.#startReader(entry, handle.execution, handle.seedFromEmpty, handle.getSeedMessages, branch)
  }

  #getOrCreate(conversation: ConversationRef): Entry {
    const key = conversationRefKey(conversation)
    const existing = this.#entries.get(key)
    if (existing) return existing
    this.#evictIfNeeded()
    const sub = new ConversationStreamSubscription(conversation)
    if (conversation.id) sub.listen()
    const entry: Entry = {
      conversation,
      key,
      sub,
      dropped: false,
      refCount: 0,
      desired: new Map(),
      optimisticMessages: new Map(),
      optimisticMessageTurnIds: new Map(),
      optimisticExecutions: new Map(),
      optimisticSeeds: new Map(),
      activeNodeOverride: null,
      refreshError: null,
      durability: ConversationOverlayDurability.Ephemeral,
      refreshPorts: new Set(),
      notFoundTombstones: new Map(),
      handoff: null,
      snapshots: new Map(),
      settlements: new Map(),
      view: EMPTY_VIEW,
      pendingSnapshots: new Map(),
      readerVersions: new Map(),
      readers: new Map(),
      liveReaderCount: 0,
      epoch: 0,
      commitTimer: null,
      commitDeadline: null,
      lastCommitAt: 0,
      listeners: new Set(),
      finishListeners: new Set(),
      lastActiveAt: Date.now(),
      needsRemountReconcile: false
    }
    this.#entries.set(key, entry)
    sub.onExecutionTerminal(() => {
      if (this.#entries.get(key) === entry) this.#maybeDrop(entry)
    })
    sub.onConversationStateChange(() => {
      if (this.#entries.get(key) === entry) this.#maybeDrop(entry)
    })
    sub.onConversationQuiesced((turnId) => {
      if (this.#entries.get(key) === entry) this.#beginHandoff(entry, turnId)
    })
    sub.onRecoveryRequired((request) => {
      if (this.#entries.get(key) !== entry) return
      switch (request.reason) {
        case ConversationStreamRecoveryReason.Rebase:
          this.#rebaseExecution(entry, request)
          return
        case ConversationStreamRecoveryReason.NotFound:
          entry.notFoundTombstones.set(request.executionId, request.turnId)
          if (entry.durability === ConversationOverlayDurability.Ephemeral) {
            this.#completeRecovery(entry, request, ConversationStreamRecoveryDisposition.Retired)
          } else {
            this.#beginRecoveryHandoff(entry, request, ConversationStreamRecoveryDisposition.Retired)
          }
          return
        case ConversationStreamRecoveryReason.AttachUnavailable:
          if (entry.sub.isSettled(request.executionId)) {
            if (entry.durability === ConversationOverlayDurability.Durable) {
              this.#beginRecoveryHandoff(entry, request, ConversationStreamRecoveryDisposition.Retired)
            } else {
              this.#completeRecovery(entry, request, ConversationStreamRecoveryDisposition.Retired)
            }
          } else if (entry.durability === ConversationOverlayDurability.Durable) {
            this.#beginRecoveryHandoff(entry, request, ConversationStreamRecoveryDisposition.RetryAttach)
          } else {
            entry.sub.completeRecovery({
              recoveryId: request.recoveryId,
              attachmentGeneration: request.attachmentGeneration,
              executionId: request.executionId,
              disposition: ConversationStreamRecoveryDisposition.RetryAttach
            })
          }
          return
        default:
          assertNever(request.reason)
      }
    })
    return entry
  }

  #evictIfNeeded(): void {
    while (this.#entries.size >= MAX_ENTRIES) {
      let oldest: Entry | undefined
      for (const entry of this.#entries.values()) {
        if (entry.refCount > 0) continue
        if (!oldest || entry.lastActiveAt < oldest.lastActiveAt) oldest = entry
      }
      if (!oldest) return
      logger.error('evicting stale overlay entry', {
        conversation: oldest.conversation,
        entryCount: this.#entries.size,
        liveReaders: oldest.liveReaderCount,
        idleMs: Date.now() - oldest.lastActiveAt
      })
      for (const handle of oldest.readers.values()) handle.cancel()
      this.#dropEntry(oldest)
    }
  }

  #maybeDrop(entry: Entry): void {
    if (entry.refCount > 0 || entry.liveReaderCount > 0) return
    if (entry.sub.isConversationOpen() || entry.sub.hasAnyOpenBranch()) return
    this.#dropEntry(entry)
  }

  #dropEntry(entry: Entry): void {
    if (entry.dropped) return
    entry.dropped = true
    if (this.#entries.get(entry.key) === entry) this.#entries.delete(entry.key)
    this.#clearHandoffTimer(entry)
    entry.handoff = null
    this.#cancelCommit(entry)
    entry.sub.dispose()
  }

  #startReader(
    entry: Entry,
    execution: ConversationExecutionProjection,
    seedFromEmpty: boolean | undefined,
    getSeedMessages: () => CherryUIMessage[],
    recoveredBranch?: ReadableStream<UIMessageChunk>
  ): void {
    const { executionId, outputNodeId, turnId } = execution
    const branch = recoveredBranch ?? entry.sub.register(execution)
    if (!entry.sub.hasOpenBranch(executionId)) return
    const readerEpoch = entry.epoch
    const readerVersion = (entry.readerVersions.get(executionId) ?? 0) + 1
    entry.readerVersions.set(executionId, readerVersion)
    entry.pendingSnapshots.delete(executionId)
    entry.settlements.delete(executionId)

    let cancelled = false
    let readerFailed = false
    let terminal: ExecutionTerminal | undefined
    const offTerminal = entry.sub.onExecutionTerminal((value) => {
      if (value.executionId === executionId && value.turnId === turnId) terminal = value
    })
    const seed = pickSeed(getSeedMessages(), outputNodeId, seedFromEmpty)
    const handle: ReaderHandle = {
      branch,
      execution,
      seedFromEmpty,
      getSeedMessages,
      cancel: () => {
        cancelled = true
        entry.sub.cancelBranch(executionId, branch)
      },
      unregister: () => {
        offTerminal()
        entry.sub.unregister(executionId, branch)
      }
    }
    entry.readers.set(executionId, handle)
    entry.liveReaderCount += 1

    void (async () => {
      let last: CherryUIMessage | undefined
      try {
        for await (const snapshot of readUIMessageStream<CherryUIMessage>({
          stream: branch,
          message: seed,
          terminateOnError: false,
          onError: (error) => {
            if (!cancelled)
              logger.warn('readUIMessageStream error', { conversation: entry.conversation, executionId, error })
          }
        })) {
          if (cancelled) break
          const sharedParts = shareSettledPartReferences(
            last?.parts as CherryMessagePart[] | undefined,
            snapshot.parts as CherryMessagePart[]
          )
          last = sharedParts === snapshot.parts ? snapshot : { ...snapshot, parts: sharedParts }
          this.#queueSnapshot(entry, executionId, last, readerEpoch, readerVersion)
        }
      } catch (error) {
        readerFailed = true
        logger.error('execution reader threw', { conversation: entry.conversation, executionId, error })
      } finally {
        offTerminal()
        if (entry.readers.get(executionId) === handle) {
          entry.sub.unregister(executionId, branch)
          entry.readers.delete(executionId)
        }
        if (!cancelled) {
          if (entry.refCount === 0) {
            entry.pendingSnapshots.delete(executionId)
            entry.settlements.delete(executionId)
            entry.readerVersions.delete(executionId)
            if (entry.snapshots.has(executionId)) {
              const next = new Map(entry.snapshots)
              next.delete(executionId)
              this.#commitSnapshots(entry, next)
            }
          } else {
            this.#flushPending(entry, readerEpoch)
            const message = last ?? seed
            const isError = terminal?.isError === true || readerFailed
            if (message || isError) {
              const event: ExecutionFinishEvent = {
                turnId,
                executionId,
                message: message ?? ({ id: outputNodeId ?? '', role: 'assistant', parts: [] } as CherryUIMessage),
                isAbort: terminal?.isAbort ?? false,
                isError
              }
              this.#settleExecution(entry, event)
              for (const listener of [...entry.finishListeners]) {
                try {
                  listener(executionId, event)
                } catch (error) {
                  logger.warn('finish listener threw', { conversation: entry.conversation, executionId, error })
                }
              }
            }
          }
          if (entry.readerVersions.get(executionId) === readerVersion) entry.readerVersions.delete(executionId)
        }
        entry.liveReaderCount -= 1
        this.#maybeDrop(entry)
      }
    })()
  }

  #queueSnapshot(
    entry: Entry,
    executionId: ConversationExecutionId,
    snapshot: CherryUIMessage,
    epoch: number,
    readerVersion: number
  ): void {
    if (epoch !== entry.epoch || entry.readerVersions.get(executionId) !== readerVersion) return
    entry.pendingSnapshots.set(executionId, { epoch, readerVersion, snapshot })
    const deadline = entry.lastCommitAt + commitIntervalMs(entry.pendingSnapshots.values())
    if (entry.commitTimer !== null) {
      if (entry.commitDeadline !== null && deadline <= entry.commitDeadline) return
      this.#cancelCommit(entry)
    }
    entry.commitDeadline = deadline
    entry.commitTimer = window.setTimeout(
      () => {
        entry.commitTimer = null
        entry.commitDeadline = null
        this.#flushPending(entry, epoch)
      },
      Math.max(0, deadline - performance.now())
    )
  }

  #flushPending(entry: Entry, expectedEpoch: number): void {
    if (expectedEpoch !== entry.epoch) return
    this.#cancelCommit(entry)
    const pending = entry.pendingSnapshots
    if (pending.size === 0) return
    entry.pendingSnapshots = new Map()
    let next = entry.snapshots
    for (const [executionId, item] of pending) {
      if (item.epoch !== entry.epoch || entry.readerVersions.get(executionId) !== item.readerVersion) continue
      if (entry.snapshots.get(executionId) === item.snapshot) continue
      if (next === entry.snapshots) next = new Map(entry.snapshots)
      next.set(executionId, item.snapshot)
    }
    this.#commitSnapshots(entry, next)
  }

  #commitSnapshots(entry: Entry, next: Map<ConversationExecutionId, CherryUIMessage>): void {
    if (next === entry.snapshots) return
    entry.lastCommitAt = performance.now()
    entry.snapshots = next
    this.#publishView(entry)
  }

  #settleExecution(entry: Entry, event: ExecutionFinishEvent): void {
    entry.settlements.set(event.executionId, {
      turnId: event.turnId,
      isAbort: event.isAbort,
      isError: event.isError
    })
    entry.optimisticExecutions.delete(event.executionId)
    entry.optimisticSeeds.delete(event.executionId)
    this.#publishView(entry)
  }

  #publishView(entry: Entry): void {
    const projectedExecutions = projectActiveExecutions(
      [...entry.desired.values()].flatMap(({ executions }) => executions),
      [...entry.optimisticExecutions.values()]
    ).filter(
      (execution) =>
        !entry.sub.isSettled(execution.executionId) &&
        entry.notFoundTombstones.get(execution.executionId) !== execution.turnId
    )
    const knownExecutions = new Map<ConversationExecutionId, ConversationExecutionProjection>()
    for (const contribution of entry.desired.values()) {
      for (const execution of contribution.executions) knownExecutions.set(execution.executionId, execution)
    }
    for (const execution of entry.optimisticExecutions.values()) knownExecutions.set(execution.executionId, execution)
    const next = computeView(
      entry.snapshots,
      entry.settlements,
      knownExecutions,
      entry.optimisticMessages,
      projectedExecutions,
      entry.activeNodeOverride,
      entry.refreshError
    )
    entry.lastActiveAt = Date.now()
    if (sameOverlayView(entry.view, next)) return
    entry.view = next
    for (const listener of [...entry.listeners]) {
      try {
        listener()
      } catch (error) {
        logger.warn('overlay listener threw', { conversation: entry.conversation, error })
      }
    }
  }

  #invalidatePending(entry: Entry): void {
    entry.epoch += 1
    entry.pendingSnapshots.clear()
    this.#cancelCommit(entry)
  }

  #cancelCommit(entry: Entry): void {
    if (entry.commitTimer !== null) window.clearTimeout(entry.commitTimer)
    entry.commitTimer = null
    entry.commitDeadline = null
  }
}

export const executionStreamOverlayService = new ExecutionStreamOverlayService()
