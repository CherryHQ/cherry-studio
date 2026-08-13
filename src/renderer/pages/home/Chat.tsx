import { usePreference } from '@data/hooks/usePreference'
import CitationsPanel from '@renderer/components/chat/citations/CitationsPanel'
import { ChatLayoutModeProvider } from '@renderer/components/chat/layout/ChatLayoutModeContext'
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
import PromptPopup from '@renderer/components/popups/PromptPopup'
import { useCommandHandler } from '@renderer/hooks/command'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { useTopicMutations } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { ConversationCenterSlot, PaneManualToggleSignal } from '@renderer/types/conversationLayout'
import type { Citation } from '@renderer/types/message'
import type { Topic } from '@renderer/types/topic'
import type { FC, ReactNode } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ChatContent from './ChatContent'
import ChatNavbar from './components/ChatNavbar'
import { TopicRightPane, useTopicBranchLiveStateSetter } from './components/TopicRightPane'
import type { AddNewTopicPayload } from './types'

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
  /** The entry topic is still resolving — hold the loading center instead of the empty one. */
  topicPending?: boolean
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
  const [topicDisplayMode] = usePreference('topic.tab.display_mode')
  const [citationPanelCitations, setCitationPanelCitations] = useState<Citation[] | null>(null)
  const [branchLocateMessageId, setBranchLocateMessageId] = useState<string | undefined>()
  const setTopicBranchLiveState = useTopicBranchLiveStateSetter()

  const mainRef = React.useRef<HTMLDivElement>(null)
  const activeTopic = props.activeTopic
  const centerSurface = props.centerSurface
  const showConversation = Boolean(activeTopic && !centerSurface)
  const showConversationChrome = !centerSurface
  const activeTopicId = activeTopic?.id
  const assistantContext = useAssistant(activeTopic?.assistantId, {
    loadDefaultModel: Boolean(activeTopic)
  })
  const [conversationControlsSnapshot, setConversationControlsSnapshot] =
    useState<ChatConversationControlsSnapshot | null>(null)
  const activeConversationControlsSnapshot =
    conversationControlsSnapshot?.scopeKey === activeTopicId ? conversationControlsSnapshot : null
  // Provider metadata is only used by the selected-model details popover. A normal single-model
  // conversation already carries everything its trigger needs on the Model entity itself.
  const shouldLoadProviders = Boolean(
    activeTopic &&
      activeConversationControlsSnapshot &&
      (activeConversationControlsSnapshot.mentionedModels.length > 1 ||
        activeConversationControlsSnapshot.mentionedModelSelectorValue.length > 1 ||
        activeConversationControlsSnapshot.lockedMentionedModels.length > 1)
  )
  const { providers } = useProviders(undefined, { enabled: shouldLoadProviders })
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
        extraNode: <div className="mt-2 text-muted-foreground">{t('chat.topics.edit.title_tip')}</div>
      })
      if (name && topic.name !== name) {
        await patchTopic(topic.id, { name, isNameManuallyEdited: true })
      }
    },
    { enabled: showConversation }
  )

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
  const locateMessageId = locateMessageIdProp ?? branchLocateMessageId
  const handleLocateMessageHandled = useCallback(() => {
    setBranchLocateMessageId(undefined)
    if (locateMessageIdProp) {
      onLocateMessageHandledProp?.()
    }
  }, [locateMessageIdProp, onLocateMessageHandledProp])
  const centerContent =
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
        assistantContext={assistantContext}
        providers={providers}
        onConversationControlsChange={setConversationControlsSnapshot}
      />
    ) : (
      // Nothing left to resolve and still no topic: the library is genuinely empty, so settle on
      // the empty center rather than spinning forever. Same split as AgentChat.
      <ConversationCenterState state={props.topicPending ? 'loading' : 'empty'} />
    ))
  // ChatContent is keyed by topic; keep width-derived layout state outside that remount boundary.
  const center = <ChatLayoutModeProvider>{centerContent}</ChatLayoutModeProvider>

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
                  assistantTriggerAction={topicDisplayMode === 'assistant' ? 'edit' : 'select'}
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
      rightPane={<TopicRightPane.Viewport onLocateMessage={setBranchLocateMessageId} />}
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
