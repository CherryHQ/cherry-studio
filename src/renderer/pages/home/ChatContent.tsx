import { ChatLayoutModeProvider } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import {
  RefreshProvider,
  TranslationOverlayProvider,
  TranslationOverlaySetterProvider
} from '@renderer/components/chat/messages/blocks'
import { MessageEditingProvider } from '@renderer/components/chat/messages/editing/MessageEditingContext'
import type { TopicMessageFlowLiveState } from '@renderer/components/chat/messages/flow/topicMessageFlowLiveTree'
import type { MessageListActions } from '@renderer/components/chat/messages/types'
import ConversationStageCenter from '@renderer/components/chat/shell/ConversationStageCenter'
import { ChatWriteProvider } from '@renderer/hooks/chat/ChatWriteContext'
import { SiblingsProvider } from '@renderer/hooks/SiblingsContext'
import { useTopicMessages } from '@renderer/hooks/useTopicMessages'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { FC } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import ChatComposerSlot from './ChatComposerSlot'
import ChatMain from './ChatMain'
import type { AddNewTopicPayload } from './types'
import { useChatRuntimeState } from './useChatRuntimeState'

interface Props {
  topic: Topic
  onOpenCitationsPanel?: MessageListActions['openCitationsPanel']
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  onBranchLiveStateChange?: (state: TopicMessageFlowLiveState | null) => void
  clearBranchDraft?: () => void
  getBranchDraftAnchorId?: () => string | null
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
  onNewTopic,
  locateMessageId,
  onLocateMessageHandled,
  onBranchLiveStateChange,
  clearBranchDraft,
  getBranchDraftAnchorId
}) => {
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
  } = useTopicMessages(topic.id)

  return (
    <ChatContentInner
      topic={topic}
      onOpenCitationsPanel={onOpenCitationsPanel}
      onNewTopic={onNewTopic}
      locateMessageId={locateMessageId}
      onLocateMessageHandled={onLocateMessageHandled}
      onBranchLiveStateChange={onBranchLiveStateChange}
      clearBranchDraft={clearBranchDraft}
      getBranchDraftAnchorId={getBranchDraftAnchorId}
      isHistoryLoading={isHistoryLoading}
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
// Inner — keeps composer mounted while history loads
// ============================================================================

interface InnerProps extends Props {
  isHistoryLoading: boolean
  onBranchLiveStateChange?: (state: TopicMessageFlowLiveState | null) => void
  /** One-time seed for `useChat(messages:)` — consumed on mount only. */
  initialMessages: CherryUIMessage[]
  /** Live DB-backed message list; reactive to SWR refreshes. */
  uiMessages: CherryUIMessage[]
  siblingsMap: ReturnType<typeof useTopicMessages>['siblingsMap']
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
  rootId: string | null
  loadOlder: () => void
  hasOlder: boolean
  messagesCacheMutate: ReturnType<typeof useTopicMessages>['mutate']
}

const ChatContentInner: FC<InnerProps> = ({
  topic,
  onOpenCitationsPanel,
  onNewTopic,
  locateMessageId,
  onLocateMessageHandled,
  onBranchLiveStateChange,
  clearBranchDraft,
  getBranchDraftAnchorId,
  isHistoryLoading,
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
  const { t } = useTranslation()
  const locateLoadRequestRef = useRef<string | undefined>(undefined)
  const runtime = useChatRuntimeState({
    topic,
    isHistoryLoading,
    initialMessages,
    uiMessages,
    refresh,
    activeNodeId,
    rootId,
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
      onNewTopic={onNewTopic}
      sendDisabled={isHistoryLoading}
      composerContext={runtime.composerContext}
    />
  )
  const placement = runtime.shouldRenderHomeComposer ? 'home' : 'docked'

  return (
    <ChatWriteProvider value={runtime.chatWriteActions}>
      <SiblingsProvider value={siblingsContextValue}>
        <RefreshProvider value={refresh}>
          <TranslationOverlaySetterProvider value={runtime.setTranslationOverlay}>
            <TranslationOverlayProvider value={runtime.translationOverlay}>
              <MessageEditingProvider>
                <ChatLayoutModeProvider>
                  <ConversationStageCenter
                    placement={placement}
                    main={main}
                    composer={composer}
                    homeWelcomeText={t('chat.home.welcome_title')}
                  />
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
