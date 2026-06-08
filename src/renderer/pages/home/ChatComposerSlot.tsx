import type { ComposerContextValue } from '@renderer/components/chat/composer/ComposerContext'
import ConversationComposerSlot from '@renderer/components/chat/composer/ConversationComposerSlot'
import { ChatPlacementComposer } from '@renderer/components/chat/composer/variants/ChatComposer'
import type { FileMetadata, Topic } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import type { AddNewTopicPayload } from './types'

interface ChatComposerSlotProps {
  isHome: boolean
  topic: Topic
  onSend: (
    text: string,
    options?: {
      files?: FileMetadata[]
      mentionedModels?: UniqueModelId[]
      knowledgeBaseIds?: string[]
      userMessageParts?: CherryMessagePart[]
    }
  ) => Promise<void>
  onTemporaryAssistantChange?: (assistantId: string | null) => void | Promise<void>
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  sendDisabled?: boolean
  composerContext?: ComposerContextValue
}

export default function ChatComposerSlot({
  isHome,
  topic,
  onSend,
  onTemporaryAssistantChange,
  onNewTopic,
  sendDisabled,
  composerContext
}: ChatComposerSlotProps) {
  const fallback = (
    <ChatPlacementComposer
      isHome={isHome}
      topic={topic}
      onSend={onSend}
      onTemporaryAssistantChange={onTemporaryAssistantChange}
      onNewTopic={onNewTopic}
      sendDisabled={isHome ? undefined : sendDisabled}
    />
  )

  return <ConversationComposerSlot composerContext={composerContext} fallback={fallback} />
}
