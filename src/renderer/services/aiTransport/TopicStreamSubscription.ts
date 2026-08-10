import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { StreamChunkPayload } from '@shared/ai/transport'
import type { CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

const logger = loggerService.withContext('TopicStreamSubscription')

export interface ExecutionTerminal {
  attemptId?: string
  anchorMessageId?: string
  isAbort: boolean
  isError: boolean
}

type TerminalListener = (executionId: UniqueModelId, terminal: ExecutionTerminal) => void
type TopicStateListener = () => void

interface Branch {
  executionId: UniqueModelId
  attemptId?: string
  anchorMessageId?: string
  stream: ReadableStream<UIMessageChunk>
  controller: ReadableStreamDefaultController<UIMessageChunk> | null
  closed: boolean
}

function branchKey(executionId: UniqueModelId, anchorMessageId?: string, attemptId?: string): string {
  // One model execution can roll into another assistant row during steer continuation.
  // The branch identity must include the row anchor, not only the model id.
  return JSON.stringify([executionId, anchorMessageId ?? null, attemptId ?? null])
}

function createBranch(executionId: UniqueModelId, anchorMessageId?: string, attemptId?: string): Branch {
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
  readonly #topicStateListeners = new Set<TopicStateListener>()
  #ipcUnsubs: Array<() => void> = []
  #attached = false
  #attachInFlight: Promise<void> | null = null
  #disposed = false
  #topicOpen = false

  constructor(topicId: string) {
    this.#topicId = topicId
  }

  listen(): void {
    if (this.#disposed) return
    this.#setupIpcListeners()
  }

  register(executionId: UniqueModelId, anchorMessageId?: string, attemptId?: string): ReadableStream<UIMessageChunk> {
    // The branch controller is created synchronously inside `createBranch`,
    // so chunks arriving before this call are already queued — late readers
    // never lose replay/early chunks.
    const branch = this.#getOrCreateBranch(executionId, anchorMessageId, attemptId)
    void this.#ensureAttached()
    return branch.stream
  }

  /** True when the branch for this exact key exists and is still open —
   *  i.e. a stream (typically a new turn's auto-created branch) has produced
   *  chunks that no reader has claimed yet. */
  hasOpenBranch(executionId: UniqueModelId, anchorMessageId?: string, attemptId?: string): boolean {
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

  unregister(executionId: UniqueModelId, anchorMessageId?: string, attemptId?: string): void {
    const key = branchKey(executionId, anchorMessageId, attemptId)
    const branch = this.#branches.get(key)
    if (!branch) return
    this.#closeBranch(branch)
    this.#branches.delete(key)
    this.#terminalByBranchKey.delete(key)
    if (this.#branches.size === 0 && this.#attached && !this.#disposed && !this.#topicOpen) {
      // Defer one tick: a transient `activeExecutions` flicker would otherwise
      // detach→reattach and momentarily drop Main's last listener.
      queueMicrotask(() => {
        if (this.#branches.size === 0 && this.#attached && !this.#disposed && !this.#topicOpen) this.#detach()
      })
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
    this.#topicStateListeners.clear()
    if (this.#attached) void ipcApi.request('ai.stream.detach', { topicId: this.#topicId }).catch(() => {})
    this.#attached = false
    this.#attachInFlight = null
    for (const unsub of this.#ipcUnsubs) unsub()
    this.#ipcUnsubs = []
  }

  // ── internals ──────────────────────────────────────────────────────

  #getOrCreateBranch(executionId: UniqueModelId, anchorMessageId?: string, attemptId?: string): Branch {
    const key = branchKey(executionId, anchorMessageId, attemptId)
    let branch = this.#branches.get(key)
    if (!branch) {
      branch = createBranch(executionId, anchorMessageId, attemptId)
      if (this.#terminalFor(executionId, anchorMessageId, attemptId)) this.#closeBranch(branch)
      this.#branches.set(key, branch)
    }
    return branch
  }

  #terminalFor(
    executionId: UniqueModelId,
    anchorMessageId?: string,
    attemptId?: string
  ): ExecutionTerminal | undefined {
    const exact = this.#terminalByBranchKey.get(branchKey(executionId, anchorMessageId, attemptId))?.terminal
    if (exact) return exact
    if (attemptId) return undefined
    if (anchorMessageId) return this.#terminalByBranchKey.get(branchKey(executionId))?.terminal
    return undefined
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
    const executionId = payload.executionId
    if (!executionId) {
      // Defensive: chat chunks are always tagged by Main. If a single branch
      // is open, route to it; otherwise drop.
      if (this.#branches.size === 1) {
        const only = this.#branches.values().next().value as Branch
        if (!only.closed) only.controller?.enqueue(payload.chunk)
      } else {
        logger.warn('chunk without executionId dropped', { topicId: this.#topicId })
      }
      return
    }
    const branch = this.#getOrCreateBranch(executionId, payload.anchorMessageId, payload.attemptId)
    if (!branch.closed) branch.controller?.enqueue(payload.chunk)
  }

  /** Mirror PersistenceListener's stored error part into the live branch before it closes. */
  #enqueueError(
    error: SerializedError,
    executionId?: UniqueModelId,
    anchorMessageId?: string,
    attemptId?: string
  ): void {
    const chunk: CherryUIMessageChunk = { type: 'data-error', data: { ...error } }

    if (executionId) {
      const branch = this.#getOrCreateBranch(executionId, anchorMessageId, attemptId)
      if (!branch.closed) branch.controller?.enqueue(chunk)
      return
    }

    this.#enqueueErrorToBranches(chunk, [...this.#branches.values()])
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
    attemptId?: string
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
        if (data.executionId) this.#emitTerminal(data.executionId, terminal, data.anchorMessageId, data.attemptId)
        else this.#terminateAll(terminal)
        if (topicStateChanged) this.#notifyTopicStateChange()
      }),
      ipcApi.on('ai.stream.error', (data) => {
        if (data.topicId !== this.#topicId) return
        const topicStateChanged = this.#updateTopicOpen(data.isTopicDone)
        this.#enqueueError(data.error, data.executionId, data.anchorMessageId, data.attemptId)
        const terminal: ExecutionTerminal = {
          ...(data.attemptId !== undefined ? { attemptId: data.attemptId } : {}),
          isAbort: false,
          isError: true
        }
        if (data.executionId) this.#emitTerminal(data.executionId, terminal, data.anchorMessageId, data.attemptId)
        else this.#terminateAll(terminal)
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
