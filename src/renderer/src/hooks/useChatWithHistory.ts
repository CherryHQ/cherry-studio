/**
 * Shared hook wrapping `useChat` for Cherry's V2/agent/selection pipelines.
 *
 * Primary `useChat` is **trigger-only**: it owns `sendMessage` / `regenerate`
 * / `stop` / `setMessages` and keeps `state.messages` as the conversation
 * history context AI SDK passes back to the transport on each turn. Chunks
 * coming from Main are tagged with their execution's `modelId`
 * (`AiStreamManager.onChunk`) so they land in per-execution
 * `ExecutionStreamCollector` components, not here. Rendering is owned by
 * each caller (V2ChatContent / AgentChat / …).
 *
 * On stream-done / per-execution-error the hook refreshes the caller's
 * data source (DB via `refresh()`) and pushes the DB snapshot into
 * `state.messages` via `setMessages(refreshed)` — so the next turn's
 * request carries the canonical history, not stale in-memory chunks.
 */

import { useChat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import { cherryApprovalPredicate } from '@renderer/utils/toolApprovalPredicate'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ChatRequestOptions } from 'ai'
import { useCallback, useEffect, useRef } from 'react'

import { useTopicStreamStatus } from './useTopicStreamStatus'

const logger = loggerService.withContext('useChatWithHistory')

// Module-level empty-array constant so the `?? []` fallback in
// `activeExecutionIds` keeps a stable reference when the cache is
// undefined. Prevents downstream memos / effects from invalidating on
// every render while no stream is active.
const EMPTY_EXECUTIONS: readonly UniqueModelId[] = Object.freeze([])

// ── Return type ──

export interface UseChatWithHistoryResult {
  sendMessage: (message?: { text: string }, options?: ChatRequestOptions) => Promise<void>
  regenerate: (options?: ChatRequestOptions & { messageId?: string }) => Promise<void>
  stop: () => Promise<void>
  error: Error | undefined
  setMessages: (messages: CherryUIMessage[] | ((messages: CherryUIMessage[]) => CherryUIMessage[])) => void
  activeExecutionIds: readonly UniqueModelId[]
  /**
   * AI SDK v6 native tool-approval response. Flips a `ToolUIPart` from
   * `approval-requested` to `approval-responded` on the local message.
   * For Claude Agent approvals the caller must also unblock Main via
   * `window.api.ai.toolApproval.respond` (see `useToolApprovalBridge`).
   */
  addToolApprovalResponse: (args: { id: string; approved: boolean; reason?: string }) => void | PromiseLike<void>
}

// ── Hook ──

export function useChatWithHistory(
  topicId: string,
  initialMessages: CherryUIMessage[],
  refresh: () => Promise<CherryUIMessage[]>
): UseChatWithHistoryResult {
  const { setMessages, stop, status, error, sendMessage, regenerate, resumeStream, addToolApprovalResponse } =
    useChat<CherryUIMessage>({
      id: topicId,
      transport: ipcChatTransport,
      messages: initialMessages,
      experimental_throttle: 50,
      sendAutomaticallyWhen: cherryApprovalPredicate,
      onError: (streamError) => {
        logger.error('AI stream error', { topicId, streamError })
      }
    })

  // Stable ref for refresh to avoid re-subscribing IPC listeners
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // Active execution IDs for this topic come from the shared
  // `topic.stream.statuses` Record authored by Main's `AiStreamManager`.
  // An empty / missing entry means "no executions currently running".
  const { status: topicStreamStatus, activeExecutionIds: liveExecutionIds } = useTopicStreamStatus(topicId)
  const activeExecutionIds = liveExecutionIds.length > 0 ? liveExecutionIds : EMPTY_EXECUTIONS

  const resumeInFlightRef = useRef<Promise<void> | null>(null)

  const resumeActiveStream = useCallback(
    (reason: 'mount' | 'started-event') => {
      if (reason === 'mount' && (status === 'streaming' || status === 'submitted')) return
      if (resumeInFlightRef.current) return

      resumeInFlightRef.current = (async () => {
        if (reason === 'started-event') {
          // The `pending` broadcast reaches every window subscribed to
          // this topic — originator and passive observers alike. Both
          // need `refresh()` so the caller's data source picks up the
          // new DB row. For the originator (`submitted`/`streaming`)
          // we skip `setMessages` because `useChat` already owns an
          // `activeResponse` with the pre-allocated id; overwriting
          // `state.messages` would detach the in-flight bubble.
          try {
            const refreshed = await refreshRef.current()
            if (status !== 'streaming' && status !== 'submitted') {
              setMessages(refreshed)
            }
          } catch (err) {
            logger.warn('Failed to refresh messages before resuming stream', { topicId, err })
          }
        }

        if (status === 'streaming' || status === 'submitted') {
          return
        }

        await resumeStream()
      })()
        .catch((err) => {
          logger.warn('Failed to resume active stream', { topicId, reason, err })
        })
        .finally(() => {
          resumeInFlightRef.current = null
        })
    },
    [resumeStream, setMessages, status, topicId]
  )

  useEffect(() => {
    resumeActiveStream('mount')
  }, [resumeActiveStream])

  // Trigger reattach when a new stream is created on this topic.
  // The `pending` transition uniquely marks "send() just created a new
  // ActiveStream"; downstream deltas (streaming / done / error /
  // aborted) describe an ongoing lifecycle and must not retrigger a
  // reattach.
  const prevTopicStatusRef = useRef<typeof topicStreamStatus>(undefined)
  useEffect(() => {
    const prev = prevTopicStatusRef.current
    prevTopicStatusRef.current = topicStreamStatus
    if (topicStreamStatus === 'pending' && prev !== 'pending') {
      resumeActiveStream('started-event')
    }
  }, [resumeActiveStream, topicStreamStatus])

  const refreshAndReplace = useCallback(() => {
    void refreshRef
      .current()
      .then((refreshed) => {
        setMessages(refreshed)
      })
      .catch((err) => {
        logger.warn('Failed to refresh messages after stream end', { topicId, err })
      })
  }, [setMessages, topicId])

  // On stream done/error: replace messages with DB truth.
  //
  // Per-execution `done` events only trigger a refresh when the topic
  // is done — in a happy-path multi-model turn, all N executions
  // succeed in rapid succession and we let the topic-done event fold
  // them into a single refresh. Per-execution **error** events are
  // always refreshed individually: an errored execution is terminal
  // for that bubble and there's no guarantee the topic-done event
  // will land soon (other executions may still be streaming).
  useEffect(() => {
    const doneUnsub = window.api.ai.onStreamDone((data) => {
      if (data.topicId !== topicId) return
      if (data.executionId && !data.isTopicDone) return
      refreshAndReplace()
    })
    const errorUnsub = window.api.ai.onStreamError((data) => {
      if (data.topicId !== topicId) return
      refreshAndReplace()
    })
    return () => {
      doneUnsub()
      errorUnsub()
    }
  }, [topicId, refreshAndReplace])

  return {
    sendMessage,
    regenerate,
    stop,
    error,
    setMessages,
    activeExecutionIds,
    addToolApprovalResponse
  }
}
