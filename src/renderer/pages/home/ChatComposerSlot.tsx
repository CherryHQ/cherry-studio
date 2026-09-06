import { useRightPanelPresentationMaximized } from '@renderer/components/chat/panes/Shell'
import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import {
  type ChatComposerResolvedContext,
  type ChatContextUsageSource,
  type ChatConversationControlsChangeHandler,
  ChatPlacementComposer
} from '@renderer/components/composer/variants/ChatComposer'
import type { Topic } from '@renderer/types/topic'
import type { ComposerChatTarget } from '@shared/ai/transport'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { memo } from 'react'

import { useOptionalTopicRightPaneActions } from './components/TopicRightPane'
import type { AddNewTopicPayload } from './types'

interface ChatComposerSlotBaseProps {
  topic: Topic
  contextUsage: ChatContextUsageSource | null
  onSend: (
    text: string,
    options?: {
      mentionedModels?: UniqueModelId[]
      userMessageParts?: CherryMessagePart[]
      chatTarget?: ComposerChatTarget
    }
  ) => Promise<boolean>
  chatTarget: ComposerChatTarget
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onCreateEmptyTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  composerContext?: ComposerContextValue
  assistantContext?: ChatComposerResolvedContext
  providers?: Provider[]
  onConversationControlsChange?: ChatConversationControlsChangeHandler
}

type ChatComposerSlotProps =
  | (ChatComposerSlotBaseProps & { placement: 'home'; sendDisabled?: never })
  | (ChatComposerSlotBaseProps & { placement: 'docked'; sendDisabled?: boolean })

function ChatComposerSlot({
  placement,
  topic,
  contextUsage,
  onSend,
  chatTarget,
  onNewTopic,
  onCreateEmptyTopic,
  sendDisabled,
  composerContext,
  assistantContext,
  providers,
  onConversationControlsChange
}: ChatComposerSlotProps) {
  const compactWhenSingleLine = useRightPanelPresentationMaximized()
  const topicRightPaneActions = useOptionalTopicRightPaneActions()
  const fallback =
    placement === 'home' ? (
      <ChatPlacementComposer
        placement="home"
        scopeKey={topic.id}
        topicId={topic.id}
        contextUsage={contextUsage}
        assistantId={topic.assistantId}
        onSend={onSend}
        chatTarget={chatTarget}
        onNewTopic={onNewTopic}
        onCreateEmptyTopic={onCreateEmptyTopic}
        resolvedContext={assistantContext}
        resolvedProviders={providers}
        externalContextControls
        compactWhenSingleLine={compactWhenSingleLine}
        previewInputFile={topicRightPaneActions?.previewInputFile}
        onConversationControlsChange={onConversationControlsChange}
      />
    ) : (
      <ChatPlacementComposer
        placement="docked"
        scopeKey={topic.id}
        topicId={topic.id}
        contextUsage={contextUsage}
        assistantId={topic.assistantId}
        onSend={onSend}
        chatTarget={chatTarget}
        onNewTopic={onNewTopic}
        onCreateEmptyTopic={onCreateEmptyTopic}
        sendDisabled={sendDisabled}
        resolvedContext={assistantContext}
        resolvedProviders={providers}
        externalContextControls
        compactWhenSingleLine={compactWhenSingleLine}
        previewInputFile={topicRightPaneActions?.previewInputFile}
        onConversationControlsChange={onConversationControlsChange}
      />
    )

  return <ConversationComposerSlot composerContext={composerContext} fallback={fallback} />
}

export default memo(ChatComposerSlot)
