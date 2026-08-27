import type { Topic } from '@renderer/types/topic'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { MessageListProvider } from './MessageListProvider'
import type {
  MessageContentContext,
  MessageListActions,
  MessageListItem,
  MessageListProviderValue,
  MessageRenderConfig
} from './types'
import { defaultMessageRenderConfig } from './types'
import { MessageContentContextKind } from './types'

const EMPTY_MESSAGE_ACTIONS: MessageListActions = {}

interface MessageContentProviderProps {
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  contentContext: MessageContentContext
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
  contentContext,
  children,
  topic,
  renderConfig,
  actions
}: MessageContentProviderProps) {
  const resolvedActions = actions ?? EMPTY_MESSAGE_ACTIONS
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
        topic: topic ?? createFallbackTopic(messages),
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
        getMessageActivityState: (message) => ({
          isProcessing: message.status === 'pending',
          isStreamTarget: message.status === 'pending',
          isApprovalAnchor: false
        })
      },
      actions: resolvedActions,
      meta: {
        conversation:
          contentContext.kind === MessageContentContextKind.Durable ? contentContext.conversation : undefined,
        selectionLayer: false
      }
    }),
    [contentContext, mergedRenderConfig, messages, partsByMessageId, resolvedActions, topic]
  )

  return <MessageListProvider value={value}>{children}</MessageListProvider>
}
