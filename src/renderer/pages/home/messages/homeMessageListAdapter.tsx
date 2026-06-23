import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { resolvePartFromParts } from '@renderer/components/chat/messages/blocks'
import { useMessageEditing } from '@renderer/components/chat/messages/editing/MessageEditingContext'
import { useMessageActivityState } from '@renderer/components/chat/messages/hooks/useMessageActivityState'
import { useMessageErrorActions } from '@renderer/components/chat/messages/hooks/useMessageErrorActions'
import { useMessageExportActions } from '@renderer/components/chat/messages/hooks/useMessageExportActions'
import { useMessageHeaderCapabilities } from '@renderer/components/chat/messages/hooks/useMessageHeaderCapabilities'
import { useMessageLeafCapabilities } from '@renderer/components/chat/messages/hooks/useMessageLeafCapabilities'
import { useMessageListRenderConfig } from '@renderer/components/chat/messages/hooks/useMessageListRenderConfig'
import { useMessageMenuConfig } from '@renderer/components/chat/messages/hooks/useMessageMenuConfig'
import { useMessageSelectionController } from '@renderer/components/chat/messages/hooks/useMessageSelectionController'
import { useMessageUiStateCache } from '@renderer/components/chat/messages/hooks/useMessageUiStateCache'
import {
  pickMessageHeaderActions,
  pickMessageLeafActions,
  pickMessageLeafState
} from '@renderer/components/chat/messages/messageListProviderBuilder'
import type {
  MessageGroupRuntime,
  MessageListActions,
  MessageListItem,
  MessageListMeta,
  MessageListProviderValue,
  MessageListRuntime,
  MessageListState,
  MessageRuntime
} from '@renderer/components/chat/messages/types'
import {
  getMessageListItemModel,
  modelToSnapshot,
  toMessageListItem
} from '@renderer/components/chat/messages/utils/messageListItem'
import { ModelSelector } from '@renderer/components/Selector'
import { isVisionModel } from '@renderer/config/models'
import { useChatWrite } from '@renderer/hooks/chat/ChatWriteContext'
import { useCommandHandler } from '@renderer/hooks/command'
import { SiblingsContext } from '@renderer/hooks/SiblingsContext'
import { useLanguages } from '@renderer/hooks/translate'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic, TranslateLangCode } from '@renderer/types'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import { updateCodeBlock } from '@renderer/utils/markdown'
import { createComposerRichClipboardContentFromParts } from '@renderer/utils/message/composerClipboard'
import { getComposerTextFromParts } from '@renderer/utils/message/composerTokens'
import { translateText } from '@renderer/utils/translate'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import {
  createUniqueModelId,
  type Model as SharedModel,
  parseUniqueModelId,
  type UniqueModelId
} from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'
import { useNavigate } from '@tanstack/react-router'
import { last } from 'lodash'
import { use, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  consumePendingTopicImageActions,
  rejectPendingTopicImageActions,
  settleTopicImageActionRequest,
  type TopicImageActionRequest,
  type TopicImageActionType
} from './topicImageActionBus'

const logger = loggerService.withContext('HomeMessageListAdapter')

interface HomeMessageListParams {
  topic: Topic
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  isInitialLoading?: boolean
  loadOlder?: () => void
  hasOlder?: boolean
  openCitationsPanel?: MessageListActions['openCitationsPanel']
  onComponentUpdate?(): void
  onFirstUpdate?(): void
}

export function useHomeMessageListProviderValue({
  topic,
  messages,
  partsByMessageId,
  isInitialLoading = false,
  loadOlder,
  hasOlder = false,
  openCitationsPanel,
  onComponentUpdate,
  onFirstUpdate
}: HomeMessageListParams): MessageListProviderValue {
  const topicId = topic.id
  const assistantId = topic.assistantId
  const navigate = useNavigate()
  const { assistant, model } = useAssistant(assistantId)
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  const { t } = useTranslation()
  const { languages: translationLanguages, getLabel: getTranslationLanguageLabel } = useLanguages()
  const chatWrite = useChatWrite()
  const siblingsContext = use(SiblingsContext)
  const getMessageActivityState = useMessageActivityState(topicId, partsByMessageId)
  const { renderConfig, updateRenderConfig } = useMessageListRenderConfig()
  const menuConfig = useMessageMenuConfig()
  const exportActions = useMessageExportActions({ topicName: topic.name })
  const errorActions = useMessageErrorActions()
  const leafCapabilities = useMessageLeafCapabilities({ partsByMessageId })
  const headerCapabilities = useMessageHeaderCapabilities()
  const messageUiStateCache = useMessageUiStateCache()
  const { editingMessageId, startEditing } = useMessageEditing()

  const messageItems = useMemo(
    () =>
      messages.map((message) =>
        toMessageListItem(message, {
          assistantId: assistant?.id ?? assistantId,
          topicId,
          modelFallback: modelToSnapshot(model)
        })
      ),
    [assistant?.id, assistantId, messages, model, topicId]
  )

  const messagesRef = useRef<MessageListItem[]>(messageItems)
  const partsByMessageIdRef = useRef(partsByMessageId)
  const translationAbortControllersRef = useRef(new Map<string, AbortController>())

  useEffect(() => {
    messagesRef.current = messageItems
  }, [messageItems])

  useEffect(() => {
    partsByMessageIdRef.current = partsByMessageId
  }, [partsByMessageId])

  const requireChatWrite = useCallback(
    (actionName: string) => {
      if (chatWrite) return chatWrite

      logger.warn('Chat write action unavailable', {
        actionName,
        topicId: topic.id
      })
      throw new Error(t('message.error.operation_unavailable'))
    },
    [chatWrite, t, topic.id]
  )

  const clearTopic = useCallback(
    async (data: Topic) => {
      if (data && data.id !== topic.id) return
      try {
        await requireChatWrite('clearTopicMessages').clearTopicMessages()
      } catch (error) {
        logger.error('Failed to clear topic messages:', error as Error)
        window.toast.error(formatErrorMessageWithPrefix(error, t('message.error.unknown')))
      }
    },
    [requireChatWrite, t, topic.id]
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
  }, [assistant, messageItems, onFirstUpdate])

  useEffect(() => {
    const handle = requestAnimationFrame(() => onComponentUpdate?.())
    return () => cancelAnimationFrame(handle)
  }, [onComponentUpdate])

  useCommandHandler('chat.message.copy_last', () => {
    const lastMessage = last(messageItems)
    if (lastMessage) {
      const parts = partsByMessageIdRef.current[lastMessage.id] ?? []
      const richContent = leafCapabilities.copyRichContent ? createComposerRichClipboardContentFromParts(parts) : null
      const text = getComposerTextFromParts(parts)
      const copyTask = richContent
        ? leafCapabilities.copyRichContent?.(richContent, { successMessage: t('message.copy.success') })
        : navigator.clipboard.writeText(text)
      void Promise.resolve(copyTask)
        .then(() => {
          if (!richContent) window.toast.success(t('message.copy.success'))
        })
        .catch((error) => {
          logger.error('Failed to copy last message:', error as Error)
          window.toast.error(formatErrorMessageWithPrefix(error, t('common.copy_failed')))
        })
    }
  })

  useCommandHandler('chat.message.edit_last_user', () => {
    const lastUserMessage = messagesRef.current.findLast((m) => m.role === 'user' && m.type !== 'clear')
    if (lastUserMessage) {
      void EventEmitter.emit(EVENT_NAMES.EDIT_MESSAGE, lastUserMessage.id)
    }
  })

  const runTopicImageAction = useCallback((runtime: MessageListRuntime, type: TopicImageActionType) => {
    if (type === 'copy') {
      return runtime.copyTopicImage()
    }

    return runtime.exportTopicImage()
  }, [])

  const consumeTopicImageAction = useCallback(
    (runtime: MessageListRuntime, type: TopicImageActionType, data?: Topic) => {
      if (data && data.id !== topic.id) return

      const requests = consumePendingTopicImageActions(topic.id, type)
      if (requests.length === 0) {
        void runTopicImageAction(runtime, type)
        return
      }

      for (const request of requests) {
        settleTopicImageActionRequest(request, runTopicImageAction(runtime, type))
      }
    },
    [runTopicImageAction, topic.id]
  )

  const flushPendingTopicImageActions = useCallback(
    (runtime: MessageListRuntime) => {
      const requests = consumePendingTopicImageActions(topic.id)
      for (const request of requests) {
        settleTopicImageActionRequest(request, runTopicImageAction(runtime, request.type))
      }
    },
    [runTopicImageAction, topic.id]
  )

  useEffect(() => {
    const topicId = topic.id
    return () => rejectPendingTopicImageActions(topicId, new Error('Topic image export was cancelled'))
  }, [topic.id])

  const bindRuntime = useCallback(
    (runtime: MessageListRuntime) => {
      flushPendingTopicImageActions(runtime)

      const unsubscribes = [
        EventEmitter.on(EVENT_NAMES.COPY_TOPIC_IMAGE, (data?: TopicImageActionRequest['topic']) =>
          consumeTopicImageAction(runtime, 'copy', data)
        ),
        EventEmitter.on(EVENT_NAMES.EXPORT_TOPIC_IMAGE, (data?: TopicImageActionRequest['topic']) =>
          consumeTopicImageAction(runtime, 'export', data)
        )
      ]

      return () => unsubscribes.forEach((unsub) => unsub())
    },
    [consumeTopicImageAction, flushPendingTopicImageActions]
  )

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
        const resolved = resolvePartFromParts(partsByMessageIdRef.current, msgBlockId)
        if (resolved && resolved.part.type === 'text') {
          const textPart = resolved.part as { text?: string }
          const updatedText = updateCodeBlock(textPart.text || '', codeBlockId, newContent)
          const allParts = [...(partsByMessageIdRef.current[resolved.messageId] || [])]
          allParts[resolved.index] = {
            ...resolved.part,
            text: updatedText
          } as CherryMessagePart
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
        window.toast.error(formatErrorMessageWithPrefix(error, t('code_block.edit.save.failed.label')))
      }
    },
    [t]
  )

  const openPath = useCallback((path: string) => {
    return window.api.file.openPath(path)
  }, [])

  const showInFolder = useCallback((path: string) => {
    return window.api.file.showInFolder(path)
  }, [])

  const abortTool = useCallback((toolId: string) => {
    return window.api.mcp.abortTool(toolId)
  }, [])

  const navigateToRoute = useCallback<NonNullable<MessageListActions['navigateToRoute']>>(
    ({ path, query }) => navigate({ to: path, search: query }),
    [navigate]
  )

  const removeMessageErrorPart = useCallback<NonNullable<MessageListActions['removeMessageErrorPart']>>(
    async ({ messageId, partId }) => {
      try {
        const persistedMessage = await dataApiService.get(`/messages/${messageId}`)
        const persistedParts = persistedMessage.data.parts ?? []
        const resolved = resolvePartFromParts({ [messageId]: persistedParts }, partId)
        if (!resolved || resolved.messageId !== messageId || (resolved.part.type as string) !== 'data-error') return

        await requireChatWrite('removeMessageErrorPart').editMessage(
          messageId,
          persistedParts.filter((_, index) => index !== resolved.index)
        )
      } catch (error) {
        logger.error('Failed to remove error part:', error as Error)
        throw error
      }
    },
    [requireChatWrite]
  )

  const createTranslationUpdater = useCallback(
    async (
      messageId: string,
      targetLanguage: TranslateLangCode,
      sourceLanguage?: TranslateLangCode
    ): Promise<((accumulatedText: string, isComplete?: boolean) => void) | null> => {
      if (!topic.id) return null
      const write = requireChatWrite('translateMessage')

      const currentParts = partsByMessageIdRef.current[messageId]
      if (!currentParts) {
        logger.error(`[createTranslationUpdater] cannot find parts for message: ${messageId}`)
        return null
      }

      const baseParts = currentParts.filter((part) => part.type !== 'data-translation')
      const loadingPart = {
        type: 'data-translation' as const,
        data: {
          content: '',
          targetLanguage,
          ...(sourceLanguage && { sourceLanguage })
        }
      }
      await write.editMessage(messageId, [...baseParts, loadingPart as CherryMessagePart])

      return (accumulatedText: string) => {
        const translationPart = {
          type: 'data-translation' as const,
          data: {
            content: accumulatedText,
            targetLanguage,
            ...(sourceLanguage && { sourceLanguage })
          }
        }

        void write.editMessage(messageId, [...baseParts, translationPart as CherryMessagePart]).catch((error) => {
          logger.error('Failed to update message translation:', error as Error, { messageId })
        })
      }
    },
    [requireChatWrite, topic.id]
  )

  const translateMessage = useCallback<NonNullable<MessageListActions['translateMessage']>>(
    async (messageId, language, sourceText) => {
      if (!sourceText.trim()) return

      const controller = new AbortController()
      try {
        translationAbortControllersRef.current.get(messageId)?.abort()
        translationAbortControllersRef.current.set(messageId, controller)

        const translationUpdater = await createTranslationUpdater(messageId, language.langCode)
        if (!translationUpdater) {
          window.toast.error(t('message.error.unknown'))
          return
        }

        await translateText(sourceText, language, translationUpdater, controller.signal)
      } catch (error) {
        if (!isAbortError(error)) {
          logger.error('Message translation failed', error as Error)
          window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.failed')))
        }
        // Clean up the empty data-translation part inserted by
        // createTranslationUpdater so BeatLoader doesn't spin forever.
        // Only clean up when this translation is still the current one —
        // a superseding call will have set a new controller by now and
        // owns the current data-translation part.
        if (translationAbortControllersRef.current.get(messageId) === controller) {
          const currentParts = partsByMessageIdRef.current[messageId]
          if (currentParts) {
            const baseParts = currentParts.filter((part) => part.type !== 'data-translation')
            if (baseParts.length !== currentParts.length) {
              void requireChatWrite('removeMessageTranslation')
                .editMessage(messageId, baseParts)
                .catch((cleanupError) => {
                  logger.error('Failed to clean up translation loading part:', cleanupError as Error, { messageId })
                })
            }
          }
        }
      } finally {
        if (translationAbortControllersRef.current.get(messageId) === controller) {
          translationAbortControllersRef.current.delete(messageId)
        }
      }
    },
    [createTranslationUpdater, requireChatWrite, t]
  )

  const abortMessageTranslation = useCallback<NonNullable<MessageListActions['abortMessageTranslation']>>(
    (messageId) => {
      translationAbortControllersRef.current.get(messageId)?.abort()
    },
    []
  )

  const removeMessageTranslation = useCallback<NonNullable<MessageListActions['removeMessageTranslation']>>(
    async (messageId) => {
      const currentParts = partsByMessageIdRef.current[messageId]
      if (!currentParts) return
      const baseParts = currentParts.filter((part) => part.type !== 'data-translation')
      if (baseParts.length === currentParts.length) return
      await requireChatWrite('removeMessageTranslation').editMessage(messageId, baseParts)
    },
    [requireChatWrite]
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

  const editMessage = useCallback<NonNullable<MessageListActions['editMessage']>>(
    (messageId, parts) => requireChatWrite('editMessage').editMessage(messageId, parts),
    [requireChatWrite]
  )

  const deleteMessage = useCallback<NonNullable<MessageListActions['deleteMessage']>>(
    (messageId, traceOptions) => requireChatWrite('deleteMessage').deleteMessage(messageId, traceOptions),
    [requireChatWrite]
  )

  const startMessageBranch = useCallback<NonNullable<MessageListActions['startMessageBranch']>>(
    (messageId) => requireChatWrite('startMessageBranch').setActiveNode(messageId),
    [requireChatWrite]
  )

  const setActiveBranch = useCallback<NonNullable<MessageListActions['setActiveBranch']>>(
    (messageId) => requireChatWrite('setActiveBranch').setActiveBranch(messageId),
    [requireChatWrite]
  )

  const deleteMessageGroup = useCallback<NonNullable<MessageListActions['deleteMessageGroup']>>(
    (parentId) => requireChatWrite('deleteMessageGroup').deleteMessageGroup(parentId),
    [requireChatWrite]
  )

  const deleteMessageGroupWithConfirm = useCallback<NonNullable<MessageListActions['deleteMessageGroupWithConfirm']>>(
    (parentId) => {
      window.modal.confirm({
        title: t('message.group.delete.title'),
        content: t('message.group.delete.content'),
        centered: true,
        okButtonProps: {
          danger: true
        },
        okText: t('common.delete'),
        onOk: async () => {
          try {
            await deleteMessageGroup(parentId)
          } catch (error) {
            logger.error('Failed to delete message group:', error as Error)
            window.toast.error(formatErrorMessageWithPrefix(error, t('message.delete.failed')))
          }
        }
      })
    },
    [deleteMessageGroup, t]
  )

  const regenerateMessage = useCallback<NonNullable<MessageListActions['regenerateMessage']>>(
    (messageId) => requireChatWrite('regenerateMessage').regenerate(messageId),
    [requireChatWrite]
  )

  const regenerateMessageUsingModel = useCallback(
    (messageId: string, modelId: UniqueModelId, modelSnapshot?: ModelSnapshot) =>
      requireChatWrite('regenerateMessageUsingModel').regenerate(messageId, { modelId, modelSnapshot }),
    [requireChatWrite]
  )

  const renderRegenerateModelPicker = useCallback<NonNullable<MessageListActions['renderRegenerateModelPicker']>>(
    ({ message, messageParts, trigger, onOpenChange }) => {
      const messageModel = getMessageListItemModel(message)
      const currentMentionModel = messageModel
        ? ({
            id: createUniqueModelId(messageModel.provider, messageModel.id),
            providerId: messageModel.provider,
            name: messageModel.name,
            group: messageModel.group
          } as SharedModel)
        : undefined

      const mentionModelFilter = (model: SharedModel) => {
        if (isNonChatModel(model)) return false
        const needsVision = messageParts.some((part) => part.type === 'file' && part.mediaType?.startsWith('image/'))
        if (needsVision && !isVisionModel(model)) return false
        return true
      }

      const onSelectMentionModel = async (selected: SharedModel | undefined) => {
        if (!selected) return
        const { providerId, modelId } = parseUniqueModelId(selected.id)
        try {
          await regenerateMessageUsingModel(message.id, selected.id, {
            id: modelId,
            name: selected.name,
            provider: providerId,
            ...(selected.group && { group: selected.group })
          })
        } catch (error) {
          logger.error('Failed to regenerate message using selected model:', error as Error)
          window.toast.error(formatErrorMessageWithPrefix(error, t('message.error.unknown')))
        }
      }

      return (
        <ModelSelector
          multiple={false}
          value={currentMentionModel}
          filter={mentionModelFilter}
          onSelect={onSelectMentionModel}
          trigger={trigger}
          onOpenChange={onOpenChange}
        />
      )
    },
    [regenerateMessageUsingModel, t]
  )

  const selectionController = useMessageSelectionController({
    topicId: topic.id,
    messages: messageItems,
    partsByMessageId,
    deleteMessage,
    saveTextFile: exportActions.saveTextFile,
    copyRichContent: leafCapabilities.copyRichContent
  })

  const state = useMemo<MessageListState>(
    () => ({
      topic,
      messages: messageItems,
      partsByMessageId,
      isInitialLoading,
      hasOlder,
      messageNavigation,
      estimateSize: 600,
      overscan: 8,
      loadOlderDelayMs: 300,
      loadingResetDelayMs: 300,
      listKey: assistant?.id ?? topic.assistantId,
      readonly: false,
      renderConfig,
      menuConfig,
      selection: selectionController.selection,
      editingMessageId,
      translationLanguages: translationLanguages ?? [],
      getMessageUiState: messageUiStateCache.getMessageUiState,
      getMessageSiblings,
      getMessageActivityState,
      ...pickMessageLeafState(leafCapabilities),
      getTranslationLanguageLabel
    }),
    [
      assistant?.id,
      editingMessageId,
      getMessageActivityState,
      getMessageSiblings,
      getTranslationLanguageLabel,
      hasOlder,
      isInitialLoading,
      leafCapabilities,
      menuConfig,
      messageUiStateCache.getMessageUiState,
      messageItems,
      messageNavigation,
      partsByMessageId,
      renderConfig,
      selectionController.selection,
      topic,
      translationLanguages
    ]
  )

  const actions = useMemo<MessageListActions>(
    () => ({
      loadOlder,
      bindRuntime,
      bindMessageRuntime,
      bindMessageGroupRuntime,
      locateMessage,
      startNewContext,
      saveCodeBlock,
      ...exportActions,
      ...errorActions,
      ...pickMessageLeafActions(leafCapabilities),
      navigateToRoute,
      ...pickMessageHeaderActions(headerCapabilities),
      removeMessageErrorPart,
      openPath,
      openCitationsPanel,
      showInFolder,
      abortTool,
      ...selectionController.actions,
      updateMessageUiState: messageUiStateCache.updateMessageUiState,
      updateRenderConfig,
      editMessage,
      startEditing,
      deleteMessage,
      startMessageBranch,
      setActiveBranch,
      deleteMessageGroup,
      deleteMessageGroupWithConfirm,
      regenerateMessage,
      translateMessage,
      abortMessageTranslation,
      removeMessageTranslation,
      renderRegenerateModelPicker
    }),
    [
      abortTool,
      abortMessageTranslation,
      bindMessageGroupRuntime,
      bindMessageRuntime,
      bindRuntime,
      deleteMessage,
      deleteMessageGroup,
      deleteMessageGroupWithConfirm,
      editMessage,
      exportActions,
      errorActions,
      headerCapabilities,
      leafCapabilities,
      navigateToRoute,
      loadOlder,
      locateMessage,
      messageUiStateCache.updateMessageUiState,
      openCitationsPanel,
      openPath,
      regenerateMessage,
      renderRegenerateModelPicker,
      removeMessageErrorPart,
      saveCodeBlock,
      setActiveBranch,
      showInFolder,
      startEditing,
      startMessageBranch,
      startNewContext,
      selectionController.actions,
      translateMessage,
      removeMessageTranslation,
      updateRenderConfig
    ]
  )

  const meta = useMemo<MessageListMeta>(
    () => ({
      selectionLayer: true,
      userProfile: headerCapabilities.userProfile,
      imageExportFileName: topic.name
    }),
    [headerCapabilities.userProfile, topic.name]
  )

  return useMemo(() => ({ state, actions, meta }), [actions, meta, state])
}
