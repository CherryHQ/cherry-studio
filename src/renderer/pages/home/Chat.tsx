import { useMutation } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import { ResourcePaneCountButton, type ResourcePaneCountButtonProps } from '@renderer/components/chat/panes/Shell'
import ConversationCenterState from '@renderer/components/chat/shell/ConversationCenterState'
import ConversationShell from '@renderer/components/chat/shell/ConversationShell'
import { useConversationTopBarPortalLayout } from '@renderer/components/chat/shell/ConversationTopBarPortal'
import type { ChatPanePosition } from '@renderer/components/chat/shell/paneLayout'
import {
  ChatConversationControls,
  type ChatConversationControlsProps
} from '@renderer/components/composer/variants/chat/ChatConversationControls'
import type { ChatConversationControlsSnapshot } from '@renderer/components/composer/variants/ChatComposer'
import type { ContentSearchRef } from '@renderer/components/ContentSearch'
import { ContentSearch } from '@renderer/components/ContentSearch'
import PromptPopup from '@renderer/components/popups/PromptPopup'
import { useCommandHandler } from '@renderer/hooks/command'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { useTopicMutations } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ConversationCenterSlot, PaneManualToggleSignal } from '@renderer/types/conversationLayout'
import type { Citation } from '@renderer/types/message'
import type { Topic } from '@renderer/types/topic'
import type { ConcreteApiPaths } from '@shared/data/api/types'
import type { FC, ReactNode } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'

import ChatContent from './ChatContent'
import ChatNavbar from './components/ChatNavbar'
import { TopicRightPane, useTopicBranchLiveStateSetter } from './components/TopicRightPane'
import type { AddNewTopicPayload } from './types'

const logger = loggerService.withContext('Chat')
const EMPTY_MODELS: ChatConversationControlsSnapshot['mentionedModels'] = []
const NOOP_MODEL_SELECT: ChatConversationControlsSnapshot['onModelSelect'] = () => undefined
const NOOP_MODELS_SELECT: ChatConversationControlsSnapshot['onMentionedModelsSelect'] = () => undefined
const NOOP_MULTI_SELECT_MODE_CHANGE: ChatConversationControlsSnapshot['onMentionedModelMultiSelectModeChange'] = () =>
  undefined
const NOOP_MODEL_SELECTOR_RESTORE: ChatConversationControlsSnapshot['onMentionedModelSelectorRestore'] = () => undefined

type ChatTopBarControlsProps = Omit<ChatConversationControlsProps, 'iconOnly' | 'side'>

function ChatTopBarControls(props: ChatTopBarControlsProps) {
  const { iconOnly } = useConversationTopBarPortalLayout()

  return <ChatConversationControls {...props} side="bottom" iconOnly={iconOnly} />
}

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
  paneManualToggle?: PaneManualToggleSignal
  resourcePaneCount?: ResourcePaneCountButtonProps
}

const Chat: FC<Props> = (props) => {
  const { updateTopic: patchTopic } = useTopicMutations()
  const { t } = useTranslation()
  const [messageStyle] = usePreference('chat.message.style')
  const [citationPanelCitations, setCitationPanelCitations] = useState<Citation[] | null>(null)
  const [branchLocateMessageId, setBranchLocateMessageId] = useState<string | undefined>()
  const setTopicBranchLiveState = useTopicBranchLiveStateSetter()

  const mainRef = React.useRef<HTMLDivElement>(null)
  const contentSearchRef = useRef<ContentSearchRef>(null)
  const [filterIncludeUser, setFilterIncludeUser] = useState(false)
  const { setTimeoutTimer } = useTimer()
  const activeTopic = props.activeTopic
  const centerSurface = props.centerSurface
  const showConversation = Boolean(activeTopic && !centerSurface)
  const showConversationChrome = !centerSurface
  const activeTopicId = activeTopic?.id
  const branchDraftRefreshPaths = React.useMemo<ConcreteApiPaths[]>(
    () => (activeTopicId ? [`/topics/${activeTopicId}/messages`, `/topics/${activeTopicId}/tree`] : []),
    [activeTopicId]
  )
  const { trigger: createBranchDraft } = useMutation('POST', '/topics/:topicId/branch-drafts', {
    refresh: branchDraftRefreshPaths
  })
  const assistantContext = useAssistant(activeTopic?.assistantId, {
    loadDefaultModel: Boolean(activeTopic)
  })
  const { providers } = useProviders(undefined, { enabled: Boolean(activeTopic) })
  const [conversationControlsSnapshot, setConversationControlsSnapshot] =
    useState<ChatConversationControlsSnapshot | null>(null)
  const activeConversationControlsSnapshot =
    conversationControlsSnapshot?.scopeKey === activeTopicId ? conversationControlsSnapshot : null
  const locateMessageIdProp = props.locateMessageId
  const onLocateMessageHandledProp = props.onLocateMessageHandled

  useEffect(() => {
    setBranchLocateMessageId(undefined)
    if (!activeTopicId) return

    setTopicBranchLiveState(activeTopicId, null)
    return () => {
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
  const handleAssistantChange = useCallback(
    async (nextAssistantId: string | null) => {
      if (!activeTopic || !nextAssistantId || nextAssistantId === activeTopic.assistantId) return
      await patchTopic(activeTopic.id, { assistantId: nextAssistantId })
    },
    [activeTopic, patchTopic]
  )
  const handleRestoreComposerFocus = useCallback(() => {
    if (!activeTopicId) return
    void EventEmitter.emit(EVENT_NAMES.FOCUS_CHAT_COMPOSER, { topicId: activeTopicId })
  }, [activeTopicId])

  const handleBranchLiveStateChange = useCallback(
    (state: Parameters<typeof setTopicBranchLiveState>[1]) => {
      const topicId = state?.topicId ?? activeTopicId
      if (topicId) setTopicBranchLiveState(topicId, state)
    },
    [activeTopicId, setTopicBranchLiveState]
  )
  const handleStartBranchDraft = useCallback(
    async (anchorMessageId: string) => {
      if (!activeTopicId) return

      await createBranchDraft({
        params: { topicId: activeTopicId },
        body: { parentId: anchorMessageId }
      })

      void EventEmitter.emit(EVENT_NAMES.FOCUS_CHAT_COMPOSER, { topicId: activeTopicId })
    },
    [activeTopicId, createBranchDraft]
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
        onStartBranchDraft={handleStartBranchDraft}
        assistantContext={assistantContext}
        providers={providers}
        onConversationControlsChange={setConversationControlsSnapshot}
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
      paneManualToggle={props.paneManualToggle}
      topBar={
        showConversationChrome ? (
          <ChatNavbar
            conversationControls={
              activeTopic ? (
                <ChatTopBarControls
                  assistantId={assistantContext.assistant?.id ?? null}
                  assistantName={
                    assistantContext.assistant?.name ??
                    (assistantContext.isLoading ? t('common.loading') : t('button.select_assistant'))
                  }
                  assistantEmoji={assistantContext.assistant?.emoji}
                  model={assistantContext.model}
                  modelPending={
                    assistantContext.isLoading || assistantContext.isModelPending || !activeConversationControlsSnapshot
                  }
                  providers={providers}
                  mentionedModels={activeConversationControlsSnapshot?.mentionedModels ?? EMPTY_MODELS}
                  mentionedModelSelectorValue={
                    activeConversationControlsSnapshot?.mentionedModelSelectorValue ??
                    (assistantContext.model ? [assistantContext.model] : EMPTY_MODELS)
                  }
                  lockedMentionedModels={activeConversationControlsSnapshot?.lockedMentionedModels ?? EMPTY_MODELS}
                  mentionedModelMultiSelectMode={
                    activeConversationControlsSnapshot?.mentionedModelMultiSelectMode ?? false
                  }
                  selectModelLabel={assistantContext.isModelPending ? t('common.loading') : t('button.select_model')}
                  useMentionedModelSelector
                  shouldAutoSelectCreatedAssistant={false}
                  onDialogCloseAutoFocus={handleRestoreComposerFocus}
                  onAssistantChange={handleAssistantChange}
                  onModelSelect={activeConversationControlsSnapshot?.onModelSelect ?? NOOP_MODEL_SELECT}
                  onMentionedModelsSelect={
                    activeConversationControlsSnapshot?.onMentionedModelsSelect ?? NOOP_MODELS_SELECT
                  }
                  onMentionedModelMultiSelectModeChange={
                    activeConversationControlsSnapshot?.onMentionedModelMultiSelectModeChange ??
                    NOOP_MULTI_SELECT_MODE_CHANGE
                  }
                  onMentionedModelSelectorRestore={
                    activeConversationControlsSnapshot?.onMentionedModelSelectorRestore ?? NOOP_MODEL_SELECTOR_RESTORE
                  }
                />
              ) : undefined
            }
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
