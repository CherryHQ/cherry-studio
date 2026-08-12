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
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import { Loader2 } from 'lucide-react'
import { useMemo, useRef } from 'react'

const EMPTY_TOPIC_MESSAGES: Topic['messages'] = []

interface QuickAssistantMessageListProps {
  route: 'chat' | 'summary' | 'explanation'
  topicId: string
  assistant: Assistant | null
  model?: Model
  isOutputted: boolean
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers: MessageStreamingLayers
}

function useQuickAssistantMessageListProviderValue({
  route,
  topicId,
  assistant,
  model,
  messages,
  partsByMessageId,
  streamingLayers
}: Omit<QuickAssistantMessageListProps, 'isOutputted'>): MessageListProviderValue {
  const { renderConfig } = useMessageListRenderConfig()
  const platformActions = useMessagePlatformActions()
  const visibleMessages = useMemo(() => (route === 'chat' ? messages : messages.slice(1)), [messages, route])
  const messageItemCacheRef = useRef(
    new WeakMap<CherryUIMessage, { assistantId?: string; item: MessageListItem; modelId?: string; topicId: string }>()
  )
  const createdAtCacheRef = useRef({ topicId, byMessageId: new Map<string, string>() })
  if (createdAtCacheRef.current.topicId !== topicId) {
    createdAtCacheRef.current = { topicId, byMessageId: new Map() }
  }
  const fallbackModel = useMemo(() => {
    if (!model) return undefined
    const { modelId } = parseUniqueModelId(model.id)
    return {
      id: model.apiModelId ?? modelId,
      name: model.name,
      provider: model.providerId,
      group: model.group
    }
  }, [model])

  const messageItems = useMemo(
    () =>
      visibleMessages.map((message) => {
        const cached = messageItemCacheRef.current.get(message)
        if (
          cached &&
          cached.assistantId === assistant?.id &&
          cached.modelId === model?.id &&
          cached.topicId === topicId
        ) {
          return cached.item
        }

        const baseItem = toMessageListItem(message, { assistantId: assistant?.id, topicId })
        let createdAt = baseItem.createdAt || createdAtCacheRef.current.byMessageId.get(message.id)
        if (!createdAt) {
          createdAt = new Date().toISOString()
          createdAtCacheRef.current.byMessageId.set(message.id, createdAt)
        }
        const item = {
          ...baseItem,
          createdAt,
          ...(message.role === 'assistant' && {
            modelId: baseItem.modelId ?? model?.id,
            model: baseItem.model ?? fallbackModel
          })
        }
        messageItemCacheRef.current.set(message, { assistantId: assistant?.id, item, modelId: model?.id, topicId })
        return item
      }),
    [assistant?.id, fallbackModel, model?.id, topicId, visibleMessages]
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
