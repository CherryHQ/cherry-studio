import type { UIMessageChunk } from 'ai'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { StreamChunkPayload } from '@shared/ai/transport'
import type { CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'

const logger = loggerService.withContext('TopicStreamSubscription')

export interface ExecutionTerminal {
  attemptId?: number
  anchorMessageId?: string
  isAbort: boolean
  isError: boolean
}

type TerminalListener = (executionId: UniqueModelId, terminal: ExecutionTerminal) => void
type TopicStateListener = () => void

interface RetiredExecutionBranch {
  executionId: UniqueModelId
  attemptId: number
  anchorMessageId?: string
}

type BranchRetirementListener = (branches: readonly RetiredExecutionBranch[]) => void

interface Branch {
  executionId: UniqueModelId
  attemptId: number
  anchorMessageId?: string
  stream: ReadableStream<UIMessageChunk>
  controller: ReadableStreamDefaultController<UIMessageChunk> | null
  closed: boolean
}

function branchKey(executionId: UniqueModelId, anchorMessageId?: string, attemptId?: number): string {
  // One model execution can roll into another assistant row during steer continuation.
  // The branch identity must include the row anchor, not only the model id.
  return JSON.stringify([executionId, anchorMessageId ?? null, attemptId ?? null])
}

function createBranch(executionId: UniqueModelId, anchorMessageId: string | undefined, attemptId: number): Branch {
  const branch: Branch = {
    executionId,
    attemptId,
    anchorMessageId,
    stream: undefined as never,
    controller: null,
    closed: false
  }
  branch.stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      branch.controller = controller
    },
    cancel() {
      branch.closed = true
    }
  })
  return branch
}

export class TopicStreamSubscription {
  readonly #topicId: string
  readonly #branches = new Map<string, Branch>()
  readonly #terminalByBranchKey = new Map<string, { executionId: UniqueModelId; terminal: ExecutionTerminal }>()
  readonly #terminalListeners = new Set<TerminalListener>()
  readonly #branchRetirementListeners = new Set<BranchRetirementListener>()
  readonly #topicStateListeners = new Set<TopicStateListener>()
  #ipcUnsubs: Array<() => void> = []
  #attached = false
  #attachInFlight: Promise<void> | null = null
  #disposed = false
  #topicOpen = false
  #terminalAttemptWatermark: number | undefined

  constructor(topicId: string) {
    this.#topicId = topicId
  }

  listen(): void {
    if (this.#disposed) return
    this.#setupIpcListeners()
  }

  register(
    executionId: UniqueModelId,
    anchorMessageId: string | undefined,
    attemptId: number
  ): ReadableStream<UIMessageChunk> {
    // The branch controller is created synchronously inside `createBranch`,
    // so chunks arriving before this call are already queued — late readers
    // never lose replay/early chunks.
    const branch = this.#getOrCreateBranch(executionId, anchorMessageId, attemptId)
    if (!branch.closed) void this.#ensureAttached()
    return branch.stream
  }

  /** True when the branch for this exact key exists and is still open —
   *  i.e. a stream (typically a new turn's auto-created branch) has produced
   *  chunks that no reader has claimed yet. */
  hasOpenBranch(executionId: UniqueModelId, anchorMessageId: string | undefined, attemptId: number): boolean {
    const branch = this.#branches.get(branchKey(executionId, anchorMessageId, attemptId))
    return branch !== undefined && !branch.closed
  }

  /** True when any open branch remains — e.g. a continuation round's chunks
   *  arrived after the previous round's reader retired and are queuing,
   *  unclaimed, for the next mounted reader. */
  hasAnyOpenBranch(): boolean {
    for (const branch of this.#branches.values()) {
      if (!branch.closed) return true
    }
    return false
  }

  /** Main has explicitly ended an execution with `isTopicDone=false`, so
   *  another execution may follow even when no branch exists yet. */
  isTopicOpen(): boolean {
    return this.#topicOpen
  }

  unregister(executionId: UniqueModelId, anchorMessageId: string | undefined, attemptId: number): void {
    const key = branchKey(executionId, anchorMessageId, attemptId)
    const branch = this.#branches.get(key)
    if (branch) {
      this.#closeBranch(branch)
      this.#branches.delete(key)
    }
    this.#terminalByBranchKey.delete(key)
    if (this.#branches.size === 0 && this.#attached && !this.#disposed && !this.#topicOpen) {
      // Defer one tick: a transient `activeExecutions` flicker would otherwise
      // detach→reattach and momentarily drop Main's last listener.
      queueMicrotask(() => {
        if (this.#branches.size === 0 && this.#attached && !this.#disposed && !this.#topicOpen) this.#detach()
      })
    }
  }

  cancelBranch(executionId: UniqueModelId, anchorMessageId: string | undefined, attemptId: number): void {
    const branch = this.#branches.get(branchKey(executionId, anchorMessageId, attemptId))
    if (!branch || branch.closed) return
    branch.closed = true
    try {
      branch.controller?.error()
    } catch {
      // already closed/errored — fine
    }
  }

  onExecutionTerminal(listener: TerminalListener): () => void {
    this.#terminalListeners.add(listener)
    for (const { executionId, terminal } of this.#terminalByBranchKey.values()) {
      try {
        listener(executionId, terminal)
      } catch (err) {
        logger.warn('terminal listener threw during replay', { topicId: this.#topicId, err })
      }
    }
    return () => this.#terminalListeners.delete(listener)
  }

  onBranchesRetired(listener: BranchRetirementListener): () => void {
    this.#branchRetirementListeners.add(listener)
    return () => this.#branchRetirementListeners.delete(listener)
  }

  onTopicStateChange(listener: TopicStateListener): () => void {
    this.#topicStateListeners.add(listener)
    return () => this.#topicStateListeners.delete(listener)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const branch of this.#branches.values()) this.#closeBranch(branch)
    this.#branches.clear()
    this.#terminalByBranchKey.clear()
    this.#terminalListeners.clear()
    this.#branchRetirementListeners.clear()
    this.#topicStateListeners.clear()
    if (this.#attached) void ipcApi.request('ai.stream.detach', { topicId: this.#topicId }).catch(() => {})
    this.#attached = false
    this.#attachInFlight = null
    for (const unsub of this.#ipcUnsubs) unsub()
    this.#ipcUnsubs = []
  }

  // ── internals ──────────────────────────────────────────────────────

  #getOrCreateBranch(executionId: UniqueModelId, anchorMessageId: string | undefined, attemptId: number): Branch {
    const key = branchKey(executionId, anchorMessageId, attemptId)
    let branch = this.#branches.get(key)
    if (!branch) {
      branch = createBranch(executionId, anchorMessageId, attemptId)
      if (this.#isBranchSettled(executionId, anchorMessageId, attemptId)) {
        this.#closeBranch(branch)
        return branch
      }
      this.#branches.set(key, branch)
    }
    return branch
  }

  #terminalFor(
    executionId: UniqueModelId,
    anchorMessageId: string | undefined,
    attemptId: number
  ): ExecutionTerminal | undefined {
    return this.#terminalByBranchKey.get(branchKey(executionId, anchorMessageId, attemptId))?.terminal
  }

  #isBranchSettled(executionId: UniqueModelId, anchorMessageId: string | undefined, attemptId: number): boolean {
    return (
      this.#terminalFor(executionId, anchorMessageId, attemptId) !== undefined ||
      (this.#terminalAttemptWatermark !== undefined && attemptId <= this.#terminalAttemptWatermark)
    )
  }

  #closeBranch(branch: Branch): void {
    if (branch.closed) return
    branch.closed = true
    try {
      branch.controller?.close()
    } catch {
      // already closed/errored — fine
    }
  }

  #routeChunk(payload: StreamChunkPayload): void {
    if (payload.topicId !== this.#topicId) return
    const { executionId, attemptId } = payload
    if (!executionId || attemptId === undefined) {
      logger.warn('chunk without execution identity dropped', {
        topicId: this.#topicId,
        hasExecutionId: executionId !== undefined,
        hasAttemptId: attemptId !== undefined
      })
      return
    }
    if (this.#isBranchSettled(executionId, payload.anchorMessageId, attemptId)) return
    const branch = this.#getOrCreateBranch(executionId, payload.anchorMessageId, attemptId)
    if (!branch.closed) branch.controller?.enqueue(payload.chunk)
  }

  /** Mirror PersistenceListener's stored error part into the live branch before it closes. */
  #enqueueError(
    error: SerializedError,
    executionId?: UniqueModelId,
    anchorMessageId?: string,
    attemptId?: number,
    topicAttemptWatermark?: number
  ): void {
    const chunk: CherryUIMessageChunk = { type: 'data-error', data: { ...error } }

    if (executionId && attemptId !== undefined) {
      const branch = this.#getOrCreateBranch(executionId, anchorMessageId, attemptId)
      if (!branch.closed) branch.controller?.enqueue(chunk)
      return
    }

    if (executionId) {
      logger.warn('execution error without attemptId dropped', { topicId: this.#topicId, executionId })
      return
    }

    const branches = [...this.#branches.values()].filter(
      (branch) => topicAttemptWatermark === undefined || branch.attemptId <= topicAttemptWatermark
    )
    this.#enqueueErrorToBranches(chunk, branches)
  }

  #enqueueErrorToBranches(chunk: CherryUIMessageChunk, branches: Branch[]): void {
    for (const branch of branches) {
      const key = branchKey(branch.executionId, branch.anchorMessageId, branch.attemptId)
      if (this.#branches.get(key) !== branch) continue
      if (!branch.closed) branch.controller?.enqueue(chunk)
    }
  }

  #emitTerminal(
    executionId: UniqueModelId,
    terminal: ExecutionTerminal,
    anchorMessageId?: string,
    attemptId?: number
  ): void {
    const keys =
      anchorMessageId !== undefined || attemptId !== undefined
        ? [branchKey(executionId, anchorMessageId, attemptId)]
        : [...this.#branches].filter(([, branch]) => branch.executionId === executionId).map(([key]) => key)

    if (keys.length === 0) keys.push(branchKey(executionId, undefined, attemptId))

    for (const key of keys) {
      const branch = this.#branches.get(key)
      if (branch) this.#closeBranch(branch)
      const resolvedAnchorMessageId = anchorMessageId ?? branch?.anchorMessageId
      const resolvedAttemptId = attemptId ?? branch?.attemptId
      const terminalForBranch: ExecutionTerminal = {
        ...terminal,
        ...(resolvedAttemptId !== undefined ? { attemptId: resolvedAttemptId } : {}),
        ...(resolvedAnchorMessageId !== undefined ? { anchorMessageId: resolvedAnchorMessageId } : {})
      }
      this.#terminalByBranchKey.set(key, { executionId, terminal: terminalForBranch })
      for (const listener of this.#terminalListeners) {
        try {
          listener(executionId, terminalForBranch)
        } catch (err) {
          logger.warn('terminal listener threw', { topicId: this.#topicId, err })
        }
      }
    }
  }

  #terminateAll(terminal: ExecutionTerminal): void {
    this.#terminateBranches([...this.#branches.values()], terminal)
  }

  #applyTerminal(
    executionId: UniqueModelId | undefined,
    terminal: ExecutionTerminal,
    anchorMessageId?: string,
    attemptId?: number,
    topicAttemptWatermark?: number
  ): void {
    if (topicAttemptWatermark === undefined) {
      if (executionId) this.#emitTerminal(executionId, terminal, anchorMessageId, attemptId)
      else this.#terminateAll(terminal)
      return
    }

    this.#terminalAttemptWatermark = Math.max(this.#terminalAttemptWatermark ?? 0, topicAttemptWatermark)
    const exactKey = executionId ? branchKey(executionId, anchorMessageId, attemptId) : undefined
    const coveredBranches = [...this.#branches.entries()]
      .filter(([, branch]) => branch.attemptId <= topicAttemptWatermark)
      .filter(([key]) => key !== exactKey)
      .map(([, branch]) => branch)

    if (executionId) {
      this.#retireBranches(coveredBranches)
      this.#emitTerminal(executionId, terminal, anchorMessageId, attemptId)
    } else {
      this.#terminateBranches(coveredBranches, terminal)
    }
  }

  #retireBranches(branches: Branch[]): void {
    const identities = branches.map(({ executionId, attemptId, anchorMessageId }) => ({
      executionId,
      attemptId,
      ...(anchorMessageId !== undefined ? { anchorMessageId } : {})
    }))
    if (identities.length === 0) return

    for (const listener of this.#branchRetirementListeners) {
      try {
        listener(identities)
      } catch (err) {
        logger.warn('branch retirement listener threw', { topicId: this.#topicId, err })
      }
    }

    for (const branch of branches) {
      const key = branchKey(branch.executionId, branch.anchorMessageId, branch.attemptId)
      if (this.#branches.get(key) !== branch) continue
      this.#closeBranch(branch)
      this.#branches.delete(key)
      this.#terminalByBranchKey.delete(key)
    }
  }

  #terminateBranches(branches: Branch[], terminal: ExecutionTerminal): void {
    for (const branch of branches) {
      const key = branchKey(branch.executionId, branch.anchorMessageId, branch.attemptId)
      if (this.#branches.get(key) !== branch) continue
      this.#emitTerminal(branch.executionId, terminal, branch.anchorMessageId, branch.attemptId)
    }
  }

  #updateTopicOpen(isTopicDone: boolean | undefined): boolean {
    if (isTopicDone === undefined) return false
    const topicOpen = !isTopicDone
    if (topicOpen === this.#topicOpen) return false
    this.#topicOpen = topicOpen
    return true
  }

  #notifyTopicStateChange(): void {
    for (const listener of this.#topicStateListeners) {
      try {
        listener()
      } catch (err) {
        logger.warn('topic state listener threw', { topicId: this.#topicId, err })
      }
    }
  }

  #setupIpcListeners(): void {
    if (this.#ipcUnsubs.length > 0) return
    this.#ipcUnsubs.push(
      ipcApi.on('ai.stream.chunk', (data) => this.#routeChunk(data)),
      ipcApi.on('ai.stream.done', (data) => {
        if (data.topicId !== this.#topicId) return
        const topicStateChanged = this.#updateTopicOpen(data.isTopicDone)
        const terminal: ExecutionTerminal = {
          ...(data.attemptId !== undefined ? { attemptId: data.attemptId } : {}),
          isAbort: data.status === 'paused',
          isError: false
        }
        this.#applyTerminal(
          data.executionId,
          terminal,
          data.anchorMessageId,
          data.attemptId,
          data.isTopicDone ? data.topicAttemptWatermark : undefined
        )
        if (topicStateChanged) this.#notifyTopicStateChange()
      }),
      ipcApi.on('ai.stream.error', (data) => {
        if (data.topicId !== this.#topicId) return
        const topicStateChanged = this.#updateTopicOpen(data.isTopicDone)
        this.#enqueueError(
          data.error,
          data.executionId,
          data.anchorMessageId,
          data.attemptId,
          data.isTopicDone ? data.topicAttemptWatermark : undefined
        )
        const terminal: ExecutionTerminal = {
          ...(data.attemptId !== undefined ? { attemptId: data.attemptId } : {}),
          isAbort: false,
          isError: true
        }
        this.#applyTerminal(
          data.executionId,
          terminal,
          data.anchorMessageId,
          data.attemptId,
          data.isTopicDone ? data.topicAttemptWatermark : undefined
        )
        if (topicStateChanged) this.#notifyTopicStateChange()
      })
    )
  }

  async #ensureAttached(): Promise<void> {
    if (this.#attached || this.#attachInFlight || this.#disposed) return this.#attachInFlight ?? undefined
    // Register IPC listeners BEFORE attaching so live chunks Main emits the
    // instant its listener registers are not missed.
    this.#setupIpcListeners()
    const branchesAtAttach = [...this.#branches.values()]
    this.#attachInFlight = (async () => {
      let shouldReattach = false
      try {
        const res = await ipcApi.request('ai.stream.attach', { topicId: this.#topicId })
        if (this.#disposed) return
        this.#attached = true
        switch (res.status) {
          case 'attached':
            for (const payload of res.bufferedChunks) this.#routeChunk(payload)
            break
          case 'not-found':
          case 'done':
            this.#terminateBranches(branchesAtAttach, { isAbort: false, isError: false })
            break
          case 'paused':
            this.#terminateBranches(branchesAtAttach, { isAbort: true, isError: false })
            break
          case 'error':
            if (res.error) {
              this.#enqueueErrorToBranches({ type: 'data-error', data: { ...res.error } }, branchesAtAttach)
            }
            this.#terminateBranches(branchesAtAttach, { isAbort: false, isError: true })
            break
        }
        shouldReattach = res.status !== 'attached' && this.hasAnyOpenBranch()
        if (shouldReattach) this.#attached = false
        // If every execution unregistered while this attach was in flight, the
        // deferred-detach guard in `unregister` saw `#attached === false` and skipped,
        // so nothing else will release Main's listener. Detach now that attach resolved.
        if (this.#branches.size === 0 && !this.#disposed && !this.#topicOpen) this.#detach()
      } catch (err) {
        logger.error('streamAttach failed', { topicId: this.#topicId, err })
        // Close open branches so their readers finish with an error terminal
        // instead of hanging forever on a stream that never attached. Recovery
        // happens through a fresh subscription on the next mount.
        if (!this.#disposed) {
          this.#terminateBranches(branchesAtAttach, { isAbort: false, isError: true })
          shouldReattach = this.hasAnyOpenBranch()
        }
      } finally {
        this.#attachInFlight = null
        if (shouldReattach && !this.#disposed) void this.#ensureAttached()
      }
    })()
    return this.#attachInFlight
  }

  #detach(): void {
    if (!this.#attached) return
    void ipcApi.request('ai.stream.detach', { topicId: this.#topicId }).catch(() => {})
    this.#attached = false
    this.#attachInFlight = null
  }
}
