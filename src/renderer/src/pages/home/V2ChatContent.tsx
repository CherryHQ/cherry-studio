import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import { isDev } from '@renderer/config/constant'
import { SiblingsProvider } from '@renderer/hooks/SiblingsContext'
import { ToolApprovalProvider } from '@renderer/hooks/ToolApprovalContext'
import { ChatContextProvider, useChatContextProvider } from '@renderer/hooks/useChatContext'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import { useToolApprovalBridge } from '@renderer/hooks/useToolApprovalBridge'
import { useTopicMessagesV2 } from '@renderer/hooks/useTopicMessagesV2'
import { V2ChatOverridesProvider } from '@renderer/hooks/V2ChatContext'
import type { FileMetadata, Topic } from '@renderer/types'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { FC, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'

import { useTopicMessagesCache } from './hooks/useTopicMessagesCache'
import { useV2ChatOverrides } from './hooks/useV2ChatOverrides'
import { useV2RenderingPipeline } from './hooks/useV2RenderingPipeline'
import Inputbar from './Inputbar/Inputbar'
import { PartsProvider, RefreshProvider } from './Messages/Blocks'
import ExecutionStreamCollector from './Messages/ExecutionStreamCollector'
import Messages from './Messages/Messages'

interface Props {
  topic: Topic
  setActiveTopic: (topic: Topic) => void
  mainHeight: string
  /**
   * If the active topic is a freshly-leased temporary one, this callback
   * migrates it into SQLite (with the same id) before the first message
   * is sent. Owned by HomePage so the lease and the persist trigger live
   * on the same hook instance. `initialName` seeds a placeholder topic
   * title so the sidebar isn't blank pre-auto-name.
   */
  onPersistTemporaryTopic?: (initialName?: string) => Promise<void>
}

/**
 * V2 chat content.
 *
 * Outer shell — waits on history to be loaded before mounting the inner
 * component (useChat seeds `initialMessages` once, at mount).
 *
 * Inner component composes three purpose-built hooks:
 *   - `useV2RenderingPipeline` — projects `uiMessages` into renderer
 *     `Message[]` and overlays per-execution streaming parts.
 *   - `useTopicMessagesCache` — optimistic SWR writes + DataApi mutation
 *     triggers for send / delete / edit / fork / setActiveNode.
 *   - `useV2ChatOverrides` — every write-side handler the
 *     `V2ChatContext` provides to downstream components.
 *
 * `useChatWithHistory` stays trigger-only: `sendMessage` / `regenerate`
 * / `stop` / `setMessages` / `activeExecutionIds`. Its
 * `state.messages` is not rendered; chunks land in per-execution
 * `ExecutionStreamCollector`s and are overlaid into the partsMap by
 * the rendering pipeline.
 */
const V2ChatContent: FC<Props> = ({ topic, setActiveTopic, mainHeight, onPersistTemporaryTopic }) => {
  const {
    uiMessages,
    siblingsMap,
    isLoading: isHistoryLoading,
    refresh,
    activeNodeId,
    loadOlder,
    hasOlder,
    mutate: messagesCacheMutate
  } = useTopicMessagesV2(topic.id)

  if (isHistoryLoading) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center"
        style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
        <div className="text-sm" style={{ color: 'var(--color-text-3)' }}>
          Loading conversation...
        </div>
      </div>
    )
  }

  return (
    <V2ChatContentInner
      topic={topic}
      setActiveTopic={setActiveTopic}
      mainHeight={mainHeight}
      onPersistTemporaryTopic={onPersistTemporaryTopic}
      initialMessages={uiMessages}
      uiMessages={uiMessages}
      siblingsMap={siblingsMap}
      refresh={refresh}
      activeNodeId={activeNodeId}
      loadOlder={loadOlder}
      hasOlder={hasOlder}
      messagesCacheMutate={messagesCacheMutate}
    />
  )
}

// ============================================================================
// Inner — only mounted after history is ready
// ============================================================================

interface InnerProps extends Props {
  /** One-time seed for `useChat(messages:)` — consumed on mount only. */
  initialMessages: CherryUIMessage[]
  /** Live DB-backed message list; reactive to SWR refreshes. */
  uiMessages: CherryUIMessage[]
  siblingsMap: ReturnType<typeof useTopicMessagesV2>['siblingsMap']
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
  loadOlder: () => void
  hasOlder: boolean
  messagesCacheMutate: ReturnType<typeof useTopicMessagesV2>['mutate']
}

const V2ChatContentInner: FC<InnerProps> = ({
  topic,
  setActiveTopic,
  mainHeight,
  onPersistTemporaryTopic,
  initialMessages,
  uiMessages,
  siblingsMap,
  refresh,
  activeNodeId,
  loadOlder,
  hasOlder,
  messagesCacheMutate
}) => {
  const { sendMessage, regenerate, stop, error, setMessages, activeExecutionIds, addToolApprovalResponse } =
    useChatWithHistory(topic.id, initialMessages, refresh)

  const respondToToolApproval = useToolApprovalBridge({ addToolApprovalResponse })

  // Rendering: project uiMessages + layer per-execution streaming overlay.
  const { projectedMessages, mergedPartsMap, handleExecutionMessagesChange, handleExecutionDispose } =
    useV2RenderingPipeline(uiMessages, activeExecutionIds, topic)

  // Topic-messages optimistic cache + DataApi mutation triggers.
  const cache = useTopicMessagesCache({ topicId: topic.id, mutate: messagesCacheMutate })

  // V2Chat write-side handlers (delete / edit / regenerate / resend /
  // fork / setActiveNode / clearTopic). Also exposes `capabilityBody` so
  // the send path below mirrors the same shape.
  const { overrides: v2ChatOverrides, capabilityBody } = useV2ChatOverrides({
    topic,
    uiMessages,
    projectedMessages,
    regenerate,
    setMessages,
    stop,
    refresh,
    cache
  })

  const handleSendV2 = useCallback(
    async (text: string, options?: { files?: FileMetadata[]; mentionedModels?: UniqueModelId[] }) => {
      if (onPersistTemporaryTopic) {
        try {
          // Seed the new topic with the user's first message as a placeholder
          // name so the sidebar entry isn't blank while the auto-namer runs.
          await onPersistTemporaryTopic(text)
        } catch (err) {
          console.warn('[V2ChatContent] failed to persist temporary topic, falling back', err)
        }
      }
      await cache.seedOptimisticUser({
        text,
        parentId: activeNodeId ?? null,
        files: options?.files
      })
      try {
        await sendMessage(
          { text },
          {
            body: {
              parentAnchorId: activeNodeId ?? undefined,
              files: options?.files,
              mentionedModels: options?.mentionedModels,
              ...capabilityBody
            }
          }
        )
      } catch (err) {
        // IPC reject / Main persistence error: drop the phantom bubble
        // by forcing a revalidation against the server.
        await cache.rollbackBranch()
        throw err
      }
    },
    [onPersistTemporaryTopic, activeNodeId, sendMessage, capabilityBody, cache]
  )

  const siblingsContextValue = useMemo(() => ({ siblingsMap, activeNodeId }), [siblingsMap, activeNodeId])

  return (
    <V2ChatOverridesProvider value={v2ChatOverrides}>
      <SiblingsProvider value={siblingsContextValue}>
        <RefreshProvider value={refresh}>
          <PartsProvider value={mergedPartsMap}>
            <ToolApprovalProvider value={respondToToolApproval}>
              <ChatContextBridge topic={topic}>
                <div
                  className="flex flex-1 flex-col justify-between"
                  style={{ height: `calc(${mainHeight} - var(--navbar-height))` }}>
                  {isDev && (
                    <div
                      className="fixed top-5 right-50 z-50 px-4 py-1 text-xs opacity-50"
                      style={{ color: 'var(--color-text-3)' }}>
                      [V2] {projectedMessages.length} msgs
                      {error && <span className="ml-2 text-red-500">{error.message}</span>}
                    </div>
                  )}

                  {activeExecutionIds.map((executionId) => (
                    <ExecutionStreamCollector
                      key={executionId}
                      topicId={topic.id}
                      executionId={executionId}
                      onMessagesChange={handleExecutionMessagesChange}
                      onDispose={handleExecutionDispose}
                    />
                  ))}

                  <Messages
                    key={topic.id}
                    topic={topic}
                    messages={projectedMessages}
                    loadOlder={loadOlder}
                    hasOlder={hasOlder}
                  />

                  <Inputbar topic={topic} setActiveTopic={setActiveTopic} onSend={handleSendV2} />
                </div>
              </ChatContextBridge>
            </ToolApprovalProvider>
          </PartsProvider>
        </RefreshProvider>
      </SiblingsProvider>
    </V2ChatOverridesProvider>
  )
}

/**
 * Bridge rendered inside `V2ChatOverridesProvider` + `PartsProvider` so
 * `useChatContextProvider` can read those contexts. Multi-select
 * floating popup mounts here because it depends on the chat context.
 */
const ChatContextBridge: FC<{ topic: Topic; children: ReactNode }> = ({ topic, children }) => {
  const chatContextValue = useChatContextProvider(topic)
  return (
    <ChatContextProvider value={chatContextValue}>
      {children}
      {chatContextValue.isMultiSelectMode && <MultiSelectActionPopup topic={topic} />}
    </ChatContextProvider>
  )
}

export default V2ChatContent
