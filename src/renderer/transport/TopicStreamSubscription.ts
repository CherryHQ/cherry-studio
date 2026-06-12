import { loggerService } from '@logger'
import type { StreamChunkPayload } from '@shared/ai/transport'
import type { UniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'

const logger = loggerService.withContext('TopicStreamSubscription')

export interface ExecutionTerminal {
  isAbort: boolean
  isError: boolean
}

type TerminalListener = (executionId: UniqueModelId, terminal: ExecutionTerminal) => void

interface Branch {
  stream: ReadableStream<UIMessageChunk>
  controller: ReadableStreamDefaultController<UIMessageChunk> | null
  closed: boolean
}

function createBranch(): Branch {
  const branch: Branch = { stream: undefined as never, controller: null, closed: false }
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
  readonly #branches = new Map<UniqueModelId, Branch>()
  readonly #terminalByExecutionId = new Map<UniqueModelId, ExecutionTerminal>()
  readonly #terminalListeners = new Set<TerminalListener>()
  #ipcUnsubs: Array<() => void> = []
  #attached = false
  #attachInFlight: Promise<void> | null = null
  #disposed = false

  constructor(topicId: string) {
    this.#topicId = topicId
  }

  listen(): void {
    if (this.#disposed) return
    this.#setupIpcListeners()
  }

  register(executionId: UniqueModelId): ReadableStream<UIMessageChunk> {
    // The branch controller is created synchronously inside `createBranch`,
    // so chunks arriving before this call are already queued — late readers
    // never lose replay/early chunks.
    const branch = this.#getOrCreateBranch(executionId)
    void this.#ensureAttached()
    return branch.stream
  }

  unregister(executionId: UniqueModelId): void {
    const branch = this.#branches.get(executionId)
    if (!branch) return
    this.#closeBranch(branch)
    this.#branches.delete(executionId)
    this.#terminalByExecutionId.delete(executionId)
    if (this.#branches.size === 0 && this.#attached && !this.#disposed) {
      // Defer one tick: a transient `activeExecutions` flicker would otherwise
      // detach→reattach and momentarily drop Main's last listener.
      queueMicrotask(() => {
        if (this.#branches.size === 0 && this.#attached && !this.#disposed) this.#detach()
      })
    }
  }

  onExecutionTerminal(listener: TerminalListener): () => void {
    this.#terminalListeners.add(listener)
    for (const [executionId, terminal] of this.#terminalByExecutionId) {
      try {
        listener(executionId, terminal)
      } catch (err) {
        logger.warn('terminal listener threw during replay', { topicId: this.#topicId, err })
      }
    }
    return () => this.#terminalListeners.delete(listener)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const branch of this.#branches.values()) this.#closeBranch(branch)
    this.#branches.clear()
    this.#terminalByExecutionId.clear()
    this.#terminalListeners.clear()
    if (this.#attached) void window.api.ai.streamDetach({ topicId: this.#topicId }).catch(() => {})
    this.#attached = false
    this.#attachInFlight = null
    for (const unsub of this.#ipcUnsubs) unsub()
    this.#ipcUnsubs = []
  }

  // ── internals ──────────────────────────────────────────────────────

  #getOrCreateBranch(executionId: UniqueModelId): Branch {
    let branch = this.#branches.get(executionId)
    if (!branch) {
      branch = createBranch()
      if (this.#terminalByExecutionId.has(executionId)) this.#closeBranch(branch)
      this.#branches.set(executionId, branch)
    }
    return branch
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
    const branch = this.#getOrCreateBranch(executionId)
    if (!branch.closed) branch.controller?.enqueue(payload.chunk)
  }

  #emitTerminal(executionId: UniqueModelId, terminal: ExecutionTerminal): void {
    const branch = this.#branches.get(executionId)
    if (branch) this.#closeBranch(branch)
    this.#terminalByExecutionId.set(executionId, terminal)
    for (const listener of this.#terminalListeners) {
      try {
        listener(executionId, terminal)
      } catch (err) {
        logger.warn('terminal listener threw', { topicId: this.#topicId, err })
      }
    }
  }

  #terminateAll(terminal: ExecutionTerminal): void {
    for (const executionId of [...this.#branches.keys()]) this.#emitTerminal(executionId, terminal)
  }

  #setupIpcListeners(): void {
    if (this.#ipcUnsubs.length > 0) return
    this.#ipcUnsubs.push(
      window.api.ai.onStreamChunk((data) => this.#routeChunk(data)),
      window.api.ai.onStreamDone((data) => {
        if (data.topicId !== this.#topicId) return
        const terminal: ExecutionTerminal = { isAbort: data.status === 'paused', isError: false }
        if (data.executionId) this.#emitTerminal(data.executionId, terminal)
        if (data.isTopicDone || !data.executionId) this.#terminateAll(terminal)
      }),
      window.api.ai.onStreamError((data) => {
        if (data.topicId !== this.#topicId) return
        const terminal: ExecutionTerminal = { isAbort: false, isError: true }
        if (data.executionId) this.#emitTerminal(data.executionId, terminal)
        if (data.isTopicDone || !data.executionId) this.#terminateAll(terminal)
      })
    )
  }

  async #ensureAttached(): Promise<void> {
    if (this.#attached || this.#attachInFlight || this.#disposed) return this.#attachInFlight ?? undefined
    // Register IPC listeners BEFORE attaching so live chunks Main emits the
    // instant its listener registers are not missed.
    this.#setupIpcListeners()
    this.#attachInFlight = (async () => {
      try {
        const res = await window.api.ai.streamAttach({ topicId: this.#topicId })
        if (this.#disposed) return
        this.#attached = true
        switch (res.status) {
          case 'attached':
            for (const payload of res.bufferedChunks) this.#routeChunk(payload)
            break
          case 'not-found':
          case 'done':
            this.#terminateAll({ isAbort: false, isError: false })
            break
          case 'paused':
            this.#terminateAll({ isAbort: true, isError: false })
            break
          case 'error':
            this.#terminateAll({ isAbort: false, isError: true })
            break
        }
        // If every execution unregistered while this attach was in flight, the
        // deferred-detach guard in `unregister` saw `#attached === false` and skipped,
        // so nothing else will release Main's listener. Detach now that attach resolved.
        if (this.#branches.size === 0 && !this.#disposed) this.#detach()
      } catch (err) {
        logger.warn('streamAttach failed', { topicId: this.#topicId, err })
      } finally {
        this.#attachInFlight = null
      }
    })()
    return this.#attachInFlight
  }

  #detach(): void {
    if (!this.#attached) return
    void window.api.ai.streamDetach({ topicId: this.#topicId }).catch(() => {})
    this.#attached = false
    this.#attachInFlight = null
  }
}
