import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
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
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onCreateEmptyTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  composerContext?: ComposerContextValue
}

type ChatComposerSlotProps =
  | (ChatComposerSlotBaseProps & { placement: 'home'; sendDisabled?: never })
  | (ChatComposerSlotBaseProps & { placement: 'docked'; sendDisabled?: boolean })

export default function ChatComposerSlot({
  placement,
  topic,
  onSend,
  onNewTopic,
  onCreateEmptyTopic,
  sendDisabled,
  composerContext
}: ChatComposerSlotProps) {
  const fallback =
    placement === 'home' ? (
      <ChatPlacementComposer
        placement="home"
        scopeKey={topic.id}
        topicId={topic.id}
        assistantId={topic.assistantId}
        onSend={onSend}
        onNewTopic={onNewTopic}
        onCreateEmptyTopic={onCreateEmptyTopic}
      />
    ) : (
      <ChatPlacementComposer
        placement="docked"
        scopeKey={topic.id}
        topicId={topic.id}
        assistantId={topic.assistantId}
        onSend={onSend}
        onNewTopic={onNewTopic}
        onCreateEmptyTopic={onCreateEmptyTopic}
        sendDisabled={sendDisabled}
      />
    )

  return <ConversationComposerSlot scopeKey={topic.id} composerContext={composerContext} fallback={fallback} />
}
