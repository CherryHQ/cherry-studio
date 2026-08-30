import { dataApiService } from '@data/DataApiService'
import { useMutation } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { useMessageEditing } from '@renderer/components/chat/editing/MessageEditingContext'
import { resolvePartFromParts } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import { useMessageListAdapterCapabilities } from '@renderer/components/chat/messages/hooks/useMessageListAdapterCapabilities'
import {
  pickMessageHeaderActions,
  pickMessageLeafActions,
  pickMessageLeafState
} from '@renderer/components/chat/messages/messageListProviderBuilder'
import {
  DEFAULT_MESSAGE_LIST_CONFIG,
  type MessageGroupRuntime,
  type MessageListActions,
  type MessageListItem,
  type MessageListMeta,
  type MessageListProviderValue,
  type MessageListRuntime,
  type MessageListState,
  type MessageRuntime,
  type MessageStreamingLayers
} from '@renderer/components/chat/messages/types'
import { parseMessagePartId, withMessagePartDiagnosis } from '@renderer/components/chat/messages/utils/messageDiagnosis'
import {
  bindCaptureMessageImageRuntime,
  flushPendingMessageImageActions,
  runMessageImageAction
} from '@renderer/components/chat/messages/utils/messageImageRuntimeActions'
import { getMessageListItemModel, toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { useChatWrite } from '@renderer/hooks/chat/ChatWriteContext'
import { useCommandHandler } from '@renderer/hooks/command'
import { SiblingsContext } from '@renderer/hooks/SiblingsContext'
import { useLanguages } from '@renderer/hooks/translate'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import type { Assistant } from '@renderer/types/assistant'
import type { Topic } from '@renderer/types/topic'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import type { DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import { createComposerRichClipboardContentFromParts } from '@renderer/utils/message/composerClipboard'
import { getComposerTextFromParts } from '@renderer/utils/message/composerTokens'
import { isVisionModel } from '@renderer/utils/model'
import { translateText } from '@renderer/utils/translate'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { createUniqueModelId, type Model as SharedModel, type UniqueModelId } from '@shared/data/types/model'
import { isNonChatModel } from '@shared/utils/model'
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  assistant?: Assistant
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers?: MessageStreamingLayers
  isInitialLoading?: boolean
  isMessagesStale?: boolean
  loadOlder?: () => void
  hasOlder?: boolean
  openCitationsPanel?: MessageListActions['openCitationsPanel']
  imageActionConsumer?: 'capture'
  onBindRuntime?: MessageListActions['bindRuntime']
  onStartBranchDraft?: MessageListActions['startMessageBranch']
  onComponentUpdate?(): void
  onFirstUpdate?(): void
}

export function useHomeMessageListProviderValue({
  topic,
  assistant,
  messages,
  partsByMessageId,
  streamingLayers,
  isInitialLoading = false,
  isMessagesStale = false,
  loadOlder,
  hasOlder = false,
  openCitationsPanel,
  imageActionConsumer,
  onBindRuntime,
  onStartBranchDraft,
  onComponentUpdate,
  onFirstUpdate
}: HomeMessageListParams): MessageListProviderValue {
  const topicId = topic.id
  const assistantId = topic.assistantId
  const { trigger: copyBranchToNewTopicTrigger } = useMutation('POST', '/topics/:id/duplicate', {
    refresh: ['/topics']
  })
  const [messageNavigation] = usePreference('chat.message.navigation_mode')
  const { t } = useTranslation()
  const normalInteractionsEnabled = imageActionConsumer !== 'capture'
  const [translationLanguagesRequested, setTranslationLanguagesRequested] = useState(false)
  const {
    languages: translationLanguages,
    getLabel: getTranslationLanguageLabel,
    status: translationLanguagesStatus,
    refetch: refetchTranslationLanguages
  } = useLanguages({
    enabled: normalInteractionsEnabled && translationLanguagesRequested
  })
  const chatWrite = useChatWrite()
  const siblingsContext = use(SiblingsContext)
  const { editingMessage, editingMessageId, startEditing } = useMessageEditing()
  const canStartNewContext =
    normalInteractionsEnabled && Boolean(chatWrite?.canStartNewContext) && editingMessage?.message.topicId !== topicId
  const resolvedAssistantId = assistant?.id ?? assistantId
  const messageItemCacheRef = useRef(
    new WeakMap<
      CherryUIMessage,
      {
        assistantId?: string
        item: MessageListItem
        topicId: string
      }
    >()
  )

  const messageItems = useMemo(() => {
    return messages.map((message) => {
      const cached = messageItemCacheRef.current.get(message)
      if (cached && cached.assistantId === resolvedAssistantId && cached.topicId === topicId) {
        return cached.item
      }

      const item = toMessageListItem(message, {
        assistantId: resolvedAssistantId,
        topicId
      })
      messageItemCacheRef.current.set(message, {
        assistantId: resolvedAssistantId,
        item,
        topicId
      })
      return item
    })
  }, [messages, resolvedAssistantId, topicId])

  const messagesRef = useRef<MessageListItem[]>(messageItems)
  const partsByMessageIdRef = useRef(partsByMessageId)
  const listRuntimeRef = useRef<MessageListRuntime | null>(null)
  const translationAbortControllersRef = useRef(new Map<string, AbortController>())
  const [translatingMessageIds, setTranslatingMessageIds] = useState<ReadonlySet<string>>(() => new Set())

  const setMessageTranslating = useCallback((messageId: string, isTranslating: boolean) => {
    setTranslatingMessageIds((current) => {
      if (current.has(messageId) === isTranslating) return current

      const next = new Set(current)
      if (isTranslating) {
        next.add(messageId)
      } else {
        next.delete(messageId)
      }
      return next
    })
  }, [])

  const isMessageTranslating = useCallback(
    (messageId: string) => translatingMessageIds.has(messageId),
    [translatingMessageIds]
  )

  const requestTranslationLanguages = useCallback(() => {
    setTranslationLanguagesRequested(true)
  }, [])

  const retryTranslationLanguages = useCallback(() => {
    void refetchTranslationLanguages()
  }, [refetchTranslationLanguages])

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

  const deleteMessage = useCallback<NonNullable<MessageListActions['deleteMessage']>>(
    (messageId, traceOptions) => requireChatWrite('deleteMessage').deleteMessage(messageId, traceOptions),
    [requireChatWrite]
  )

  const persistDiagnosis = useCallback(async (partId: string, diagnosis: DiagnosisResult) => {
    const parsed = parseMessagePartId(partId)
    if (!parsed) return

    const persistedMessage = await dataApiService.get(`/messages/${parsed.messageId}`)
    const updatedParts = withMessagePartDiagnosis(persistedMessage.data.parts ?? [], parsed.partIndex, diagnosis)
    if (!updatedParts) return

    await dataApiService.patch(`/messages/${parsed.messageId}`, { body: { data: { parts: updatedParts } } })
  }, [])
  const diagnosticReport = useMemo(
    () => (normalInteractionsEnabled ? { location: t('error.diagnostic_report.locations.home') } : undefined),
    [normalInteractionsEnabled, t]
  )

  const {
    errorActions,
    exportActions,
    getMessageActivityState,
    messageActivityStore,
    headerCapabilities,
    leafCapabilities,
    menuConfig,
    messageUiStateCache,
    renderConfig,
    selectionController,
    updateRenderConfig
  } = useMessageListAdapterCapabilities({
    topicId,
    topicName: topic.name,
    messages: messageItems,
    partsByMessageId,
    streamingLayers,
    deleteMessage: normalInteractionsEnabled ? deleteMessage : undefined,
    diagnosticReport,
    persistDiagnosis
  })

  useEffect(() => {
    if (!assistant) return
    onFirstUpdate?.()
  }, [assistant, messageItems, onFirstUpdate])

  useEffect(() => {
    const handle = requestAnimationFrame(() => onComponentUpdate?.())
    return () => cancelAnimationFrame(handle)
  }, [onComponentUpdate])

  useCommandHandler(
    'chat.message.copy_last',
    () => {
      const lastMessage = messageItems.findLast((message) => !message.isContextBoundary)
      if (lastMessage) {
        const parts = partsByMessageIdRef.current[lastMessage.id] ?? []
        const richContent = leafCapabilities.copyRichContent ? createComposerRichClipboardContentFromParts(parts) : null
        const text = getComposerTextFromParts(parts)
        const copyTask = richContent
          ? leafCapabilities.copyRichContent?.(richContent, { successMessage: t('message.copy.success') })
          : navigator.clipboard.writeText(text)
        void Promise.resolve(copyTask)
          .then(() => {
            if (!richContent) toast.success(t('message.copy.success'))
          })
          .catch((error) => {
            logger.error('Failed to copy last message:', error as Error)
            toast.error(formatErrorMessageWithPrefix(error, t('common.copy_failed')))
          })
      }
    },
    { enabled: normalInteractionsEnabled }
  )

  useCommandHandler(
    'chat.message.edit_last_user',
    () => {
      const lastUserMessage = messagesRef.current.findLast((m) => m.role === 'user' && !m.isContextBoundary)
      if (lastUserMessage) {
        void EventEmitter.emit(EVENT_NAMES.EDIT_MESSAGE, lastUserMessage.id)
      }
    },
    { enabled: normalInteractionsEnabled }
  )

  const consumeTopicImageAction = useCallback(
    (runtime: MessageListRuntime, type: TopicImageActionType, data?: Topic) => {
      if (data && data.id !== topic.id) return

      const requests = consumePendingTopicImageActions(topic.id, type)
      if (requests.length === 0) {
        void runMessageImageAction(runtime, type)
        return
      }

      for (const request of requests) {
        settleTopicImageActionRequest(request, runMessageImageAction(runtime, type))
      }
    },
    [topic.id]
  )

  const flushPendingTopicImageActions = useCallback(
    (runtime: MessageListRuntime) => {
      flushPendingMessageImageActions({
        consumePendingActions: consumePendingTopicImageActions,
        runtime,
        settleActionRequest: settleTopicImageActionRequest,
        targetId: topic.id
      })
    },
    [topic.id]
  )

  useEffect(() => {
    const topicId = topic.id
    return () => rejectPendingTopicImageActions(topicId, new Error('Topic image export was cancelled'))
  }, [topic.id])

  const bindRuntime = useCallback(
    (runtime: MessageListRuntime) => {
      listRuntimeRef.current = runtime
      const clearBoundRuntime = () => {
        if (listRuntimeRef.current === runtime) listRuntimeRef.current = null
      }
      const unbindExternalRuntime = onBindRuntime?.(runtime)
      if (imageActionConsumer === 'capture') {
        const unbindCaptureRuntime = bindCaptureMessageImageRuntime({
          cancelMessage: 'Topic image export was cancelled',
          consumePendingActions: consumePendingTopicImageActions,
          rejectPendingActions: rejectPendingTopicImageActions,
          runtime,
          settleActionRequest: settleTopicImageActionRequest,
          targetId: topic.id
        })
        return () => {
          unbindCaptureRuntime()
          clearBoundRuntime()
          if (typeof unbindExternalRuntime === 'function') {
            unbindExternalRuntime()
          }
        }
      }

      flushPendingTopicImageActions(runtime)

      const unsubscribes = [
        EventEmitter.on(EVENT_NAMES.COPY_TOPIC_IMAGE, (data?: TopicImageActionRequest['topic']) =>
          consumeTopicImageAction(runtime, 'copy', data)
        ),
        EventEmitter.on(EVENT_NAMES.EXPORT_TOPIC_IMAGE, (data?: TopicImageActionRequest['topic']) =>
          consumeTopicImageAction(runtime, 'export', data)
        )
      ]

      return () => {
        unsubscribes.forEach((unsub) => unsub())
        clearBoundRuntime()
        if (typeof unbindExternalRuntime === 'function') {
          unbindExternalRuntime()
        }
      }
    },
    [consumeTopicImageAction, flushPendingTopicImageActions, imageActionConsumer, onBindRuntime, topic.id]
  )

  const bindMessageRuntime = useCallback(
    (messageId: string, runtime: MessageRuntime) => {
      if (!normalInteractionsEnabled) return () => {}

      const unsubscribes = [
        EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, runtime.locateMessage),
        EventEmitter.on(EVENT_NAMES.EDIT_MESSAGE, (targetId: string) => {
          if (targetId === messageId) {
            runtime.startEditing()
          }
        })
      ]

      return () => unsubscribes.forEach((unsub) => unsub())
    },
    [normalInteractionsEnabled]
  )

  const bindMessageGroupRuntime = useCallback(
    (messageIds: string[], runtime: MessageGroupRuntime) => {
      if (!normalInteractionsEnabled) return () => {}

      const unsubscribes = messageIds.map((messageId) =>
        EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, () => runtime.locateMessage(messageId))
      )

      return () => unsubscribes.forEach((unsub) => unsub())
    },
    [normalInteractionsEnabled]
  )

  const locateMessage = useCallback((messageId: string, highlight?: boolean) => {
    const runtime = listRuntimeRef.current
    if (!runtime) {
      void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, highlight)
      return
    }

    runtime.locateMessage(messageId)
    window.requestAnimationFrame(() => {
      void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, highlight)
    })
  }, [])

  const startNewContext = useCallback(() => {
    if (!canStartNewContext) return

    void requireChatWrite('startNewContext')
      .startNewContext()
      .then(() => {
        void EventEmitter.emit(EVENT_NAMES.FOCUS_CHAT_COMPOSER, { topicId: topic.id })
      })
      .catch((error) => {
        logger.error('Failed to update context boundary:', error as Error)
        toast.error(formatErrorMessageWithPrefix(error, t('message.error.unknown')))
      })
  }, [canStartNewContext, requireChatWrite, t, topic.id])

  const saveCodeBlock = useCallback(
    async (data: { msgBlockId: string; codeBlockId: string; newContent: string }) => {
      const { msgBlockId, codeBlockId, newContent } = data

      try {
        const resolved = resolvePartFromParts(partsByMessageIdRef.current, msgBlockId)
        if (resolved && resolved.part.type === 'text') {
          const textPart = resolved.part as { text?: string }
          const { updateCodeBlock } = await import('@renderer/utils/markdown')
          const updatedText = updateCodeBlock(textPart.text || '', codeBlockId, newContent)
          const allParts = [...(partsByMessageIdRef.current[resolved.messageId] || [])]
          allParts[resolved.index] = {
            ...resolved.part,
            text: updatedText
          } as CherryMessagePart
          await requireChatWrite('saveCodeBlock').editMessage(resolved.messageId, allParts)
          toast.success(t('code_block.edit.save.success'))
          return
        }

        logger.error(
          `Failed to save code block ${codeBlockId} content to message block ${msgBlockId}: unable to resolve part`
        )
        toast.error(t('code_block.edit.save.failed.label'))
      } catch (error) {
        logger.error(`Failed to save code block ${codeBlockId} content to message block ${msgBlockId}:`, error as Error)
        toast.error(formatErrorMessageWithPrefix(error, t('code_block.edit.save.failed.label')))
      }
    },
    [requireChatWrite, t]
  )

  const openPath = useCallback((path: string) => {
    return window.api.file.openPath(path)
  }, [])

  const showInFolder = useCallback((path: string) => {
    return window.api.file.showInFolder(path)
  }, [])

  const abortTool = useCallback(
    (toolId: string) => {
      // Scope must match the registration in mcpTools.ts — provider call ids can
      // collide across topics, and an unscoped abort must not hit another topic's call.
      return ipcApi.request('mcp.tool.abort_call', { callId: toolId, scope: topicId })
    },
    [topicId]
  )

  const navigateToRoute = useCallback<NonNullable<MessageListActions['navigateToRoute']>>(
    ({ path, query }) => openRoute(path, query),
    []
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
      controller: AbortController,
      sourceLanguage?: TranslateLangCode
    ): Promise<{
      onResponse: (accumulatedText: string) => void
      waitForPendingUpdates: () => Promise<void>
    } | null> => {
      if (!topic.id) return null
      const write = requireChatWrite('translateMessage')
      const isCurrentTranslation = () => translationAbortControllersRef.current.get(messageId) === controller

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
      if (!isCurrentTranslation()) return null

      let pendingUpdate = Promise.resolve()

      const onResponse = (accumulatedText: string) => {
        if (!isCurrentTranslation()) return

        const translationPart = {
          type: 'data-translation' as const,
          data: {
            content: accumulatedText,
            targetLanguage,
            ...(sourceLanguage && { sourceLanguage })
          }
        }

        pendingUpdate = pendingUpdate
          .then(() => {
            if (!isCurrentTranslation()) return
            return write.editMessage(messageId, [...baseParts, translationPart as CherryMessagePart])
          })
          .catch((error) => {
            logger.error('Failed to update message translation:', error as Error, { messageId })
          })
      }

      return {
        onResponse,
        waitForPendingUpdates: () => pendingUpdate
      }
    },
    [requireChatWrite, topic.id]
  )

  const translateMessage = useCallback<NonNullable<MessageListActions['translateMessage']>>(
    async (messageId, language, sourceText) => {
      if (!sourceText.trim()) return

      const controller = new AbortController()
      let translationUpdater: Awaited<ReturnType<typeof createTranslationUpdater>> = null
      try {
        translationAbortControllersRef.current.get(messageId)?.abort()
        translationAbortControllersRef.current.set(messageId, controller)
        setMessageTranslating(messageId, true)

        translationUpdater = await createTranslationUpdater(messageId, language.langCode, controller)
        if (!translationUpdater) {
          if (translationAbortControllersRef.current.get(messageId) === controller) {
            toast.error(t('message.error.unknown'))
          }
          return
        }

        await translateText(sourceText, language, translationUpdater.onResponse, controller.signal)
        await translationUpdater.waitForPendingUpdates()
      } catch (error) {
        await translationUpdater?.waitForPendingUpdates()

        if (!isAbortError(error)) {
          logger.error('Message translation failed', error as Error)
          toast.error(formatErrorMessageWithPrefix(error, t('translate.error.failed')))
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
              try {
                await requireChatWrite('removeMessageTranslation').editMessage(messageId, baseParts)
              } catch (cleanupError) {
                logger.error('Failed to clean up translation loading part:', cleanupError as Error, { messageId })
              }
            }
          }
        }
      } finally {
        if (translationAbortControllersRef.current.get(messageId) === controller) {
          translationAbortControllersRef.current.delete(messageId)
          setMessageTranslating(messageId, false)
        }
      }
    },
    [createTranslationUpdater, requireChatWrite, setMessageTranslating, t]
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

  const getMessageDeleteAvailability = useCallback<NonNullable<MessageListActions['getMessageDeleteAvailability']>>(
    (messageId) => requireChatWrite('getMessageDeleteAvailability').getMessageDeleteAvailability(messageId),
    [requireChatWrite]
  )

  const startMessageBranch = useCallback<NonNullable<MessageListActions['startMessageBranch']>>(
    (messageId) => {
      if (onStartBranchDraft) {
        return onStartBranchDraft(messageId)
      }
      return requireChatWrite('startMessageBranch').setActiveNode(messageId)
    },
    [onStartBranchDraft, requireChatWrite]
  )

  const copyBranchToNewTopic = useCallback<NonNullable<MessageListActions['copyBranchToNewTopic']>>(
    async (messageId) => {
      await copyBranchToNewTopicTrigger({
        params: { id: topicId },
        body: { nodeId: messageId }
      })
    },
    [copyBranchToNewTopicTrigger, topicId]
  )

  const setActiveBranch = useCallback<NonNullable<MessageListActions['setActiveBranch']>>(
    (messageId) => requireChatWrite('setActiveBranch').setActiveBranch(messageId),
    [requireChatWrite]
  )

  const deleteMessageGroup = useCallback<NonNullable<MessageListActions['deleteMessageGroup']>>(
    (messageIds) => requireChatWrite('deleteMessageGroup').deleteMessageGroup(messageIds),
    [requireChatWrite]
  )

  const deleteMessageGroupWithConfirm = useCallback<NonNullable<MessageListActions['deleteMessageGroupWithConfirm']>>(
    async (messageIds) => {
      const confirmed = await popup.confirm({
        title: t('message.group.delete.title'),
        content: t('message.group.delete.content'),
        centered: true,
        okButtonProps: {
          danger: true
        },
        okText: t('common.delete')
      })
      if (!confirmed) return

      try {
        await deleteMessageGroup(messageIds)
      } catch (error) {
        logger.error('Failed to delete message group:', error as Error)
        toast.error(formatErrorMessageWithPrefix(error, t('message.delete.failed')))
      }
    },
    [deleteMessageGroup, t]
  )

  const regenerateMessage = useCallback<NonNullable<MessageListActions['regenerateMessage']>>(
    (messageId) => requireChatWrite('regenerateMessage').regenerate(messageId),
    [requireChatWrite]
  )

  const regenerateMessageUsingModel = useCallback(
    (messageId: string, modelId: UniqueModelId) =>
      requireChatWrite('regenerateMessageUsingModel').regenerate(messageId, { modelId }),
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
        try {
          await regenerateMessageUsingModel(message.id, selected.id)
        } catch (error) {
          logger.error('Failed to regenerate message using selected model:', error as Error)
          toast.error(formatErrorMessageWithPrefix(error, t('message.error.unknown')))
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

  const state = useMemo<MessageListState>(
    () => ({
      topic,
      messages: messageItems,
      partsByMessageId,
      streamingLayers,
      isInitialLoading,
      isMessagesStale,
      hasOlder,
      messageNavigation,
      ...DEFAULT_MESSAGE_LIST_CONFIG,
      listKey: resolvedAssistantId,
      renderConfig,
      menuConfig,
      selection: selectionController.selection,
      editingMessageId,
      translationLanguages,
      translationLanguagesStatus,
      getMessageUiState: messageUiStateCache.getMessageUiState,
      getMessageSiblings,
      messageActivityStore,
      getMessageActivityState,
      isMessageTranslating,
      ...pickMessageLeafState(leafCapabilities),
      getTranslationLanguageLabel
    }),
    [
      editingMessageId,
      getMessageActivityState,
      getMessageSiblings,
      isMessageTranslating,
      getTranslationLanguageLabel,
      hasOlder,
      isInitialLoading,
      isMessagesStale,
      leafCapabilities,
      menuConfig,
      messageUiStateCache.getMessageUiState,
      messageItems,
      messageActivityStore,
      messageNavigation,
      partsByMessageId,
      renderConfig,
      resolvedAssistantId,
      selectionController.selection,
      streamingLayers,
      topic,
      translationLanguages,
      translationLanguagesStatus
    ]
  )

  const actions = useMemo<MessageListActions>(
    () => ({
      loadOlder,
      bindRuntime,
      bindMessageRuntime,
      bindMessageGroupRuntime,
      locateMessage,
      ...(canStartNewContext && { startNewContext }),
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
      getMessageDeleteAvailability: normalInteractionsEnabled ? getMessageDeleteAvailability : undefined,
      deleteMessage: normalInteractionsEnabled ? deleteMessage : undefined,
      startMessageBranch,
      copyBranchToNewTopic: normalInteractionsEnabled ? copyBranchToNewTopic : undefined,
      setActiveBranch,
      deleteMessageGroup,
      deleteMessageGroupWithConfirm,
      regenerateMessage,
      requestTranslationLanguages: normalInteractionsEnabled ? requestTranslationLanguages : undefined,
      retryTranslationLanguages: normalInteractionsEnabled ? retryTranslationLanguages : undefined,
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
      canStartNewContext,
      copyBranchToNewTopic,
      getMessageDeleteAvailability,
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
      normalInteractionsEnabled,
      openCitationsPanel,
      openPath,
      regenerateMessage,
      requestTranslationLanguages,
      retryTranslationLanguages,
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
      assistantProfile: assistant ? { name: assistant.name, avatar: assistant.emoji } : undefined,
      imageExportFileName: topic.name
    }),
    [assistant, headerCapabilities.userProfile, topic.name]
  )

  return useMemo(() => ({ state, actions, meta }), [actions, meta, state])
}
