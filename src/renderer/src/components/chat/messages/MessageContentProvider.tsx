import type { Topic } from '@renderer/types'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { useMessagePlatformActions } from './adapters/useMessagePlatformActions'
import { PartsProvider } from './blocks'
import { MessageListProvider } from './MessageListProvider'
import type { MessageListActions, MessageListItem, MessageListProviderValue, MessageRenderConfig } from './types'
import { defaultMessageEditorConfig, defaultMessageRenderConfig } from './types'

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
  const platformActions = useMessagePlatformActions()
  const mergedActions = useMemo<MessageListActions>(
    () => ({ ...platformActions, ...actions }),
    [actions, platformActions]
  )
  const mergedRenderConfig = useMemo(
    () => ({
      ...defaultMessageRenderConfig,
      ...renderConfig
    }),
    [renderConfig]
  )
  const editorConfig = useMemo(
    () => ({
      ...defaultMessageEditorConfig,
      fontSize: mergedRenderConfig.fontSize
    }),
    [mergedRenderConfig.fontSize]
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
        editorConfig,
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
      actions: mergedActions,
      meta: {
        selectionLayer: false
      }
    }),
    [editorConfig, mergedActions, mergedRenderConfig, messages, partsByMessageId, topic]
  )

  return (
    <MessageListProvider value={value}>
      <PartsProvider value={partsByMessageId}>{children}</PartsProvider>
    </MessageListProvider>
  )
}
