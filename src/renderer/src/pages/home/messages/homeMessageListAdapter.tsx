import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { resolvePartFromParts } from '@renderer/components/chat/messages/blocks'
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
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useChatWrite } from '@renderer/hooks/ChatWriteContext'
import { SiblingsContext } from '@renderer/hooks/SiblingsContext'
import { useLanguages } from '@renderer/hooks/translate'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useShortcut } from '@renderer/hooks/useShortcuts'
import { useMessageActivityState } from '@renderer/pages/shared/messages/hooks/useMessageActivityState'
import { useMessageEditorCapabilities } from '@renderer/pages/shared/messages/hooks/useMessageEditorCapabilities'
import { useMessageEditorConfig } from '@renderer/pages/shared/messages/hooks/useMessageEditorConfig'
import { useMessageErrorActions } from '@renderer/pages/shared/messages/hooks/useMessageErrorActions'
import { useMessageExportActions } from '@renderer/pages/shared/messages/hooks/useMessageExportActions'
import { useMessageHeaderCapabilities } from '@renderer/pages/shared/messages/hooks/useMessageHeaderCapabilities'
import { useMessageLeafCapabilities } from '@renderer/pages/shared/messages/hooks/useMessageLeafCapabilities'
import { useMessageListRenderConfig } from '@renderer/pages/shared/messages/hooks/useMessageListRenderConfig'
import { useMessageMenuConfig } from '@renderer/pages/shared/messages/hooks/useMessageMenuConfig'
import { useMessageSelectionController } from '@renderer/pages/shared/messages/hooks/useMessageSelectionController'
import { useMessageUiStateCache } from '@renderer/pages/shared/messages/hooks/useMessageUiStateCache'
import {
  pickMessageHeaderActions,
  pickMessageLeafActions,
  pickMessageLeafState
} from '@renderer/pages/shared/messages/messageListProviderBuilder'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { translateInputText } from '@renderer/services/TranslateCommandService'
import { translateText } from '@renderer/services/TranslateService'
import type { Topic, TranslateLangCode } from '@renderer/types'
import { abortCompletion } from '@renderer/utils/abortController'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import { filterSupportedFiles } from '@renderer/utils/file'
import { updateCodeBlock } from '@renderer/utils/markdown'
import { getTextFromParts } from '@renderer/utils/messageUtils/partsHelpers'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import {
  createUniqueModelId,
  type Model as SharedModel,
  parseUniqueModelId,
  type UniqueModelId
} from '@shared/data/types/model'
import { isNonChatModel, isVisionModel as isSharedVisionModel } from '@shared/utils/model'
import { useNavigate } from '@tanstack/react-router'
import { last } from 'lodash'
import { use, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('HomeMessageListAdapter')

const createTranslationAbortKey = (messageId: string) => `translation-abort-key:${messageId}`

interface HomeMessageListParams {
  topic: Topic
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  loadOlder?: () => void
  hasOlder?: boolean
  openCitationsPanel?: MessageListActions['openCitationsPanel']
  respondToolApproval: NonNullable<MessageListActions['respondToolApproval']>
  onComponentUpdate?(): void
  onFirstUpdate?(): void
}

export function useHomeMessageListProviderValue({
  topic,
  messages,
  partsByMessageId,
  loadOlder,
  hasOlder = false,
  openCitationsPanel,
  respondToolApproval,
  onComponentUpdate,
  onFirstUpdate
}: HomeMessageListParams): MessageListProviderValue {
  const navigate = useNavigate()
  const { assistant, model } = useAssistant(topic.assistantId)
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  const [editorTranslationTargetLanguage] = usePreference('chat.input.translate.target_language')
  const [showEditorTranslationConfirm] = usePreference('chat.input.translate.show_confirm')
  const { t } = useTranslation()
  const { languages: translationLanguages, getLabel: getTranslationLanguageLabel } = useLanguages()
  const chatWrite = useChatWrite()
  const siblingsContext = use(SiblingsContext)
  const getMessageActivityState = useMessageActivityState(topic.id, partsByMessageId)
  const { renderConfig, updateRenderConfig } = useMessageListRenderConfig()
  const editorConfig = useMessageEditorConfig(renderConfig.fontSize)
  const menuConfig = useMessageMenuConfig()
  const exportActions = useMessageExportActions({ topicName: topic.name })
  const errorActions = useMessageErrorActions()
  const leafCapabilities = useMessageLeafCapabilities({ partsByMessageId })
  const editorCapabilities = useMessageEditorCapabilities()
  const headerCapabilities = useMessageHeaderCapabilities()
  const messageUiStateCache = useMessageUiStateCache()

  const messageItems = useMemo(
    () =>
      messages.map((message) =>
        toMessageListItem(message, {
          assistantId: assistant?.id ?? topic.assistantId,
          topicId: topic.id,
          modelFallback: modelToSnapshot(model)
        })
      ),
    [assistant?.id, messages, model, topic.assistantId, topic.id]
  )

  const messagesRef = useRef<MessageListItem[]>(messageItems)
  const partsByMessageIdRef = useRef(partsByMessageId)

  useEffect(() => {
    messagesRef.current = messageItems
  }, [messageItems])

  useEffect(() => {
    partsByMessageIdRef.current = partsByMessageId
  }, [partsByMessageId])

  const clearTopic = useCallback(
    async (data: Topic) => {
      if (data && data.id !== topic.id) return
      await chatWrite?.clearTopicMessages()
    },
    [chatWrite, topic.id]
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
    requestAnimationFrame(() => onComponentUpdate?.())
  }, [onComponentUpdate])

  useShortcut('chat.copy_last_message', () => {
    const lastMessage = last(messageItems)
    if (lastMessage) {
      const parts = partsByMessageIdRef.current[lastMessage.id] ?? []
      const text = getTextFromParts(parts)
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

  const getMessageEditorCapabilities = useCallback(
    (message: MessageListItem) => {
      const messageModel = getMessageListItemModel(message)
      const fallbackModel = model ? fromSharedModel(model) : undefined
      const editorModel = messageModel ?? fallbackModel

      return {
        canAddImageFile: editorModel ? isVisionModel(editorModel) : false,
        canAddTextFile: true
      }
    },
    [model]
  )

  const translateEditorText = useCallback(
    async (text: string) => {
      return translateInputText({
        text,
        targetLanguage: editorTranslationTargetLanguage,
        languages: translationLanguages,
        showConfirm: showEditorTranslationConfirm,
        t
      })
    },
    [editorTranslationTargetLanguage, showEditorTranslationConfirm, t, translationLanguages]
  )

  const openTrace = useCallback((message: MessageListItem, options?: { modelName?: string }) => {
    if (!message.traceId) return
    return window.api.trace.openWindow(message.topicId, message.traceId, true, options?.modelName)
  }, [])

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

        await chatWrite?.editMessage(
          messageId,
          persistedParts.filter((_, index) => index !== resolved.index)
        )
      } catch (error) {
        logger.error('Failed to remove error part:', error as Error)
        throw error
      }
    },
    [chatWrite]
  )

  const createTranslationUpdater = useCallback(
    async (
      messageId: string,
      targetLanguage: TranslateLangCode,
      sourceLanguage?: TranslateLangCode
    ): Promise<((accumulatedText: string, isComplete?: boolean) => void) | null> => {
      if (!topic.id || !chatWrite) return null

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
      await chatWrite.editMessage(messageId, [...baseParts, loadingPart as CherryMessagePart])

      return (accumulatedText: string) => {
        const translationPart = {
          type: 'data-translation' as const,
          data: {
            content: accumulatedText,
            targetLanguage,
            ...(sourceLanguage && { sourceLanguage })
          }
        }

        void chatWrite.editMessage(messageId, [...baseParts, translationPart as CherryMessagePart])
      }
    },
    [topic.id, chatWrite]
  )

  const translateMessage = useCallback<NonNullable<MessageListActions['translateMessage']>>(
    async (messageId, language, sourceText) => {
      if (!sourceText.trim()) return

      const translationUpdater = await createTranslationUpdater(messageId, language.langCode)
      if (!translationUpdater) return

      try {
        await translateText(sourceText, language, translationUpdater, createTranslationAbortKey(messageId))
      } catch (error) {
        if (!isAbortError(error)) {
          logger.error('Message translation failed', error as Error)
          window.toast.error(formatErrorMessageWithPrefix(error, t('translate.error.failed')))
        }
      }
    },
    [createTranslationUpdater, t]
  )

  const abortMessageTranslation = useCallback<NonNullable<MessageListActions['abortMessageTranslation']>>(
    (messageId) => {
      abortCompletion(createTranslationAbortKey(messageId))
    },
    []
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
    (messageId, parts) => chatWrite?.editMessage(messageId, parts),
    [chatWrite]
  )

  const forkAndResendMessage = useCallback<NonNullable<MessageListActions['forkAndResendMessage']>>(
    (messageId, parts) => chatWrite?.forkAndResend(messageId, parts),
    [chatWrite]
  )

  const deleteMessage = useCallback<NonNullable<MessageListActions['deleteMessage']>>(
    (messageId, traceOptions) => chatWrite?.deleteMessage(messageId, traceOptions),
    [chatWrite]
  )

  const startMessageBranch = useCallback<NonNullable<MessageListActions['startMessageBranch']>>(
    (messageId) => chatWrite?.setActiveNode(messageId),
    [chatWrite]
  )

  const setActiveBranch = useCallback<NonNullable<MessageListActions['setActiveBranch']>>(
    (messageId) => chatWrite?.setActiveBranch(messageId),
    [chatWrite]
  )

  const deleteMessageGroup = useCallback<NonNullable<MessageListActions['deleteMessageGroup']>>(
    (parentId) => chatWrite?.deleteMessageGroup(parentId),
    [chatWrite]
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
        onOk: () => deleteMessageGroup(parentId)
      })
    },
    [deleteMessageGroup, t]
  )

  const regenerateMessage = useCallback<NonNullable<MessageListActions['regenerateMessage']>>(
    (messageId) => chatWrite?.regenerate(messageId),
    [chatWrite]
  )

  const regenerateMessageUsingModel = useCallback(
    (messageId: string, modelId: UniqueModelId, modelSnapshot?: ModelSnapshot) =>
      chatWrite?.regenerate(messageId, { modelId, modelSnapshot }),
    [chatWrite]
  )

  const renderRegenerateModelPicker = useCallback<NonNullable<MessageListActions['renderRegenerateModelPicker']>>(
    ({ message, messageParts, trigger }) => {
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
        if (needsVision && !isSharedVisionModel(model)) return false
        return true
      }

      const onSelectMentionModel = async (selected: SharedModel | undefined) => {
        if (!selected) return
        const { providerId, modelId } = parseUniqueModelId(selected.id)
        await regenerateMessageUsingModel?.(message.id, selected.id, {
          id: modelId,
          name: selected.name,
          provider: providerId,
          ...(selected.group && { group: selected.group })
        })
      }

      return (
        <ModelSelector
          multiple={false}
          value={currentMentionModel}
          filter={mentionModelFilter}
          onSelect={onSelectMentionModel}
          trigger={trigger}
        />
      )
    },
    [regenerateMessageUsingModel]
  )

  const selectionController = useMessageSelectionController({
    topicId: topic.id,
    messages: messageItems,
    partsByMessageId,
    deleteMessage,
    saveTextFile: exportActions.saveTextFile
  })

  const state = useMemo<MessageListState>(
    () => ({
      topic,
      messages: messageItems,
      partsByMessageId,
      hasOlder,
      messageNavigation,
      estimateSize: 600,
      overscan: 8,
      loadOlderDelayMs: 300,
      loadingResetDelayMs: 300,
      listKey: assistant?.id ?? topic.assistantId,
      readonly: false,
      renderConfig,
      editorConfig,
      menuConfig,
      selection: selectionController.selection,
      translationLanguages: translationLanguages ?? [],
      editorTranslationTargetLabel: getTranslationLanguageLabel(editorTranslationTargetLanguage, false),
      getMessageUiState: messageUiStateCache.getMessageUiState,
      getMessageSiblings,
      getMessageActivityState,
      getMessageEditorCapabilities,
      ...pickMessageLeafState(leafCapabilities),
      getTranslationLanguageLabel
    }),
    [
      assistant?.id,
      editorTranslationTargetLanguage,
      editorConfig,
      getMessageActivityState,
      getMessageEditorCapabilities,
      getMessageSiblings,
      getTranslationLanguageLabel,
      hasOlder,
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
      ...editorCapabilities,
      navigateToRoute,
      ...pickMessageHeaderActions(headerCapabilities),
      respondToolApproval,
      removeMessageErrorPart,
      openTrace,
      openPath,
      openCitationsPanel,
      showInFolder,
      abortTool,
      selectFiles,
      translateEditorText,
      ...selectionController.actions,
      updateMessageUiState: messageUiStateCache.updateMessageUiState,
      updateRenderConfig,
      editMessage,
      forkAndResendMessage,
      deleteMessage,
      startMessageBranch,
      setActiveBranch,
      deleteMessageGroup,
      deleteMessageGroupWithConfirm,
      regenerateMessage,
      translateMessage,
      abortMessageTranslation,
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
      editorCapabilities,
      forkAndResendMessage,
      headerCapabilities,
      leafCapabilities,
      navigateToRoute,
      loadOlder,
      locateMessage,
      messageUiStateCache.updateMessageUiState,
      openCitationsPanel,
      openPath,
      openTrace,
      regenerateMessage,
      renderRegenerateModelPicker,
      respondToolApproval,
      removeMessageErrorPart,
      saveCodeBlock,
      selectFiles,
      setActiveBranch,
      showInFolder,
      startMessageBranch,
      startNewContext,
      selectionController.actions,
      translateEditorText,
      translateMessage,
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
