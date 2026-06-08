import { ChatLayoutModeProvider } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import {
  RefreshProvider,
  TranslationOverlayProvider,
  TranslationOverlaySetterProvider
} from '@renderer/components/chat/messages/blocks'
import type { TopicMessageFlowLiveState } from '@renderer/components/chat/messages/flow/topicMessageFlowLiveTree'
import type { MessageListActions } from '@renderer/components/chat/messages/types'
import ConversationStageCenter from '@renderer/components/chat/shell/ConversationStageCenter'
import { MessageEditingProvider } from '@renderer/context/MessageEditingContext'
import { ChatWriteProvider } from '@renderer/hooks/ChatWriteContext'
import { SiblingsProvider } from '@renderer/hooks/SiblingsContext'
import type { TemporaryConversation } from '@renderer/hooks/useTemporaryConversation'
import { useTopicMessages } from '@renderer/hooks/useTopicMessages'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { FC } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ChatComposerSlot from './ChatComposerSlot'
import ChatMain from './ChatMain'
import type { AddNewTopicPayload } from './types'
import { useChatRuntimeState } from './useChatRuntimeState'

interface Props {
  topic: Topic
  onOpenCitationsPanel?: MessageListActions['openCitationsPanel']
  onTemporaryAssistantChange?: (assistantId: string | null) => void | Promise<void>
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  onBranchLiveStateChange?: (state: TopicMessageFlowLiveState | null) => void
  clearBranchDraft?: () => void
  getBranchDraftAnchorId?: () => string | null
  /**
   * If the active topic is a freshly-leased temporary one, this callback
   * migrates it into SQLite (with the same id) before the first message
   * is sent. Owned by HomePage so the lease and the persist trigger live
   * on the same hook instance. `initialName` seeds a placeholder topic
   * title so the sidebar isn't blank pre-auto-name.
   */
  onPersistTemporaryTopic?: (initialName?: string) => Promise<TemporaryConversation | null>
}

/**
 * Home chat content.
 *
 * Outer shell — mounts the frame immediately; the shared message list owns the
 * initial-loading view so the composer doesn't disappear during topic switches.
 *
 * `useChatRuntimeState` owns message runtime concerns — stream handoff,
 * execution overlays, and write actions. This page keeps the provider/frame
 * composition visible.
 */
const ChatContent: FC<Props> = ({
  topic,
  onOpenCitationsPanel,
  onTemporaryAssistantChange,
  onNewTopic,
  locateMessageId,
  onLocateMessageHandled,
  onBranchLiveStateChange,
  clearBranchDraft,
  getBranchDraftAnchorId,
  onPersistTemporaryTopic
}) => {
  const [hasPersistedTemporaryTopic, setHasPersistedTemporaryTopic] = useState(false)
  useEffect(() => setHasPersistedTemporaryTopic(false), [topic.id])
  const isFreshTemporaryTopic = !!onPersistTemporaryTopic && !hasPersistedTemporaryTopic
  const {
    uiMessages,
    siblingsMap,
    isLoading: isHistoryLoading,
    refresh,
    activeNodeId,
    loadOlder,
    hasOlder,
    mutate: messagesCacheMutate
  } = useTopicMessages(topic.id, { fetchOnMount: !isFreshTemporaryTopic })

  return (
    <ChatContentInner
      topic={topic}
      onOpenCitationsPanel={onOpenCitationsPanel}
      onTemporaryAssistantChange={onTemporaryAssistantChange}
      onNewTopic={onNewTopic}
      locateMessageId={locateMessageId}
      onLocateMessageHandled={onLocateMessageHandled}
      onBranchLiveStateChange={onBranchLiveStateChange}
      clearBranchDraft={clearBranchDraft}
      getBranchDraftAnchorId={getBranchDraftAnchorId}
      onPersistTemporaryTopic={onPersistTemporaryTopic}
      isHistoryLoading={isHistoryLoading}
      isFreshTemporaryTopic={isFreshTemporaryTopic}
      onTemporaryTopicPersisted={() => setHasPersistedTemporaryTopic(true)}
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
// Inner — keeps composer mounted while history loads
// ============================================================================

interface InnerProps extends Props {
  isHistoryLoading: boolean
  isFreshTemporaryTopic: boolean
  onTemporaryTopicPersisted: () => void
  onBranchLiveStateChange?: (state: TopicMessageFlowLiveState | null) => void
  /** One-time seed for `useChat(messages:)` — consumed on mount only. */
  initialMessages: CherryUIMessage[]
  /** Live DB-backed message list; reactive to SWR refreshes. */
  uiMessages: CherryUIMessage[]
  siblingsMap: ReturnType<typeof useTopicMessages>['siblingsMap']
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
  loadOlder: () => void
  hasOlder: boolean
  messagesCacheMutate: ReturnType<typeof useTopicMessages>['mutate']
}

const ChatContentInner: FC<InnerProps> = ({
  topic,
  onOpenCitationsPanel,
  onTemporaryAssistantChange,
  onNewTopic,
  locateMessageId,
  onLocateMessageHandled,
  onBranchLiveStateChange,
  clearBranchDraft,
  getBranchDraftAnchorId,
  onPersistTemporaryTopic,
  isHistoryLoading,
  isFreshTemporaryTopic,
  onTemporaryTopicPersisted,
  initialMessages,
  uiMessages,
  siblingsMap,
  refresh,
  activeNodeId,
  loadOlder,
  hasOlder,
  messagesCacheMutate
}) => {
  const { t } = useTranslation()
  const locateLoadRequestRef = useRef<string | undefined>(undefined)
  const runtime = useChatRuntimeState({
    topic,
    isHistoryLoading,
    isFreshTemporaryTopic,
    onPersistTemporaryTopic,
    onTemporaryTopicPersisted,
    initialMessages,
    uiMessages,
    refresh,
    activeNodeId,
    messagesCacheMutate,
    onBranchLiveStateChange,
    clearBranchDraft,
    getBranchDraftAnchorId
  })
  const siblingsContextValue = useMemo(() => ({ siblingsMap, activeNodeId }), [siblingsMap, activeNodeId])

  useEffect(() => {
    if (!locateMessageId) {
      locateLoadRequestRef.current = undefined
      return
    }

    if (uiMessages.some((message) => message.id === locateMessageId)) {
      locateLoadRequestRef.current = undefined
      window.requestAnimationFrame(() => {
        void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + locateMessageId, true)
      })
      onLocateMessageHandled?.()
      return
    }

    if (hasOlder && !isHistoryLoading) {
      const requestKey = `${locateMessageId}:${uiMessages.length}`
      if (locateLoadRequestRef.current !== requestKey) {
        locateLoadRequestRef.current = requestKey
        loadOlder()
      }
      return
    }

    if (!hasOlder && !isHistoryLoading) {
      locateLoadRequestRef.current = undefined
      onLocateMessageHandled?.()
    }
  }, [hasOlder, isHistoryLoading, loadOlder, locateMessageId, onLocateMessageHandled, uiMessages])

  return (
    <ChatWriteProvider value={runtime.chatWriteActions}>
      <SiblingsProvider value={siblingsContextValue}>
        <RefreshProvider value={refresh}>
          <TranslationOverlaySetterProvider value={runtime.setTranslationOverlay}>
            <TranslationOverlayProvider value={runtime.translationOverlay}>
              <MessageEditingProvider>
                <ChatLayoutModeProvider>
                  {(() => {
                    const main = (
                      <ChatMain
                        key={topic.id}
                        topic={topic}
                        messages={runtime.messages}
                        partsByMessageId={runtime.partsByMessageId}
                        isInitialLoading={isHistoryLoading}
                        loadOlder={loadOlder}
                        hasOlder={hasOlder}
                        openCitationsPanel={onOpenCitationsPanel}
                      />
                    )
                    const composer = (
                      <ChatComposerSlot
                        isHome={runtime.shouldRenderHomeComposer}
                        topic={topic}
                        onSend={runtime.sendMessage}
                        onTemporaryAssistantChange={onTemporaryAssistantChange}
                        onNewTopic={onNewTopic}
                        sendDisabled={isHistoryLoading}
                        composerContext={runtime.composerContext}
                      />
                    )
                    const placement = runtime.shouldRenderHomeComposer ? 'home' : 'docked'
                    return (
                      <ConversationStageCenter
                        placement={placement}
                        main={main}
                        composer={composer}
                        homeWelcomeText={t('chat.home.welcome_title')}
                      />
                    )
                  })()}
                </ChatLayoutModeProvider>
              </MessageEditingProvider>
            </TranslationOverlayProvider>
          </TranslationOverlaySetterProvider>
        </RefreshProvider>
      </SiblingsProvider>
    </ChatWriteProvider>
  )
}

export default ChatContent
