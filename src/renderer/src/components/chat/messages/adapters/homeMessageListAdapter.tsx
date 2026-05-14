import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { SiblingsContext } from '@renderer/hooks/SiblingsContext'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useChatContext } from '@renderer/hooks/useChatContext'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useV2Chat } from '@renderer/hooks/V2ChatContext'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic, TranslateLangCode } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { filterSupportedFiles } from '@renderer/utils/file'
import { updateCodeBlock } from '@renderer/utils/markdown'
import { getMainTextContent } from '@renderer/utils/messageUtils/find'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { CherryMessagePart } from '@shared/data/types/message'
import { last } from 'lodash'
import { use, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { resolvePartFromParts, usePartsMap } from '../blocks'
import type {
  MessageGroupRuntime,
  MessageListProviderValue,
  MessageListRuntime,
  MessageRuntime,
  MessageUiState
} from '../types'
import { useMessageActivityState } from './useMessageActivityState'
import { useMessageListRenderConfig } from './useMessageListRenderConfig'

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
  const siblingsContext = use(SiblingsContext)
  const { isMultiSelectMode, selectedMessageIds, handleSelectMessage, toggleMultiSelectMode } = useChatContext(topic)
  const getMessageActivityState = useMessageActivityState(topic.id, partsMap)
  const { renderConfig, updateRenderConfig } = useMessageListRenderConfig()

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
      })
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

  const bindRuntime = useCallback((runtime: MessageListRuntime) => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.SEND_MESSAGE, runtime.scrollToBottom),
      EventEmitter.on(EVENT_NAMES.COPY_TOPIC_IMAGE, runtime.copyTopicImage),
      EventEmitter.on(EVENT_NAMES.EXPORT_TOPIC_IMAGE, runtime.exportTopicImage)
    ]

    return () => unsubscribes.forEach((unsub) => unsub())
  }, [])

  const bindMessageRuntime = useCallback((messageId: string, runtime: MessageRuntime) => {
    const unsubscribes = [
      EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, runtime.locateMessage),
      EventEmitter.on(EVENT_NAMES.EDIT_MESSAGE, (targetId: string) => {
        if (targetId === messageId) {
          runtime.startEditing()
        }
      })
    ]

    return () => unsubscribes.forEach((unsub) => unsub())
  }, [])

  const bindMessageGroupRuntime = useCallback((messageIds: string[], runtime: MessageGroupRuntime) => {
    const unsubscribes = messageIds.map((messageId) =>
      EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, () => runtime.locateMessage(messageId))
    )

    return () => unsubscribes.forEach((unsub) => unsub())
  }, [])

  const locateMessage = useCallback((messageId: string, highlight?: boolean) => {
    void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, highlight)
  }, [])

  const startNewContext = useCallback(() => {
    logger.info('[NEW_CONTEXT] Not yet implemented.')
  }, [])

  const saveCodeBlock = useCallback(
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
        logger.error(`Failed to save code block ${codeBlockId} content to message block ${msgBlockId}:`, error as Error)
        window.toast.error(t('code_block.edit.save.failed.label'))
      }
    },
    [t]
  )

  const selectFiles = useCallback(
    async ({ extensions }: { extensions: string[] }) => {
      const useAllFiles = extensions.length > 20
      const selectedFiles = await window.api.file.select({
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Files',
            extensions: useAllFiles ? ['*'] : extensions.map((extension) => extension.replace('.', ''))
          }
        ]
      })

      if (!selectedFiles) return selectedFiles
      if (!useAllFiles) return selectedFiles

      const supportedFiles = await filterSupportedFiles(selectedFiles, extensions)
      if (supportedFiles.length !== selectedFiles.length) {
        window.toast.info(
          t('chat.input.file_not_supported_count', {
            count: selectedFiles.length - supportedFiles.length
          })
        )
      }

      return supportedFiles
    },
    [t]
  )

  const getMessageUiState = useCallback(
    (messageId: string) => (cacheService.get(`message.ui.${messageId}` as const) || {}) as MessageUiState,
    []
  )

  const updateMessageUiState = useCallback((messageId: string, updates: MessageUiState) => {
    const cacheKey = `message.ui.${messageId}` as const
    const current = cacheService.get(cacheKey) || {}
    cacheService.set(cacheKey, { ...current, ...updates })
  }, [])

  const getTranslationUpdater = useCallback(
    async (
      messageId: string,
      targetLanguage: TranslateLangCode,
      sourceLanguage?: TranslateLangCode
    ): Promise<((accumulatedText: string, isComplete?: boolean) => void) | null> => {
      if (!topic.id || !v2Chat) return null

      const currentParts = partsMapRef.current?.[messageId]
      if (!currentParts) {
        logger.error(`[getTranslationUpdater] cannot find parts for message: ${messageId}`)
        return null
      }

      const baseParts = currentParts.filter((part) => part.type !== 'data-translation')
      const loadingPart = {
        type: 'data-translation' as const,
        data: { content: '', targetLanguage, ...(sourceLanguage && { sourceLanguage }) }
      }
      await v2Chat.editMessage(messageId, [...baseParts, loadingPart as CherryMessagePart])

      return (accumulatedText: string) => {
        const translationPart = {
          type: 'data-translation' as const,
          data: {
            content: accumulatedText,
            targetLanguage,
            ...(sourceLanguage && { sourceLanguage })
          }
        }

        void v2Chat.editMessage(messageId, [...baseParts, translationPart as CherryMessagePart])
      }
    },
    [topic.id, v2Chat]
  )

  const getMessageSiblings = useCallback(
    (messageId: string) => {
      const group = siblingsContext?.siblingsMap[messageId]
      if (!group || group.length < 2) return null

      const activeIndex = group.findIndex((message) => message.id === messageId)
      return { group, activeIndex: activeIndex >= 0 ? activeIndex : 0 }
    },
    [siblingsContext]
  )

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
        listKey: assistant?.id ?? topic.assistantId,
        readonly: false,
        renderConfig,
        selection: {
          enabled: true,
          isMultiSelectMode,
          selectedMessageIds
        },
        getMessageUiState,
        getMessageSiblings,
        getMessageActivityState
      },
      actions: {
        loadOlder,
        bindRuntime,
        bindMessageRuntime,
        bindMessageGroupRuntime,
        locateMessage,
        startNewContext,
        saveCodeBlock,
        selectFiles,
        selectMessage: handleSelectMessage,
        toggleMultiSelectMode,
        updateMessageUiState,
        updateRenderConfig,
        editMessage: (messageId, parts) => v2Chat?.editMessage(messageId, parts),
        forkAndResendMessage: (messageId, parts) => v2Chat?.forkAndResend(messageId, parts),
        deleteMessage: (messageId, traceOptions) => v2Chat?.deleteMessage(messageId, traceOptions),
        startMessageBranch: (messageId) => v2Chat?.setActiveNode(messageId),
        setActiveBranch: (messageId: string) => v2Chat?.setActiveBranch(messageId),
        deleteMessageGroup: (askId: string) => v2Chat?.deleteMessageGroup(askId),
        regenerateMessage: (messageId: string) => v2Chat?.regenerate(messageId),
        regenerateMessageWithModel: (messageId, modelId, modelSnapshot) =>
          v2Chat?.regenerate(messageId, { modelId, modelSnapshot }),
        getTranslationUpdater
      },
      meta: {
        selectionLayer: true,
        imageExportFileName: topic.name
      }
    }),
    [
      assistant?.id,
      bindMessageGroupRuntime,
      bindMessageRuntime,
      bindRuntime,
      getMessageActivityState,
      getMessageSiblings,
      getMessageUiState,
      getTranslationUpdater,
      handleSelectMessage,
      hasOlder,
      isMultiSelectMode,
      loadOlder,
      locateMessage,
      messageNavigation,
      messages,
      saveCodeBlock,
      selectedMessageIds,
      selectFiles,
      startNewContext,
      toggleMultiSelectMode,
      topic,
      updateMessageUiState,
      updateRenderConfig,
      renderConfig,
      v2Chat
    ]
  )
}
