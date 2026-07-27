import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import ConversationComposerLoading from '@renderer/components/composer/ConversationComposerLoading'
import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import type {
  ChatComposerResolvedContext,
  ChatConversationControlsChangeHandler
} from '@renderer/components/composer/variants/ChatComposer'
import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { lazy } from 'react'

import type { AddNewTopicPayload } from './types'

const ChatPlacementComposer = lazy(() =>
  import('@renderer/components/composer/variants/ChatComposer').then((module) => ({
    default: module.ChatPlacementComposer
  }))
)

interface ChatComposerSlotBaseProps {
  topic: Topic
  onSend: (
    text: string,
    options?: {
      mentionedModels?: UniqueModelId[]
      knowledgeBaseIds?: string[]
      userMessageParts?: CherryMessagePart[]
    }
  ) => Promise<void>
  captureLocalSendScrollEligibility?: () => void
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onCreateEmptyTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  composerContext?: ComposerContextValue
  assistantContext?: ChatComposerResolvedContext
  providers?: Provider[]
  assistantContextLoading?: boolean
  onConversationControlsChange?: ChatConversationControlsChangeHandler
}

type ChatComposerSlotProps =
  | (ChatComposerSlotBaseProps & { placement: 'home'; sendDisabled?: never })
  | (ChatComposerSlotBaseProps & { placement: 'docked'; sendDisabled?: boolean })

export default function ChatComposerSlot({
  placement,
  topic,
  onSend,
  captureLocalSendScrollEligibility,
  onNewTopic,
  onCreateEmptyTopic,
  sendDisabled,
  composerContext,
  assistantContext,
  providers,
  assistantContextLoading = false,
  onConversationControlsChange
}: ChatComposerSlotProps) {
  const fallback = assistantContextLoading ? (
    <ConversationComposerLoading forceNarrowLayout={placement === 'home'} />
  ) : placement === 'home' ? (
    <ChatPlacementComposer
      placement="home"
      scopeKey={topic.id}
      topicId={topic.id}
      assistantId={topic.assistantId}
      onSend={onSend}
      captureLocalSendScrollEligibility={captureLocalSendScrollEligibility}
      onNewTopic={onNewTopic}
      onCreateEmptyTopic={onCreateEmptyTopic}
      resolvedContext={assistantContext}
      resolvedProviders={providers}
      externalContextControls
      onConversationControlsChange={onConversationControlsChange}
    />
  ) : (
    <ChatPlacementComposer
      placement="docked"
      scopeKey={topic.id}
      topicId={topic.id}
      assistantId={topic.assistantId}
      onSend={onSend}
      captureLocalSendScrollEligibility={captureLocalSendScrollEligibility}
      onNewTopic={onNewTopic}
      onCreateEmptyTopic={onCreateEmptyTopic}
      sendDisabled={sendDisabled}
      resolvedContext={assistantContext}
      resolvedProviders={providers}
      externalContextControls
      onConversationControlsChange={onConversationControlsChange}
    />
  )

  return (
    <ConversationComposerSlot
      scopeKey={topic.id}
      composerContext={composerContext}
      fallback={fallback}
      forceNarrowLayout={placement === 'home'}
    />
  )
}
