import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import {
  ConversationAttachStatus,
  type ConversationExecutionId,
  type ConversationRef,
  conversationRefsEqual,
  type ConversationTurnId
} from '@shared/ai/conversation'
import type { ConversationExecutionProjection, StreamChunkPayload } from '@shared/ai/transport'
import type { CherryUIMessageChunk } from '@shared/data/types/message'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'

import { streamAttachmentService } from './StreamAttachmentService'

const logger = loggerService.withContext('ConversationStreamSubscription')

export interface ExecutionTerminal {
  turnId: ConversationTurnId
  executionId: ConversationExecutionId
  outputNodeId: string
  isAbort: boolean
  isError: boolean
}

type TerminalListener = (terminal: ExecutionTerminal) => void
type ConversationStateListener = () => void
type ConversationQuiescedListener = (turnId: ConversationTurnId) => void

interface Branch {
  readonly projection: ConversationExecutionProjection
  stream: ReadableStream<UIMessageChunk>
  controller: ReadableStreamDefaultController<UIMessageChunk> | null
  lastChunkSeq: number
  closed: boolean
}

const createBranch = (projection: ConversationExecutionProjection): Branch => {
  const branch: Branch = {
    projection,
    stream: undefined as never,
    controller: null,
    lastChunkSeq: 0,
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

/** Renderer data-plane observer. It owns no admission or lifecycle policy. */
export class ConversationStreamSubscription {
  readonly #branches = new Map<ConversationExecutionId, Branch>()
  readonly #terminals = new Map<ConversationExecutionId, ExecutionTerminal>()
  readonly #terminalListeners = new Set<TerminalListener>()
  readonly #stateListeners = new Set<ConversationStateListener>()
  readonly #quiescedListeners = new Set<ConversationQuiescedListener>()
  #ipcUnsubs: Array<() => void> = []
  #attached = false
  #attachInFlight: Promise<void> | null = null
  #releaseAttachment: (() => void) | null = null
  #disposed = false
  #conversationOpen = false
  #lastQuiescedTurnId: ConversationTurnId | undefined

  constructor(readonly conversation: ConversationRef) {}

  listen(): void {
    if (!this.#disposed) this.#setupIpcListeners()
  }

  register(projection: ConversationExecutionProjection): ReadableStream<UIMessageChunk> {
    const branch = this.#getOrCreateBranch(projection)
    this.#conversationOpen = true
    if (!branch.closed) void this.#ensureAttached()
    return branch.stream
  }

  hasOpenBranch(executionId: ConversationExecutionId): boolean {
    return this.#branches.get(executionId)?.closed === false
  }

  hasAnyOpenBranch(): boolean {
    return [...this.#branches.values()].some(({ closed }) => !closed)
  }

  isConversationOpen(): boolean {
    return this.#conversationOpen
  }

  isSettled(executionId: ConversationExecutionId): boolean {
    return this.#terminals.has(executionId)
  }

  unregister(executionId: ConversationExecutionId): void {
    const branch = this.#branches.get(executionId)
    if (branch) {
      this.#closeBranch(branch)
      this.#branches.delete(executionId)
    }
    this.#terminals.delete(executionId)
    if (this.#branches.size === 0 && this.#attached && !this.#conversationOpen) {
      queueMicrotask(() => this.#detachIfIdle())
    }
  }

  cancelBranch(executionId: ConversationExecutionId): void {
    const branch = this.#branches.get(executionId)
    if (!branch) return
    branch.closed = true
    try {
      branch.controller?.error()
    } catch {
      // Reader already settled.
    }
  }

  onExecutionTerminal(listener: TerminalListener): () => void {
    this.#terminalListeners.add(listener)
    for (const terminal of this.#terminals.values()) listener(terminal)
    return () => this.#terminalListeners.delete(listener)
  }

  onConversationStateChange(listener: ConversationStateListener): () => void {
    this.#stateListeners.add(listener)
    return () => this.#stateListeners.delete(listener)
  }

  onConversationQuiesced(listener: ConversationQuiescedListener): () => void {
    this.#quiescedListeners.add(listener)
    if (this.#lastQuiescedTurnId) listener(this.#lastQuiescedTurnId)
    return () => this.#quiescedListeners.delete(listener)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const branch of this.#branches.values()) this.#closeBranch(branch)
    this.#branches.clear()
    this.#terminals.clear()
    this.#terminalListeners.clear()
    this.#stateListeners.clear()
    this.#quiescedListeners.clear()
    this.#detach()
    for (const unsubscribe of this.#ipcUnsubs) unsubscribe()
    this.#ipcUnsubs = []
  }

  #getOrCreateBranch(projection: ConversationExecutionProjection): Branch {
    const existing = this.#branches.get(projection.executionId)
    if (existing) return existing
    const branch = createBranch(projection)
    if (this.#terminals.has(projection.executionId)) this.#closeBranch(branch)
    else this.#branches.set(projection.executionId, branch)
    return branch
  }

  #routeChunk(payload: StreamChunkPayload): void {
    if (!conversationRefsEqual(payload.conversation, this.conversation)) return
    if (this.#terminals.has(payload.executionId)) return
    const projection: ConversationExecutionProjection = {
      turnId: payload.turnId,
      executionId: payload.executionId,
      modelId: payload.modelId,
      outputNodeId: payload.outputNodeId
    }
    const branch = this.#getOrCreateBranch(projection)
    const throughChunkSeq = payload.throughChunkSeq ?? payload.chunkSeq
    if (throughChunkSeq <= branch.lastChunkSeq) return
    branch.lastChunkSeq = throughChunkSeq
    branch.controller?.enqueue(payload.chunk)
  }

  #settle(terminal: ExecutionTerminal): void {
    if (this.#terminals.has(terminal.executionId)) return
    const branch = this.#branches.get(terminal.executionId)
    if (branch) this.#closeBranch(branch)
    this.#terminals.set(terminal.executionId, terminal)
    for (const listener of this.#terminalListeners) listener(terminal)
  }

  #enqueueError(error: SerializedError, executionId?: ConversationExecutionId): void {
    const chunk: CherryUIMessageChunk = { type: 'data-error', data: { ...error } }
    const branches = [...this.#branches.values()].filter(
      (branch) => executionId === undefined || branch.projection.executionId === executionId
    )
    for (const branch of branches) if (!branch.closed) branch.controller?.enqueue(chunk)
  }

  #closeBranch(branch: Branch): void {
    if (branch.closed) return
    branch.closed = true
    try {
      branch.controller?.close()
    } catch {
      // Reader already settled.
    }
  }

  #setConversationOpen(open: boolean): void {
    if (this.#conversationOpen === open) return
    this.#conversationOpen = open
    for (const listener of this.#stateListeners) listener()
  }

  #publishQuiescence(turnId: ConversationTurnId): void {
    this.#lastQuiescedTurnId = turnId
    for (const listener of this.#quiescedListeners) listener(turnId)
  }

  #setupIpcListeners(): void {
    if (this.#ipcUnsubs.length > 0) return
    this.#ipcUnsubs.push(
      ipcApi.on('ai.stream.chunk', (data) => this.#routeChunk(data)),
      ipcApi.on('ai.stream.done', (data) => {
        if (!conversationRefsEqual(data.conversation, this.conversation)) return
        this.#settle({
          turnId: data.turnId,
          executionId: data.executionId,
          outputNodeId: data.outputNodeId,
          isAbort: data.status === ConversationAttachStatus.Paused,
          isError: false
        })
        if (data.turnTerminal) {
          this.#setConversationOpen(false)
          this.#publishQuiescence(data.turnId)
        }
      }),
      ipcApi.on('ai.stream.error', (data) => {
        if (!conversationRefsEqual(data.conversation, this.conversation)) return
        this.#enqueueError(data.error, data.executionId)
        this.#settle({
          turnId: data.turnId,
          executionId: data.executionId,
          outputNodeId: data.outputNodeId,
          isAbort: false,
          isError: true
        })
        if (data.turnTerminal) {
          this.#setConversationOpen(false)
          this.#publishQuiescence(data.turnId)
        }
      })
    )
  }

  async #ensureAttached(): Promise<void> {
    if (this.#attached || this.#attachInFlight || this.#disposed) return this.#attachInFlight ?? undefined
    this.#setupIpcListeners()
    this.#releaseAttachment ??= streamAttachmentService.acquire(this.conversation)
    this.#attachInFlight = (async () => {
      try {
        const result = await ipcApi.request('ai.stream.attach', { conversation: this.conversation })
        if (this.#disposed) return
        this.#attached = true
        if (result.status === ConversationAttachStatus.Attached) {
          for (const payload of result.bufferedChunks) this.#routeChunk(payload)
          return
        }
        if (result.status === ConversationAttachStatus.Error && result.error) this.#enqueueError(result.error)
        for (const branch of this.#branches.values()) this.#closeBranch(branch)
        this.#setConversationOpen(false)
      } catch (error) {
        logger.error('Conversation stream attach failed', { conversation: this.conversation, error })
        for (const branch of this.#branches.values()) this.#closeBranch(branch)
        this.#setConversationOpen(false)
      } finally {
        this.#attachInFlight = null
        this.#detachIfIdle()
      }
    })()
    return this.#attachInFlight
  }

  #detachIfIdle(): void {
    if (this.#branches.size === 0 && !this.#conversationOpen) this.#detach()
  }

  #detach(): void {
    this.#attached = false
    this.#attachInFlight = null
    this.#releaseAttachment?.()
    this.#releaseAttachment = null
  }
}
