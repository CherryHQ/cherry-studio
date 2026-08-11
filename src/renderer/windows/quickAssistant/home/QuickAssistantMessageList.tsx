import { useMessageListRenderConfig } from '@renderer/components/chat/messages/hooks/useMessageListRenderConfig'
import { useMessagePlatformActions } from '@renderer/components/chat/messages/hooks/useMessagePlatformActions'
import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import {
  DEFAULT_MESSAGE_LIST_CONFIG,
  type MessageListItem,
  type MessageListMeta,
  type MessageListProviderValue,
  type MessageListState,
  type MessageStreamingLayers
} from '@renderer/components/chat/messages/types'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import type { Assistant } from '@renderer/types/assistant'
import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { Loader2 } from 'lucide-react'
import { useMemo, useRef } from 'react'

const EMPTY_TOPIC_MESSAGES: Topic['messages'] = []

interface QuickAssistantMessageListProps {
  route: 'chat' | 'summary' | 'explanation'
  topicId: string
  assistant: Assistant | null
  isOutputted: boolean
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers: MessageStreamingLayers
}

function useQuickAssistantMessageListProviderValue({
  route,
  topicId,
  assistant,
  messages,
  partsByMessageId,
  streamingLayers
}: Omit<QuickAssistantMessageListProps, 'isOutputted'>): MessageListProviderValue {
  const { renderConfig } = useMessageListRenderConfig()
  const platformActions = useMessagePlatformActions()
  const visibleMessages = useMemo(() => (route === 'chat' ? messages : messages.slice(1)), [messages, route])
  const messageItemCacheRef = useRef(
    new WeakMap<CherryUIMessage, { assistantId?: string; item: MessageListItem; topicId: string }>()
  )

  const messageItems = useMemo(
    () =>
      visibleMessages.map((message) => {
        const cached = messageItemCacheRef.current.get(message)
        if (cached && cached.assistantId === assistant?.id && cached.topicId === topicId) {
          return cached.item
        }

        const item = toMessageListItem(message, { assistantId: assistant?.id, topicId })
        messageItemCacheRef.current.set(message, { assistantId: assistant?.id, item, topicId })
        return item
      }),
    [assistant?.id, topicId, visibleMessages]
  )

  const topic = useMemo<Topic>(
    () => ({
      id: topicId,
      assistantId: assistant?.id,
      name: '',
      createdAt: '',
      updatedAt: '',
      messages: EMPTY_TOPIC_MESSAGES
    }),
    [assistant?.id, topicId]
  )

  const state = useMemo<MessageListState>(
    () => ({
      topic,
      messages: messageItems,
      partsByMessageId,
      streamingLayers,
      messageNavigation: 'none',
      listKey: topicId,
      renderConfig,
      ...DEFAULT_MESSAGE_LIST_CONFIG
    }),
    [messageItems, partsByMessageId, renderConfig, streamingLayers, topic, topicId]
  )
  const meta = useMemo<MessageListMeta>(
    () => ({
      selectionLayer: false,
      assistantProfile: assistant ? { name: assistant.name, avatar: assistant.emoji } : undefined
    }),
    [assistant]
  )

  return useMemo(() => ({ state, actions: platformActions, meta }), [meta, platformActions, state])
}

const QuickAssistantMessageList = (props: QuickAssistantMessageListProps) => {
  const value = useQuickAssistantMessageListProviderValue(props)

  return (
    <div className="bubble relative mb-auto flex min-h-0 w-full flex-1 [-webkit-app-region:no-drag]">
      <MessageListProvider value={value}>
        <MessageList />
      </MessageListProvider>
      {!props.isOutputted && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  )
}

export default QuickAssistantMessageList
