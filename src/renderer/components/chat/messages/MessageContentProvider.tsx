import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { useMessageActivityState } from './hooks/useMessageActivityState'
import { MessageListProvider } from './MessageListProvider'
import type { MessageListActions, MessageListItem, MessageListProviderValue, MessageRenderConfig } from './types'
import { defaultMessageRenderConfig } from './types'

const EMPTY_MESSAGE_ACTIONS: MessageListActions = {}

interface MessageContentProviderProps {
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  children: ReactNode
  topic?: Topic
  renderConfig?: Partial<MessageRenderConfig>
  actions?: MessageListActions
}

function createFallbackTopic(messages: MessageListItem[]): Topic {
  const firstMessage = messages[0]
  const topicId = firstMessage?.topicId || 'standalone-message-content'

  return {
    id: topicId,
    assistantId: firstMessage?.assistantId || '',
    name: '',
    lastActivityAt: firstMessage?.updatedAt || firstMessage?.createdAt || '',
    createdAt: firstMessage?.createdAt || '',
    updatedAt: firstMessage?.updatedAt || '',
    messages: []
  } as Topic
}

export function MessageContentProvider({
  messages,
  partsByMessageId,
  children,
  topic,
  renderConfig,
  actions
}: MessageContentProviderProps) {
  const resolvedActions = actions ?? EMPTY_MESSAGE_ACTIONS
  const resolvedTopic = useMemo(() => topic ?? createFallbackTopic(messages), [messages, topic])
  const messageActivity = useMessageActivityState(resolvedTopic.id)
  const mergedRenderConfig = useMemo(
    () => ({
      ...defaultMessageRenderConfig,
      ...renderConfig
    }),
    [renderConfig]
  )
  const value = useMemo<MessageListProviderValue>(
    () => ({
      state: {
        topic: resolvedTopic,
        messages,
        partsByMessageId,
        hasOlder: false,
        messageNavigation: 'none',
        estimateSize: 0,
        overscan: 0,
        loadOlderDelayMs: 0,
        loadingResetDelayMs: 0,
        renderConfig: mergedRenderConfig,
        selection: {
          enabled: false,
          isMultiSelectMode: false,
          selectedMessageIds: []
        },
        getMessageActivityState: messageActivity.getMessageActivityState,
        messageActivityStore: messageActivity.store
      },
      actions: resolvedActions,
      meta: {
        selectionLayer: false
      }
    }),
    [mergedRenderConfig, messageActivity, messages, partsByMessageId, resolvedActions, resolvedTopic]
  )

  return <MessageListProvider value={value}>{children}</MessageListProvider>
}
