/**
 * ChatSessionManager — manages Chat instances outside React component lifecycle.
 *
 * Problem: useAiChat → useChat → Chat held in useRef. Component unmount = Chat destroyed = stream lost.
 * Solution: Lift Chat instances into a service-layer singleton. Components subscribe via useSyncExternalStore.
 *
 * V1 equivalences:
 *   PQueue per topic      → ChatSession per topic
 *   Redux loadingByTopic  → chatSessionManager.getStreamingTopicIds()
 *   Redux fulfilledByTopic → chatSessionManager.getFulfilledTopicIds()
 *   abortController.ts    → Chat built-in AbortController
 */

import { Chat } from '@ai-sdk/react'
import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { CherryUIMessage } from '@renderer/hooks/useAiChat'
import { mapLegacyTopicToDto } from '@renderer/services/AssistantService'
import { IpcChatTransport } from '@renderer/transport/IpcChatTransport'
import type { Assistant, Topic } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'

const logger = loggerService.withContext('ChatSessionManager')

/** Singleton transport — stateless, safe to share across all sessions. */
const transport = new IpcChatTransport()

/** Max idle sessions to keep before evicting oldest. */
const MAX_IDLE_SESSIONS = 10

/** Delay before evicting an idle session (ms). */
const REAP_DELAY = 30_000

/** Throttle interval for message subscription callbacks (ms). */
const MESSAGE_THROTTLE_MS = 50

// ============================================================================
// ChatSession — per-conversation service wrapper
// ============================================================================

export interface ChatSessionOptions {
  topicId: string
  assistantId: string
  topic: Topic
  assistant: Assistant
  initialMessages?: CherryUIMessage[]
  /** Set of already-persisted message IDs (from history). */
  historyIds?: Set<string>
  /** Callback to refresh history from DataApi. Returns refreshed UIMessages. */
  refresh?: () => Promise<CherryUIMessage[]>
}

export class ChatSession {
  readonly topicId: string
  readonly assistantId: string
  readonly chat: Chat<CherryUIMessage>

  /** How many React components are actively consuming this session. */
  refCount = 0

  /** Timer for delayed cleanup after all consumers release. */
  reapTimer: ReturnType<typeof setTimeout> | undefined

  /** Stream completed while no UI was watching — sidebar shows blue dot. */
  isFulfilled = false

  private topic: Topic
  private historyIds: Set<string>
  private refreshFn: (() => Promise<CherryUIMessage[]>) | undefined
  private onStatusChange: (() => void) | undefined

  constructor(options: ChatSessionOptions, onStatusChange?: () => void) {
    this.topicId = options.topicId
    this.assistantId = options.assistantId
    this.topic = options.topic
    this.historyIds = options.historyIds ?? new Set()
    this.refreshFn = options.refresh
    this.onStatusChange = onStatusChange

    this.chat = new Chat<CherryUIMessage>({
      id: options.topicId,
      transport,
      messages: options.initialMessages,
      onFinish: ({ message, isAbort, isError }) => {
        void this.handleFinish(message, isAbort, isError)
      },
      onError: (error) => {
        logger.error('AI stream error', { topicId: this.topicId, error })
      }
    })

    // Subscribe to status changes to notify manager (for sidebar indicators)
    this.chat['~registerStatusCallback'](() => {
      this.onStatusChange?.()
    })
  }

  /** Update mutable session state (called when component re-mounts with fresh data). */
  updateContext(options: {
    topic?: Topic
    historyIds?: Set<string>
    refresh?: () => Promise<CherryUIMessage[]>
  }): void {
    if (options.topic) this.topic = options.topic
    if (options.historyIds) this.historyIds = options.historyIds
    if (options.refresh) this.refreshFn = options.refresh
  }

  /**
   * Persist completed exchange (user + assistant) to DataApi.
   * Runs entirely outside React — no hooks, refs, or component state.
   */
  private async handleFinish(assistantMessage: CherryUIMessage, isAbort: boolean, isError: boolean): Promise<void> {
    if (isError) {
      logger.warn('Stream ended with error — skipping persistence', { id: assistantMessage.id })
      return
    }

    // Skip empty abort messages (abort during 'submitted' state before first token)
    const contentPartTypes = new Set(['text', 'reasoning', 'tool-invocation', 'file'])
    const hasContent = assistantMessage.parts.some(
      (p) => contentPartTypes.has(p.type) && (p.type !== 'text' || p.text.length > 0)
    )
    if (isAbort && !hasContent) {
      logger.info('Abort with empty assistant message — skipping persistence', { id: assistantMessage.id })
      return
    }

    // Find preceding user message
    const allMessages = this.chat.messages
    const assistantIndex = allMessages.findIndex((m) => m.id === assistantMessage.id)
    const userMessage = assistantIndex > 0 ? allMessages[assistantIndex - 1] : undefined

    if (!userMessage || userMessage.role !== 'user') {
      logger.error('Could not find preceding user message — skipping persistence', {
        assistantId: assistantMessage.id
      })
      return
    }

    try {
      // 0. Ensure topic exists in SQLite (lazy-create for topics originating from IndexedDB/Redux)
      try {
        await dataApiService.get(`/topics/${this.topicId}`)
      } catch (err: unknown) {
        // Only create on NOT_FOUND — rethrow network/auth/other errors
        if (err && typeof err === 'object' && 'code' in err && err.code === 'NOT_FOUND') {
          await dataApiService.post('/topics', { body: mapLegacyTopicToDto(this.topic) })
          logger.info('Lazy-created topic in SQLite', { topicId: this.topicId })
        } else {
          throw err
        }
      }

      // 1. Determine parentId for assistant message
      const isUserPersisted = this.historyIds.has(userMessage.id)
      let userParentId: string

      if (isUserPersisted) {
        userParentId = userMessage.id
        logger.info('User message already persisted, skipping creation', { userMsgId: userParentId })
      } else {
        const savedUser = await dataApiService.post(`/topics/${this.topicId}/messages`, {
          body: {
            role: 'user',
            data: { parts: userMessage.parts as CherryMessagePart[] },
            status: 'success'
          }
        })
        userParentId = savedUser.id
      }

      // 2. Persist assistant message
      // Normalize reasoning parts: promote thinking_millsec from stream plugin metadata
      // to providerMetadata.cherry.thinkingMs for consistent reading after reload.
      const normalizedParts = (assistantMessage.parts as CherryMessagePart[]).map((part) => {
        if (part.type !== 'reasoning') return part
        const pm = part.providerMetadata as Record<string, unknown> | undefined
        const metaBlock = pm?.metadata as Record<string, unknown> | undefined
        const thinkingMs = metaBlock?.thinking_millsec
        if (typeof thinkingMs !== 'number' || thinkingMs <= 0) return part
        // Already has cherry.thinkingMs — skip
        const cherry = pm?.cherry as Record<string, unknown> | undefined
        if (cherry?.thinkingMs) return part
        return {
          ...part,
          providerMetadata: {
            ...pm,
            cherry: { ...cherry, thinkingMs }
          }
        }
      })

      const assistantStatus = isAbort ? 'paused' : 'success'
      const totalTokens = assistantMessage.metadata?.totalTokens
      await dataApiService.post(`/topics/${this.topicId}/messages`, {
        body: {
          role: 'assistant',
          parentId: userParentId,
          assistantId: this.assistantId,
          data: { parts: normalizedParts },
          status: assistantStatus,
          ...(totalTokens !== undefined && { stats: { totalTokens } })
        }
      })

      logger.info('Persisted exchange', { userMsgId: userParentId, assistantMsgId: assistantMessage.id })

      // 3. Refresh history and sync Chat instance with real server IDs
      if (this.refreshFn) {
        const refreshedMessages = await this.refreshFn()
        if (refreshedMessages.length > 0) {
          this.chat.messages = refreshedMessages
        }
      }

      // 4. Mark fulfilled if no UI is watching
      if (this.refCount <= 0) {
        this.isFulfilled = true
      }
    } catch (err) {
      logger.error('Failed to persist exchange', { topicId: this.topicId, err })
    }

    // 5. Stream is done — notify manager so sidebar updates AND idle reap can trigger.
    // This is critical: if release() ran while streaming, it skipped scheduleReap.
    // Now that the stream is finished, the manager must re-check reap eligibility.
    this.onStatusChange?.()
  }
}

// ============================================================================
// ChatSessionManager — global singleton registry
// ============================================================================

class ChatSessionManager {
  private sessions = new Map<string, ChatSession>()
  private listeners = new Set<() => void>()

  /** Get existing session or create a new one. */
  getOrCreate(options: ChatSessionOptions): ChatSession {
    const existing = this.sessions.get(options.topicId)
    if (existing) {
      // Update mutable context (topic/assistant may have changed)
      existing.updateContext({
        topic: options.topic,
        historyIds: options.historyIds,
        refresh: options.refresh
      })
      return existing
    }

    const session = new ChatSession(options, () => this.notify())
    this.sessions.set(options.topicId, session)
    this.notify()
    return session
  }

  /** Get session if it exists. */
  get(topicId: string): ChatSession | undefined {
    return this.sessions.get(topicId)
  }

  /** Increment ref count (component mount). */
  retain(topicId: string): void {
    const session = this.sessions.get(topicId)
    if (!session) return
    session.refCount++
    clearTimeout(session.reapTimer)

    // User is viewing this topic — clear fulfilled indicator
    if (session.isFulfilled) {
      session.isFulfilled = false
      this.notify()
    }
  }

  /** Decrement ref count (component unmount). */
  release(topicId: string): void {
    const session = this.sessions.get(topicId)
    if (!session) return
    session.refCount = Math.max(0, session.refCount - 1)

    if (session.refCount <= 0 && isSessionIdle(session)) {
      this.scheduleReap(topicId, session)
    }
    // If still streaming → session survives until onFinish + re-check
  }

  /** Destroy a specific session immediately. */
  destroy(topicId: string): void {
    const session = this.sessions.get(topicId)
    if (!session) return
    clearTimeout(session.reapTimer)
    this.sessions.delete(topicId)
    this.notify()
    logger.info('Destroyed session', { topicId })
  }

  /** Topic IDs with active streams. */
  getStreamingTopicIds(): string[] {
    const result: string[] = []
    for (const [id, session] of this.sessions) {
      if (isSessionStreaming(session)) {
        result.push(id)
      }
    }
    return result
  }

  /** Topic IDs where stream completed but user hasn't viewed yet. */
  getFulfilledTopicIds(): string[] {
    const result: string[] = []
    for (const [id, session] of this.sessions) {
      if (session.isFulfilled) {
        result.push(id)
      }
    }
    return result
  }

  /** Check if any session is actively streaming (for generation guards). */
  get isAnyStreaming(): boolean {
    for (const session of this.sessions.values()) {
      if (isSessionStreaming(session)) return true
    }
    return false
  }

  /**
   * Subscribe to state changes (for React useSyncExternalStore).
   * Arrow function property — stable reference, safe to pass directly.
   */
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  /**
   * Cached snapshot for useSyncExternalStore getSnapshot.
   * CRITICAL: useSyncExternalStore requires getSnapshot to return the SAME reference
   * if nothing changed. Returning a new object each call causes infinite re-renders.
   * The snapshot is invalidated (set to null) on notify(), and rebuilt lazily.
   * Arrow function property — stable reference, safe to pass directly.
   */
  private cachedSnapshot: ChatSessionManagerSnapshot | null = null

  getSnapshot = (): ChatSessionManagerSnapshot => {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = {
        streamingTopicIds: this.getStreamingTopicIds(),
        fulfilledTopicIds: this.getFulfilledTopicIds(),
        isAnyStreaming: this.isAnyStreaming
      }
    }
    return this.cachedSnapshot
  }

  private notify(): void {
    this.cachedSnapshot = null

    // Check for sessions that became reapable (stream finished while refCount=0).
    // This closes the gap where release() skipped reap because stream was active.
    for (const [topicId, session] of this.sessions) {
      if (session.refCount <= 0 && isSessionIdle(session) && !session.reapTimer) {
        this.scheduleReap(topicId, session)
      }
    }

    for (const cb of this.listeners) {
      cb()
    }
  }

  private scheduleReap(topicId: string, session: ChatSession): void {
    clearTimeout(session.reapTimer)
    session.reapTimer = setTimeout(() => {
      // Re-check: session might have been retained again or started streaming
      if (session.refCount <= 0 && isSessionIdle(session)) {
        this.sessions.delete(topicId)
        this.notify()
        logger.info('Reaped idle session', { topicId })
      }
      this.enforceMaxIdleSessions()
    }, REAP_DELAY)
  }

  /** Evict oldest idle sessions if we exceed MAX_IDLE_SESSIONS. */
  private enforceMaxIdleSessions(): void {
    const idleSessions: Array<[string, ChatSession]> = []
    for (const [id, session] of this.sessions) {
      if (session.refCount <= 0 && isSessionIdle(session)) {
        idleSessions.push([id, session])
      }
    }
    // Evict oldest first (Map iteration order = insertion order)
    while (idleSessions.length > MAX_IDLE_SESSIONS) {
      const [topicId, session] = idleSessions.shift()!
      clearTimeout(session.reapTimer)
      this.sessions.delete(topicId)
      logger.info('Evicted idle session (LRU)', { topicId })
    }
    if (idleSessions.length > 0) {
      this.notify()
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function isSessionStreaming(session: ChatSession): boolean {
  const status = session.chat.status
  return status === 'streaming' || status === 'submitted'
}

function isSessionIdle(session: ChatSession): boolean {
  return !isSessionStreaming(session)
}

// ============================================================================
// Public types
// ============================================================================

export interface ChatSessionManagerSnapshot {
  streamingTopicIds: string[]
  fulfilledTopicIds: string[]
  isAnyStreaming: boolean
}

// ============================================================================
// Exports
// ============================================================================

export { MESSAGE_THROTTLE_MS }
export const chatSessionManager = new ChatSessionManager()
