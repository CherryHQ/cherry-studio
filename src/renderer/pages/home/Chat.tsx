import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useCommandHandler } from '@renderer/commands'
import { type ChatPanePosition, ConversationShell } from '@renderer/components/chat'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import type { MessageListActions } from '@renderer/components/chat/messages/types'
import type { ContentSearchRef } from '@renderer/components/ContentSearch'
import { ContentSearch } from '@renderer/components/ContentSearch'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import type { TemporaryConversation } from '@renderer/hooks/useTemporaryConversation'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicMutations } from '@renderer/hooks/useTopic'
import type { Citation, Topic } from '@renderer/types'
import type { FC, ReactNode } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import ChatContent from './ChatContent'
import ChatNavbar from './components/ChatNavBar'
import { TopicRightPane, useTopicBranchLiveStateSetter, useTopicRightPaneActions } from './components/TopicRightPane'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('Chat')

interface Props {
  activeTopic: Topic
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  showResourceListControls?: boolean
  onTemporaryAssistantChange?: (assistantId: string | null) => void | Promise<void>
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  onPaneCollapse?: () => void
  /**
   * Called by ChatContent before the first message of a freshly-leased
   * temporary topic is sent. HomePage owns the lease so it also owns the
   * persist trigger. `initialName` becomes a placeholder topic title so
   * the sidebar isn't blank in the gap before auto-naming runs.
   */
  onPersistTemporaryTopic?: (initialName?: string) => Promise<TemporaryConversation | null>
}

const ChatInner: FC<Props> = (props) => {
  const { updateTopic: patchTopic } = useTopicMutations()
  const { t } = useTranslation()
  const [messageStyle] = usePreference('chat.message.style')
  const [citationPanelCitations, setCitationPanelCitations] = useState<Citation[] | null>(null)
  const [branchLocateMessageId, setBranchLocateMessageId] = useState<string | undefined>()
  const setTopicBranchLiveState = useTopicBranchLiveStateSetter()
  const { openTrace } = useTopicRightPaneActions()

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)
  const { setTimeoutTimer } = useTimer()

  useEffect(() => {
    setTopicBranchLiveState(props.activeTopic.id, null)
    setBranchLocateMessageId(undefined)
    return () => setTopicBranchLiveState(props.activeTopic.id, null)
  }, [props.activeTopic.id, setTopicBranchLiveState])

  useHotkeys('esc', () => {
    contentSearchRef.current?.disable()
  })

  useCommandHandler('chat.message.search', () => {
    try {
      const selectedText = window.getSelection()?.toString().trim()
      contentSearchRef.current?.enable(selectedText)
    } catch (error) {
      logger.error('Error enabling content search:', error as Error)
    }
  })

  useCommandHandler('topic.rename', async () => {
    const topic = props.activeTopic
    if (!topic) return

    const name = await PromptPopup.show({
      title: t('chat.topics.edit.title'),
      message: '',
      defaultValue: topic.name || '',
      extraNode: <div className="mt-2 text-foreground-secondary">{t('chat.topics.edit.title_tip')}</div>
    })
    if (name && topic.name !== name) {
      await patchTopic(topic.id, { name, isNameManuallyEdited: true })
    }
  })

  const contentSearchFilter: NodeFilter = {
    acceptNode(node) {
      const container = node.parentElement?.closest('.message-content-container')
      if (!container) return NodeFilter.FILTER_REJECT
      const message = container.closest('.message')
      if (!message) return NodeFilter.FILTER_REJECT
      if (filterIncludeUser) return NodeFilter.FILTER_ACCEPT
      if (message.classList.contains('message-assistant')) return NodeFilter.FILTER_ACCEPT
      return NodeFilter.FILTER_REJECT
    }
  }

  const userOutlinedItemClickHandler = () => {
    setFilterIncludeUser(!filterIncludeUser)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeoutTimer(
          'userOutlinedItemClickHandler',
          () => {
            contentSearchRef.current?.search()
            contentSearchRef.current?.focus()
          },
          0
        )
      })
    })
  }

  const citationsPanelOpen = citationPanelCitations !== null

  const handleOpenCitationsPanel = useCallback(({ citations }: { citations: Citation[] }) => {
    setCitationPanelCitations(citations)
  }, [])

  const handleOpenTrace = useCallback<NonNullable<MessageListActions['openTrace']>>(
    (message, options) => {
      if (!message.traceId) return
      openTrace({
        topicId: message.topicId,
        traceId: message.traceId,
        modelName: options?.modelName
      })
    },
    [openTrace]
  )

  const handleBranchLiveStateChange = useCallback(
    (state: Parameters<typeof setTopicBranchLiveState>[1]) => {
      setTopicBranchLiveState(state?.topicId ?? props.activeTopic.id, state)
    },
    [props.activeTopic.id, setTopicBranchLiveState]
  )
  const branchPaneDisabled = !!props.onPersistTemporaryTopic
  const locateMessageId = props.locateMessageId ?? branchLocateMessageId
  const handleLocateMessageHandled = useCallback(() => {
    setBranchLocateMessageId(undefined)
    if (props.locateMessageId) {
      props.onLocateMessageHandled?.()
    }
  }, [props.locateMessageId, props.onLocateMessageHandled])

  return (
    <ConversationShell
      id="chat"
      className={messageStyle}
      pane={props.pane}
      paneOpen={props.paneOpen}
      panePosition={props.panePosition}
      onPaneCollapse={props.onPaneCollapse}
      topBar={<ChatNavbar showSidebarControls={props.showResourceListControls} />}
      topRightTool={<TopicRightPane.Toggle disabled={branchPaneDisabled} />}
      sidePanel={
        <CitationsPanel
          open={citationsPanelOpen}
          onClose={() => setCitationPanelCitations(null)}
          citations={citationPanelCitations ?? []}
        />
      }
      center={
        <ChatContent
          key={props.activeTopic.id}
          topic={props.activeTopic}
          onOpenCitationsPanel={handleOpenCitationsPanel}
          onOpenTrace={handleOpenTrace}
          onNewTopic={props.onNewTopic}
          onTemporaryAssistantChange={props.onTemporaryAssistantChange}
          locateMessageId={locateMessageId}
          onLocateMessageHandled={handleLocateMessageHandled}
          onBranchLiveStateChange={handleBranchLiveStateChange}
          onPersistTemporaryTopic={props.onPersistTemporaryTopic}
        />
      }
      centerTopOverlay={
        <ContentSearch
          ref={contentSearchRef}
          searchTarget={mainRef as React.RefObject<HTMLElement>}
          filter={contentSearchFilter}
          includeUser={filterIncludeUser}
          onIncludeUserChange={userOutlinedItemClickHandler}
          positionMode="absolute"
        />
      }
      centerOverlay={
        !branchPaneDisabled && (
          <TopicRightPane.MaximizedOverlay
            topicId={props.activeTopic.id}
            topicName={props.activeTopic.name}
            onLocateMessage={setBranchLocateMessageId}
          />
        )
      }
      rightPane={
        branchPaneDisabled ? undefined : (
          <TopicRightPane.Host
            topicId={props.activeTopic.id}
            topicName={props.activeTopic.name}
            onLocateMessage={setBranchLocateMessageId}
          />
        )
      }
      centerId="chat-main"
      centerRef={mainRef}
      centerClassName="transform-[translateZ(0)] relative justify-between"
    />
  )
}

const Chat: FC<Props> = (props) => (
  <TopicRightPane>
    <ChatInner {...props} />
  </TopicRightPane>
)

export default Chat
