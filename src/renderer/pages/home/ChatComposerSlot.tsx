import type { ComposerContextValue } from '@renderer/components/composer/ComposerContext'
import ConversationComposerSlot from '@renderer/components/composer/ConversationComposerSlot'
import { ChatPlacementComposer } from '@renderer/components/composer/variants/ChatComposer'
import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import type { AddNewTopicPayload } from './types'

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

  return <ConversationComposerSlot composerContext={composerContext} fallback={fallback} />
}
