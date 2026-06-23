import { dataApiService } from '@data/DataApiService'
import { useInvalidateCache } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { type ChatPanePosition, ConversationShell } from '@renderer/components/chat'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import type { TopicMessageFlowLiveState } from '@renderer/components/chat/messages/flow/topicMessageFlowLiveTree'
import type { ContentSearchRef } from '@renderer/components/ContentSearch'
import { ContentSearch } from '@renderer/components/ContentSearch'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { useCommandHandler } from '@renderer/hooks/command'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicMutations } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Citation, Topic } from '@renderer/types'
import type { FC, ReactNode } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import ChatContent from './ChatContent'
import ChatNavbar from './components/ChatNavbar'
import { TopicRightPane, useTopicBranchLiveStateSetter } from './components/TopicRightPane'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('Chat')

interface Props {
  activeTopic: Topic
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  showResourceListControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  onPaneCollapse?: () => void
}

const ChatInner: FC<Props> = (props) => {
  const { updateTopic: patchTopic } = useTopicMutations()
  const { t } = useTranslation()
  const [messageStyle] = usePreference('chat.message.style')
  const invalidateCache = useInvalidateCache()
  const [citationPanelCitations, setCitationPanelCitations] = useState<Citation[] | null>(null)
  const [branchLocateMessageId, setBranchLocateMessageId] = useState<string | undefined>()
  const setTopicBranchLiveState = useTopicBranchLiveStateSetter()
  const branchDraftAnchorIdRef = useRef<string | null>(null)
  const branchSendAnchorOverrideIdRef = useRef<string | null>(null)

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)
  const { setTimeoutTimer } = useTimer()

  useEffect(() => {
    branchDraftAnchorIdRef.current = null
    branchSendAnchorOverrideIdRef.current = null
    setTopicBranchLiveState(props.activeTopic.id, null)
    setBranchLocateMessageId(undefined)
    return () => {
      branchDraftAnchorIdRef.current = null
      branchSendAnchorOverrideIdRef.current = null
      setTopicBranchLiveState(props.activeTopic.id, null)
    }
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

  const handleBranchLiveStateChange = useCallback(
    (state: Parameters<typeof setTopicBranchLiveState>[1]) => {
      setTopicBranchLiveState(state?.topicId ?? props.activeTopic.id, state)
    },
    [props.activeTopic.id, setTopicBranchLiveState]
  )
  const getBranchDraftAnchorId = useCallback(
    () => branchDraftAnchorIdRef.current ?? branchSendAnchorOverrideIdRef.current,
    []
  )
  const clearBranchDraft = useCallback(() => {
    branchDraftAnchorIdRef.current = null
    branchSendAnchorOverrideIdRef.current = null
  }, [])
  const handleCancelBranchDraft = useCallback(
    (nextActiveNodeId?: string | null) => {
      branchDraftAnchorIdRef.current = null
      branchSendAnchorOverrideIdRef.current = nextActiveNodeId ?? null

      if (nextActiveNodeId === undefined) {
        setTopicBranchLiveState(props.activeTopic.id, null)
        return
      }

      setTopicBranchLiveState(props.activeTopic.id, {
        topicId: props.activeTopic.id,
        activeNodeId: nextActiveNodeId,
        nodes: []
      })
    },
    [props.activeTopic.id, setTopicBranchLiveState]
  )
  const handleStartBranchDraft = useCallback(
    async (anchorMessageId: string) => {
      await dataApiService.put(`/topics/${props.activeTopic.id}/active-node`, {
        body: { nodeId: anchorMessageId }
      })

      branchDraftAnchorIdRef.current = anchorMessageId
      branchSendAnchorOverrideIdRef.current = null
      const draftNodeId = `branch-draft:${anchorMessageId}`
      const draftState: TopicMessageFlowLiveState = {
        topicId: props.activeTopic.id,
        activeNodeId: draftNodeId,
        nodes: [
          {
            id: draftNodeId,
            parentId: anchorMessageId,
            role: 'user',
            preview: t('chat.message.flow.status.awaiting_input'),
            modelId: null,
            status: 'paused',
            createdAt: new Date().toISOString(),
            isInputDraft: true
          }
        ]
      }

      setTopicBranchLiveState(props.activeTopic.id, draftState)
      void EventEmitter.emit(EVENT_NAMES.FOCUS_CHAT_COMPOSER, { topicId: props.activeTopic.id })
      await invalidateCache(`/topics/${props.activeTopic.id}/messages`)
    },
    [invalidateCache, props.activeTopic.id, setTopicBranchLiveState, t]
  )
  const branchPaneDisabled = false
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
      topBar={
        <ChatNavbar
          showSidebarControls={props.showResourceListControls}
          sidebarOpen={props.sidebarOpen}
          onSidebarToggle={props.onSidebarToggle}
        />
      }
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
          onNewTopic={props.onNewTopic}
          locateMessageId={locateMessageId}
          onLocateMessageHandled={handleLocateMessageHandled}
          onBranchLiveStateChange={handleBranchLiveStateChange}
          clearBranchDraft={clearBranchDraft}
          getBranchDraftAnchorId={getBranchDraftAnchorId}
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
        !branchPaneDisabled ? (
          <TopicRightPane.MaximizedOverlay
            topicId={props.activeTopic.id}
            topicName={props.activeTopic.name}
            traceId={props.activeTopic.traceId}
            onLocateMessage={setBranchLocateMessageId}
            onStartBranchDraft={handleStartBranchDraft}
            onCancelBranchDraft={handleCancelBranchDraft}
          />
        ) : undefined
      }
      rightPane={
        !branchPaneDisabled ? (
          <TopicRightPane.Host
            topicId={props.activeTopic.id}
            topicName={props.activeTopic.name}
            traceId={props.activeTopic.traceId}
            onLocateMessage={setBranchLocateMessageId}
            onStartBranchDraft={handleStartBranchDraft}
            onCancelBranchDraft={handleCancelBranchDraft}
          />
        ) : undefined
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
