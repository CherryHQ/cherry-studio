import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useV2Chat } from '@renderer/hooks/V2ChatContext'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { updateCodeBlock } from '@renderer/utils/markdown'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { CherryMessagePart } from '@shared/data/types/message'
import { last } from 'lodash'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { resolvePartFromParts, usePartsMap } from '../blocks'
import type { MessageListProviderValue } from '../types'

const logger = loggerService.withContext('HomeMessageListAdapter')

interface HomeMessageListParams {
  topic: Topic
  messages: Message[]
  loadOlder?: () => void
  hasOlder?: boolean
  onComponentUpdate?(): void
  onFirstUpdate?(): void
}

export function useHomeMessageListProviderValue({
  topic,
  messages,
  loadOlder,
  hasOlder = false,
  onComponentUpdate,
  onFirstUpdate
}: HomeMessageListParams): MessageListProviderValue {
  const { assistant } = useAssistant(topic.assistantId)
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  const { t } = useTranslation()
  const partsMap = usePartsMap()
  const v2Chat = useV2Chat()

  const messagesRef = useRef<Message[]>(messages)
  const partsMapRef = useRef(partsMap)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    partsMapRef.current = partsMap
  }, [partsMap])

  const clearTopic = useCallback(
    async (data: Topic) => {
      if (data && data.id !== topic.id) return
      await v2Chat?.clearTopicMessages()
    },
    [v2Chat, topic.id]
  )

  useEffect(() => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.CLEAR_MESSAGES, async (data: Topic) => {
        window.modal.confirm({
          title: t('chat.input.clear.title'),
          content: t('chat.input.clear.content'),
          centered: true,
          onOk: () => clearTopic(data)
        })
      }),
      EventEmitter.on(EVENT_NAMES.NEW_CONTEXT, () => {
        logger.info('[NEW_CONTEXT] Not yet implemented.')
      }),
      EventEmitter.on(
        EVENT_NAMES.EDIT_CODE_BLOCK,
        async (data: { msgBlockId: string; codeBlockId: string; newContent: string }) => {
          const { msgBlockId, codeBlockId, newContent } = data

          try {
            const resolved = partsMapRef.current && resolvePartFromParts(partsMapRef.current, msgBlockId)
            if (resolved && resolved.part.type === 'text') {
              const textPart = resolved.part as { text?: string }
              const updatedText = updateCodeBlock(textPart.text || '', codeBlockId, newContent)
              const allParts = [...(partsMapRef.current![resolved.messageId] || [])]
              allParts[resolved.index] = { ...resolved.part, text: updatedText } as CherryMessagePart
              await dataApiService.patch(`/messages/${resolved.messageId}`, {
                body: { data: { parts: allParts } }
              })
              window.toast.success(t('code_block.edit.save.success'))
              return
            }

            logger.error(
              `Failed to save code block ${codeBlockId} content to message block ${msgBlockId}: unable to resolve part`
            )
            window.toast.error(t('code_block.edit.save.failed.label'))
          } catch (error) {
            logger.error(
              `Failed to save code block ${codeBlockId} content to message block ${msgBlockId}:`,
              error as Error
            )
            window.toast.error(t('code_block.edit.save.failed.label'))
          }
        }
      )
    ]

    return () => unsubscribes.forEach((unsub) => unsub())
  }, [clearTopic, t])

  useEffect(() => {
    if (!assistant) return
    onFirstUpdate?.()
  }, [assistant, messages, onFirstUpdate])

  useEffect(() => {
    requestAnimationFrame(() => onComponentUpdate?.())
  }, [onComponentUpdate])

  useShortcut('chat.copy_last_message', () => {
    const lastMessage = last(messages)
    if (lastMessage) {
      const parts = partsMap?.[lastMessage.id]
      const text = parts ? getTextFromParts(parts) : getMainTextContent(lastMessage)
      void navigator.clipboard.writeText(text)
      window.toast.success(t('message.copy.success'))
    }
  })

  useShortcut('chat.edit_last_user_message', () => {
    const lastUserMessage = messagesRef.current.findLast((m) => m.role === 'user' && m.type !== 'clear')
    if (lastUserMessage) {
      void EventEmitter.emit(EVENT_NAMES.EDIT_MESSAGE, lastUserMessage.id)
    }
  })

  return useMemo(
    () => ({
      state: {
        topic,
        messages,
        hasOlder,
        messageNavigation,
        estimateSize: 600,
        overscan: 8,
        loadOlderDelayMs: 300,
        loadingResetDelayMs: 300,
        listKey: assistant?.id ?? topic.assistantId
      },
      actions: {
        loadOlder,
        setActiveBranch: (messageId: string) => v2Chat?.setActiveBranch(messageId),
        deleteMessageGroup: (askId: string) => v2Chat?.deleteMessageGroup(askId),
        regenerateMessage: (messageId: string) => v2Chat?.regenerate(messageId)
      },
      meta: {
        selectionLayer: true,
        imageExportFileName: topic.name
      }
    }),
    [assistant?.id, hasOlder, loadOlder, messageNavigation, messages, topic, v2Chat]
  )
}
