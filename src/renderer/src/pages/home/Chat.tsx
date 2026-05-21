import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { ChatAppShell, type ChatPanePosition, OverlayHost } from '@renderer/components/chat'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import type { ContentSearchRef } from '@renderer/components/ContentSearch'
import { ContentSearch } from '@renderer/components/ContentSearch'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import type { TemporaryConversation } from '@renderer/hooks/useTemporaryConversation'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicMutations } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Citation, Topic } from '@renderer/types'
import { classNames } from '@renderer/utils'
import type { FC, ReactNode } from 'react'
import React, { useCallback, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import ChatContent from './ChatContent'
import ChatNavbar from './components/ChatNavBar'
import TopicMessageFlowPanel from './components/TopicMessageFlowPanel'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('Chat')

interface Props {
  activeTopic: Topic
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  hideNavbar?: boolean
  onOpenSidePanelDrawer?: () => void | Promise<void>
  onTemporaryAssistantChange?: (assistantId: string | null) => void | Promise<void>
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  /**
   * Called by ChatContent before the first message of a freshly-leased
   * temporary topic is sent. HomePage owns the lease so it also owns the
   * persist trigger. `initialName` becomes a placeholder topic title so
   * the sidebar isn't blank in the gap before auto-naming runs.
   */
  onPersistTemporaryTopic?: (initialName?: string) => Promise<TemporaryConversation | null>
}

const Chat: FC<Props> = (props) => {
  const { updateTopic: patchTopic } = useTopicMutations()
  const { t } = useTranslation()
  const [messageStyle] = usePreference('chat.message.style')
  const [citationPanelCitations, setCitationPanelCitations] = useState<Citation[] | null>(null)
  const [topicFlowPanelOpen, setTopicFlowPanelOpen] = useState(false)

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)
  const { setTimeoutTimer } = useTimer()

  useHotkeys('esc', () => {
    contentSearchRef.current?.disable()
  })

  useShortcut('chat.search_message', () => {
    try {
      const selectedText = window.getSelection()?.toString().trim()
      contentSearchRef.current?.enable(selectedText)
    } catch (error) {
      logger.error('Error enabling content search:', error as Error)
    }
  })

  useShortcut('topic.rename', async () => {
    const topic = props.activeTopic
    if (!topic) return

    void EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR)

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

  const mainHeight = 'calc(100vh - var(--navbar-height) - 6px)'
  const citationsPanelOpen = citationPanelCitations !== null

  const handleOpenCitationsPanel = useCallback(({ citations }: { citations: Citation[] }) => {
    setTopicFlowPanelOpen(false)
    setCitationPanelCitations(citations)
  }, [])

  const handleOpenTopicFlowPanel = useCallback(() => {
    setCitationPanelCitations(null)
    setTopicFlowPanelOpen(true)
  }, [])

  return (
    <div
      id="chat"
      className={classNames([
        messageStyle,
        'flex h-[calc(100vh-var(--navbar-height)-6px)] flex-1 flex-col overflow-hidden rounded-tl-[10px] rounded-bl-[10px] bg-(--color-background)'
      ])}>
      <QuickPanelProvider>
        <ChatAppShell
          pane={props.pane}
          paneOpen={props.paneOpen}
          panePosition={props.panePosition}
          topBar={
            props.hideNavbar ? undefined : (
              <ChatNavbar
                onOpenSidePanelDrawer={props.onOpenSidePanelDrawer}
                onOpenTopicFlow={handleOpenTopicFlowPanel}
              />
            )
          }
          sidePanel={
            <>
              <CitationsPanel
                open={citationsPanelOpen}
                onClose={() => setCitationPanelCitations(null)}
                citations={citationPanelCitations ?? []}
              />
              <TopicMessageFlowPanel
                open={topicFlowPanelOpen}
                onClose={() => setTopicFlowPanelOpen(false)}
                topicId={props.activeTopic.id}
                topicName={props.activeTopic.name}
              />
            </>
          }
          centerContent={
            <ChatContent
              key={props.activeTopic.id}
              topic={props.activeTopic}
              mainHeight={mainHeight}
              onOpenCitationsPanel={handleOpenCitationsPanel}
              onNewTopic={props.onNewTopic}
              onTemporaryAssistantChange={props.onTemporaryAssistantChange}
              locateMessageId={props.locateMessageId}
              onLocateMessageHandled={props.onLocateMessageHandled}
              onPersistTemporaryTopic={props.onPersistTemporaryTopic}
              renderFrame={({ main, bottomComposer, overlay }) => (
                <>
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{main}</div>
                  {bottomComposer}
                  <OverlayHost>
                    {overlay}
                    <ContentSearch
                      ref={contentSearchRef}
                      searchTarget={mainRef as React.RefObject<HTMLElement>}
                      filter={contentSearchFilter}
                      includeUser={filterIncludeUser}
                      onIncludeUserChange={userOutlinedItemClickHandler}
                    />
                  </OverlayHost>
                </>
              )}
            />
          }
          centerId="chat-main"
          centerRef={mainRef}
          centerClassName="transform-[translateZ(0)] relative justify-between"
        />
      </QuickPanelProvider>
    </div>
  )
}

export default Chat
