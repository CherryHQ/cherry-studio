import { dataApiService } from '@data/DataApiService'
import { useInvalidateCache } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import type { TopicMessageFlowLiveState } from '@renderer/components/chat/flow'
import { ResourcePaneCountButton, type ResourcePaneCountButtonProps } from '@renderer/components/chat/panes/Shell'
import ConversationCenterState from '@renderer/components/chat/shell/ConversationCenterState'
import type { ConversationCenterSlot } from '@renderer/components/chat/shell/ConversationPageShell'
import ConversationShell from '@renderer/components/chat/shell/ConversationShell'
import type { ChatPanePosition } from '@renderer/components/chat/shell/paneLayout'
import type { ContentSearchRef } from '@renderer/components/ContentSearch'
import { ContentSearch } from '@renderer/components/ContentSearch'
import PromptPopup from '@renderer/components/popups/PromptPopup'
import { useCommandHandler } from '@renderer/hooks/command'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicMutations } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Citation } from '@renderer/types/message'
import type { Topic } from '@renderer/types/topic'
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
  activeTopic?: Topic
  centerSurface?: ConversationCenterSlot | null
  pane?: ReactNode
  paneOpen?: boolean
  panePosition?: ChatPanePosition
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onCreateEmptyTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  showResourceListControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
  locateMessageId?: string
  onLocateMessageHandled?: () => void
  onPaneCollapse?: () => void
  onPaneAutoCollapseChange?: (collapsed: boolean) => void
  resourcePaneCount?: ResourcePaneCountButtonProps
}

const Chat: FC<Props> = (props) => {
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
  const activeTopic = props.activeTopic
  const centerSurface = props.centerSurface
  const showConversation = Boolean(activeTopic && !centerSurface)
  const activeTopicId = activeTopic?.id
  const locateMessageIdProp = props.locateMessageId
  const onLocateMessageHandledProp = props.onLocateMessageHandled

  useEffect(() => {
    branchDraftAnchorIdRef.current = null
    branchSendAnchorOverrideIdRef.current = null
    setBranchLocateMessageId(undefined)
    if (!activeTopicId) return

    setTopicBranchLiveState(activeTopicId, null)
    return () => {
      branchDraftAnchorIdRef.current = null
      branchSendAnchorOverrideIdRef.current = null
      setTopicBranchLiveState(activeTopicId, null)
    }
  }, [activeTopicId, setTopicBranchLiveState])

  useHotkeys(
    'esc',
    () => {
      contentSearchRef.current?.disable()
    },
    { enabled: showConversation },
    [showConversation]
  )

  useCommandHandler(
    'chat.message.search',
    () => {
      if (!showConversation) return

      try {
        const selectedText = window.getSelection()?.toString().trim()
        contentSearchRef.current?.enable(selectedText)
      } catch (error) {
        logger.error('Error enabling content search:', error as Error)
      }
    },
    { enabled: showConversation }
  )

  useCommandHandler(
    'topic.rename',
    async () => {
      if (!showConversation) return

      const topic = activeTopic
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
    },
    { enabled: showConversation }
  )

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
      const topicId = state?.topicId ?? activeTopicId
      if (topicId) setTopicBranchLiveState(topicId, state)
    },
    [activeTopicId, setTopicBranchLiveState]
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
      if (!activeTopicId) return

      if (nextActiveNodeId === undefined) {
        setTopicBranchLiveState(activeTopicId, null)
        return
      }

      setTopicBranchLiveState(activeTopicId, {
        topicId: activeTopicId,
        activeNodeId: nextActiveNodeId,
        nodes: []
      })
    },
    [activeTopicId, setTopicBranchLiveState]
  )
  const handleStartBranchDraft = useCallback(
    async (anchorMessageId: string) => {
      if (!activeTopicId) return

      await dataApiService.put(`/topics/${activeTopicId}/active-node`, {
        body: { nodeId: anchorMessageId }
      })

      branchDraftAnchorIdRef.current = anchorMessageId
      branchSendAnchorOverrideIdRef.current = null
      const draftNodeId = `branch-draft:${anchorMessageId}`
      const draftState: TopicMessageFlowLiveState = {
        topicId: activeTopicId,
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

      setTopicBranchLiveState(activeTopicId, draftState)
      void EventEmitter.emit(EVENT_NAMES.FOCUS_CHAT_COMPOSER, { topicId: activeTopicId })
      await invalidateCache(`/topics/${activeTopicId}/messages`)
    },
    [activeTopicId, invalidateCache, setTopicBranchLiveState, t]
  )
  const locateMessageId = locateMessageIdProp ?? branchLocateMessageId
  const handleLocateMessageHandled = useCallback(() => {
    setBranchLocateMessageId(undefined)
    if (locateMessageIdProp) {
      onLocateMessageHandledProp?.()
    }
  }, [locateMessageIdProp, onLocateMessageHandledProp])
  const center =
    centerSurface?.content ??
    (activeTopic ? (
      <ChatContent
        key={activeTopic.id}
        topic={activeTopic}
        onOpenCitationsPanel={handleOpenCitationsPanel}
        onNewTopic={props.onNewTopic}
        onCreateEmptyTopic={props.onCreateEmptyTopic}
        locateMessageId={locateMessageId}
        onLocateMessageHandled={handleLocateMessageHandled}
        onBranchLiveStateChange={handleBranchLiveStateChange}
        clearBranchDraft={clearBranchDraft}
        getBranchDraftAnchorId={getBranchDraftAnchorId}
        onStartBranchDraft={handleStartBranchDraft}
      />
    ) : (
      <ConversationCenterState state="loading" />
    ))

  return (
    <ConversationShell
      id="chat"
      className={activeTopic || centerSurface ? messageStyle : undefined}
      pane={props.pane}
      paneOpen={props.paneOpen}
      panePosition={props.panePosition}
      onPaneCollapse={props.onPaneCollapse}
      onPaneAutoCollapseChange={props.onPaneAutoCollapseChange}
      topBar={
        showConversation ? (
          <ChatNavbar
            showSidebarControls={props.showResourceListControls}
            sidebarOpen={props.sidebarOpen}
            onSidebarToggle={props.onSidebarToggle}
          />
        ) : undefined
      }
      topRightTool={
        showConversation ? (
          <>
            {props.resourcePaneCount && <ResourcePaneCountButton {...props.resourcePaneCount} />}
            <TopicRightPane.Shortcuts />
          </>
        ) : undefined
      }
      showTopRightToolWhenPaneOpen
      sidePanel={
        showConversation ? (
          <CitationsPanel
            open={citationsPanelOpen}
            onClose={() => setCitationPanelCitations(null)}
            citations={citationPanelCitations ?? []}
          />
        ) : undefined
      }
      center={center}
      centerTopOverlay={
        showConversation ? (
          <ContentSearch
            ref={contentSearchRef}
            searchTarget={mainRef as React.RefObject<HTMLElement>}
            filter={contentSearchFilter}
            includeUser={filterIncludeUser}
            onIncludeUserChange={userOutlinedItemClickHandler}
            positionMode="absolute"
          />
        ) : undefined
      }
      rightPane={
        <TopicRightPane.Viewport
          onLocateMessage={setBranchLocateMessageId}
          onStartBranchDraft={handleStartBranchDraft}
          onCancelBranchDraft={handleCancelBranchDraft}
        />
      }
      centerId={centerSurface?.id ?? (showConversation ? 'chat-main' : undefined)}
      centerRef={centerSurface?.ref ?? (showConversation ? mainRef : undefined)}
      centerClassName={
        centerSurface?.className ??
        (showConversation ? 'transform-[translateZ(0)] relative justify-between' : undefined)
      }
    />
  )
}

export default Chat
