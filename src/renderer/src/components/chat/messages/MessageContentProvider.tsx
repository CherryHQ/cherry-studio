import type { Topic } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { PartsProvider } from './blocks'
import { MessageListProvider } from './MessageListProvider'
import type { MessageListActions, MessageListItem, MessageListProviderValue, MessageRenderConfig } from './types'
import { defaultMessageRenderConfig } from './types'

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
  const value = useMemo<MessageListProviderValue>(
    () => ({
      state: {
        topic: topic ?? createFallbackTopic(messages),
        messages,
        partsByMessageId,
        hasOlder: false,
        messageNavigation: 'none',
        estimateSize: 0,
        overscan: 0,
        loadOlderDelayMs: 0,
        loadingResetDelayMs: 0,
        renderConfig: {
          ...defaultMessageRenderConfig,
          ...renderConfig
        },
        selection: {
          enabled: false,
          isMultiSelectMode: false,
          selectedMessageIds: []
        },
        getMessageActivityState: (message) => ({
          isProcessing: message.status === 'pending',
          isStreamTarget: message.status === 'pending',
          isApprovalAnchor: false
        })
      },
      actions: actions ?? {},
      meta: {
        selectionLayer: false
      }
    }),
    [actions, messages, partsByMessageId, renderConfig, topic]
  )

  return (
    <MessageListProvider value={value}>
      <PartsProvider value={partsByMessageId}>{children}</PartsProvider>
    </MessageListProvider>
  )
}
