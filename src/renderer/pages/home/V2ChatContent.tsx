import { loggerService } from '@logger'
import MultiSelectActionPopup from '@renderer/components/Popups/MultiSelectionPopup'
import { SiblingsProvider } from '@renderer/hooks/SiblingsContext'
import { ToolApprovalProvider } from '@renderer/hooks/ToolApprovalContext'
import { ChatContextProvider, useChatContextProvider } from '@renderer/hooks/useChatContext'
import { useChatWithHistory } from '@renderer/hooks/useChatWithHistory'
import type { ExecutionFinishEvent } from '@renderer/hooks/useExecutionOverlay'
import { useExecutionOverlay } from '@renderer/hooks/useExecutionOverlay'
import { useToolApprovalBridge } from '@renderer/hooks/useToolApprovalBridge'
import { useTopicMessagesV2 } from '@renderer/hooks/useTopicMessagesV2'
import { V2ChatOverridesProvider } from '@renderer/hooks/V2ChatContext'
import type { FileMetadata, Topic } from '@renderer/types'
import { buildFilePartsForAttachments } from '@renderer/utils/file/buildFileParts'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('V2ChatContent')

import { usePendingMessages } from './hooks/usePendingMessages'
import { useTopicMessagesCache } from './hooks/useTopicMessagesCache'
import { useV2ChatOverrides } from './hooks/useV2ChatOverrides'
import { useV2RenderingPipeline } from './hooks/useV2RenderingPipeline'
import Inputbar from './Inputbar/Inputbar'
import {
  PartsProvider,
  RefreshProvider,
  TranslationOverlayProvider,
  TranslationOverlaySetterProvider
} from './Messages/Blocks'
import type { TranslationOverlayEntry, TranslationOverlaySetter } from './Messages/Blocks/V2Contexts'
import Messages from './Messages/Messages'

interface Props {
  topic: Topic
  setActiveTopic: (topic: Topic) => void
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
 * / `stop` / `setMessages` / `activeExecutions`. Its
 * `state.messages` is not rendered; chunks land in per-execution
 * `ExecutionStreamCollector`s and are overlaid into the partsMap by
 * the rendering pipeline.
 */
const V2ChatContent: FC<Props> = ({ topic, setActiveTopic, onPersistTemporaryTopic }) => {
  const { t } = useTranslation()
  const [hasPersistedTemporaryTopic, setHasPersistedTemporaryTopic] = useState(false)
  useEffect(() => setHasPersistedTemporaryTopic(false), [topic.id])
  const isFreshTemporaryTopic = !!onPersistTemporaryTopic && !hasPersistedTemporaryTopic
  const {
    uiMessages,
    siblingsMap,
    isLoading: isHistoryLoading,
    refresh,
    activeNodeId,
    rootId,
    loadOlder,
    hasOlder,
    mutate: messagesCacheMutate
  } = useTopicMessagesV2(topic.id, { enabled: !isFreshTemporaryTopic })

  if (isHistoryLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
        <div className="text-sm" style={{ color: 'var(--color-text-3)' }}>
          {t('common.loading')}
        </div>
      </div>
    )
  }

  return (
    <V2ChatContentInner
      topic={topic}
      setActiveTopic={setActiveTopic}
      onPersistTemporaryTopic={onPersistTemporaryTopic}
      isFreshTemporaryTopic={isFreshTemporaryTopic}
      onTemporaryTopicPersisted={() => setHasPersistedTemporaryTopic(true)}
      initialMessages={uiMessages}
      uiMessages={uiMessages}
      siblingsMap={siblingsMap}
      refresh={refresh}
      activeNodeId={activeNodeId}
      rootId={rootId}
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
  isFreshTemporaryTopic: boolean
  onTemporaryTopicPersisted: () => void
  /** One-time seed for `useChat(messages:)` — consumed on mount only. */
  initialMessages: CherryUIMessage[]
  /** Live DB-backed message list; reactive to SWR refreshes. */
  uiMessages: CherryUIMessage[]
  siblingsMap: ReturnType<typeof useTopicMessagesV2>['siblingsMap']
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
  rootId: string | null
  loadOlder: () => void
  hasOlder: boolean
  messagesCacheMutate: ReturnType<typeof useTopicMessagesV2>['mutate']
}

const V2ChatContentInner: FC<InnerProps> = ({
  topic,
  setActiveTopic,
  onPersistTemporaryTopic,
  isFreshTemporaryTopic,
  onTemporaryTopicPersisted,
  initialMessages,
  uiMessages,
  siblingsMap,
  refresh,
  activeNodeId,
  rootId,
  loadOlder,
  hasOlder,
  messagesCacheMutate
}) => {
  const { sendMessage, regenerate, stop, status, setMessages, activeExecutions } = useChatWithHistory(
    topic.id,
    initialMessages,
    refresh
  )

  // Pending overlay (Phase 4): the just-sent turn shown instantly, in local
  // state, never written to the authoritative SWR cache. `messages` is the
  // single render selector = DB truth ++ unclaimed pending.
  const { pendingMessages, addPending } = usePendingMessages(topic.id, uiMessages)
  const messages = useMemo(
    () => (pendingMessages.length > 0 ? [...uiMessages, ...pendingMessages] : uiMessages),
    [uiMessages, pendingMessages]
  )

  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') return
    // Trigger Chat is seeded with DB truth only (pending is client-local and
    // must not be serialized into the next send/regenerate request).
    setMessages(uiMessages)
  }, [uiMessages, status, setMessages])

  const respondToToolApproval = useToolApprovalBridge(topic.id)

  // Per-topic translation overlay. Lives here (above `useV2RenderingPipeline`)
  // so the merge step can layer in-flight translation chunks on top of the
  // DB-backed parts. Writers (`useTranslateMessage`) flip entries via the
  // setter context; readers (the pipeline) consume the map directly.
  const [translationOverlay, setTranslationOverlayMap] = useState<Record<string, TranslationOverlayEntry>>({})
  const setTranslationOverlay = useCallback<TranslationOverlaySetter>((messageId, entry) => {
    setTranslationOverlayMap((prev) => {
      if (entry == null) {
        if (!(messageId in prev)) return prev
        const rest = { ...prev }
        delete rest[messageId]
        return rest
      }
      const existing = prev[messageId]
      if (
        existing &&
        existing.content === entry.content &&
        existing.targetLanguage === entry.targetLanguage &&
        existing.sourceLanguage === entry.sourceLanguage
      ) {
        return prev
      }
      return { ...prev, [messageId]: entry }
    })
  }, [])

  // `useExecutionOverlay`'s onFinish needs `disposeOverlay` (returned by the
  // same hook) and `cache` (declared below), so route through a ref the hook
  // reads via its own latest-callback ref — keeps hook order stable.
  const finishRef = useRef<(executionId: string, event: ExecutionFinishEvent) => void>(undefined)
  const { overlay, disposeOverlay } = useExecutionOverlay(topic.id, activeExecutions, messages, {
    onFinish: (executionId, event) => finishRef.current?.(executionId, event)
  })

  const { projectedMessages, mergedPartsMap } = useV2RenderingPipeline(messages, topic, overlay, translationOverlay)

  const cache = useTopicMessagesCache({ topicId: topic.id, mutate: messagesCacheMutate })

  const handleExecutionFinish = useCallback(
    (_executionId: string, { message, isError }: ExecutionFinishEvent) => {
      if (isError || !message.parts?.length) {
        // Error / no content: force a clean revalidate, then drop overlay.
        void cache.rollbackBranch().then(() => disposeOverlay(message.id))
        return
      }
      // Success / aborted-with-content: do NOT write streamed parts to the
      // SWR cache. Backend persists the final row; refresh DB *first*, THEN
      // dispose the overlay so there is no gap between overlay and authoritative
      // parts. `.finally` ensures the overlay is released even if the refresh
      // rejects (otherwise it would linger).
      void refresh().finally(() => disposeOverlay(message.id))
    },
    [cache, disposeOverlay, refresh]
  )
  finishRef.current = handleExecutionFinish

  // V2Chat write-side handlers (delete / edit / regenerate / resend /
  // fork / setActiveNode / clearTopic). Also exposes `capabilityBody` so
  // the send path below mirrors the same shape.
  const { overrides: v2ChatOverrides, capabilityBody } = useV2ChatOverrides({
    topic,
    uiMessages: messages,
    rootId,
    regenerate,
    setMessages,
    stop,
    refresh,
    cache
  })

  const handleSendV2 = useCallback(
    async (text: string, options?: { files?: FileMetadata[]; mentionedModels?: UniqueModelId[] }) => {
      if (isFreshTemporaryTopic && onPersistTemporaryTopic) {
        try {
          // Seed the new topic with the user's first message as a placeholder
          // name so the topic title isn't blank while the auto-namer runs.
          await onPersistTemporaryTopic(text)
          onTemporaryTopicPersisted()
        } catch (err) {
          logger.warn('failed to persist temporary topic, falling back', err as Error)
        }
      }
      // Instant echo in local state only (not the SWR cache). The pending
      // group is reconciled / dropped by `usePendingMessages` off the
      // `streamOpen` ack — no rollbackBranch needed here.
      addPending({
        text,
        parentId: activeNodeId ?? null,
        files: options?.files,
        withAssistantPlaceholder: !options?.mentionedModels?.length
      })
      // Build v2 FileEntry-backed FileUIParts so the persisted user message
      // carries `providerMetadata.cherry.fileEntryId` (path-resilient across
      // userData moves). AI SDK's sendMessage takes `files: FileUIPart[]`
      // alongside `text`; IpcChatTransport then reads `lastMessage.parts`
      // and these ride along automatically.
      const fileParts = options?.files?.length ? await buildFilePartsForAttachments(options.files) : []
      await sendMessage(
        { text, files: fileParts },
        {
          body: {
            parentAnchorId: activeNodeId ?? undefined,
            mentionedModels: options?.mentionedModels,
            ...capabilityBody
          }
        }
      )
    },
    [
      isFreshTemporaryTopic,
      onPersistTemporaryTopic,
      onTemporaryTopicPersisted,
      activeNodeId,
      sendMessage,
      capabilityBody,
      addPending
    ]
  )

  const siblingsContextValue = useMemo(() => ({ siblingsMap, activeNodeId }), [siblingsMap, activeNodeId])

  return (
    <V2ChatOverridesProvider value={v2ChatOverrides}>
      <SiblingsProvider value={siblingsContextValue}>
        <RefreshProvider value={refresh}>
          <TranslationOverlaySetterProvider value={setTranslationOverlay}>
            <TranslationOverlayProvider value={translationOverlay}>
              <PartsProvider value={mergedPartsMap}>
                <ToolApprovalProvider value={respondToToolApproval}>
                  <ChatContextBridge topic={topic}>
                    <div className="flex min-h-0 flex-1 flex-col justify-between">
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
            </TranslationOverlayProvider>
          </TranslationOverlaySetterProvider>
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
