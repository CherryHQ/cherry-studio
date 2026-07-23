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
import { hasPartParentToolCallId } from '@renderer/components/chat/messages/tools/toolParentMetadata'
import type {
  MessageGroupRuntime,
  MessageListActions,
  MessageListItem,
  MessageListMeta,
  MessageListProviderValue,
  MessageListRuntime,
  MessageListState,
  MessageRuntime,
  MessageStreamingLayers
} from '@renderer/components/chat/messages/types'
import { bindCaptureMessageImageRuntime } from '@renderer/components/chat/messages/utils/messageImageRuntimeActions'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types/topic'
import { extractAgentSessionIdFromTopicId } from '@renderer/utils/agentSession'
import { normalizeInlineFilePath, resolveInlineFilePath } from '@renderer/utils/filePath'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import {
  consumePendingAgentSessionImageActions,
  rejectPendingAgentSessionImageActions,
  settleAgentSessionImageActionRequest
} from './agentSessionImageActionBus'

const agentMessageListRuntimes = new Map<string, MessageListRuntime>()

export function locateAgentMessageInList(topicId: string, messageId: string, highlight?: boolean): boolean {
  const runtime = agentMessageListRuntimes.get(topicId)
  if (!runtime) {
    void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, highlight)
    return false
  }

  runtime.locateMessage(messageId)
  window.requestAnimationFrame(() => {
    void EventEmitter.emit(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, highlight)
  })
  return true
}

interface AgentMessageListParams {
  topic: Topic
  messages: CherryUIMessage[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  streamingLayers?: MessageStreamingLayers
  assistantProfile?: {
    name?: string
    avatar?: string
  }
  assistantId?: string
  isLoading: boolean
  hasOlder?: boolean
  loadOlder?: () => void
  openCitationsPanel?: MessageListActions['openCitationsPanel']
  openAgentToolFlow?: MessageListActions['openAgentToolFlow']
  openArtifactFile?: MessageListActions['openArtifactFile']
  deleteMessage?: MessageListActions['deleteMessage']
  respondToolApproval?: MessageListActions['respondToolApproval']
  imageActionConsumer?: 'capture'
  messageNavigation: string
  workspacePath?: string
}

const isAbsoluteFilePath = (path: string): boolean => {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)
}

const resolveWorkspaceFilePath = (workspacePath: string | undefined, rawPath: string): string => {
  const normalizedPath = normalizeInlineFilePath(resolveInlineFilePath(rawPath))
  if (!workspacePath || isAbsoluteFilePath(normalizedPath)) return normalizedPath

  const cleanWorkspacePath = workspacePath.replace(/[\\/]+$/g, '')
  const cleanRelativePath = normalizedPath.replace(/^\.?[\\/]+/g, '')
  return `${cleanWorkspacePath}/${cleanRelativePath}`
}

export function useAgentMessageListProviderValue({
  topic,
  messages,
  partsByMessageId,
  streamingLayers,
  assistantProfile,
  assistantId,
  isLoading,
  hasOlder = false,
  loadOlder,
  openCitationsPanel,
  openAgentToolFlow,
  openArtifactFile,
  deleteMessage,
  respondToolApproval,
  imageActionConsumer,
  messageNavigation,
  workspacePath
}: AgentMessageListParams): MessageListProviderValue {
  const navigate = useNavigate()
  const sessionId = useMemo(() => extractAgentSessionIdFromTopicId(topic.id), [topic.id])
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
  const visibleMessages = useMemo(
    () =>
      messages.filter((message) => {
        const parts = partsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
        if (parts.length === 0) return true
        return parts.some((part) => !hasPartParentToolCallId(part))
      }),
    [messages, partsByMessageId]
  )
  const messageItems = useMemo(() => {
    const resolvedAssistantId = assistantId ?? topic.assistantId
    return visibleMessages.map((message) => {
      const cached = messageItemCacheRef.current.get(message)
      if (cached && cached.assistantId === resolvedAssistantId && cached.topicId === topic.id) {
        return cached.item
      }

      const item = toMessageListItem(message, {
        assistantId: resolvedAssistantId,
        topicId: topic.id
      })
      messageItemCacheRef.current.set(message, {
        assistantId: resolvedAssistantId,
        item,
        topicId: topic.id
      })
      return item
    })
  }, [assistantId, visibleMessages, topic.assistantId, topic.id])

  const getMessageActivityState = useMessageActivityState(topic.id, partsByMessageId)
  const { renderConfig, updateRenderConfig } = useMessageListRenderConfig()
  const menuConfig = useMessageMenuConfig()
  const exportActions = useMessageExportActions({ topicName: topic.name })
  const errorActions = useMessageErrorActions()
  const leafCapabilities = useMessageLeafCapabilities({ partsByMessageId, streamingLayers })
  const headerCapabilities = useMessageHeaderCapabilities()
  const messageUiStateCache = useMessageUiStateCache()
  const normalInteractionsEnabled = imageActionConsumer !== 'capture'
  const selectionController = useMessageSelectionController({
    topicId: topic.id,
    messages: messageItems,
    partsByMessageId,
    deleteMessage,
    saveTextFile: exportActions.saveTextFile,
    copyRichContent: leafCapabilities.copyRichContent
  })

  const openPath = useCallback(
    (path: string) => {
      return window.api.file.openPath(resolveWorkspaceFilePath(workspacePath, path))
    },
    [workspacePath]
  )

  const showInFolder = useCallback(
    (path: string) => {
      return window.api.file.showInFolder(resolveWorkspaceFilePath(workspacePath, path))
    },
    [workspacePath]
  )

  const isDirectory = useCallback(
    (path: string) => {
      return window.api.file.isDirectory(resolveWorkspaceFilePath(workspacePath, path))
    },
    [workspacePath]
  )

  const openInExternalApp = useMemo<MessageListActions['openInExternalApp']>(() => {
    const open = leafCapabilities.openInExternalApp
    if (!open) return undefined

    return (app, path) => open(app, resolveWorkspaceFilePath(workspacePath, path))
  }, [leafCapabilities.openInExternalApp, workspacePath])

  const abortTool = useCallback((toolId: string) => {
    return ipcApi.request('mcp.tool.abort_call', { callId: toolId })
  }, [])

  const navigateToRoute = useCallback<NonNullable<MessageListActions['navigateToRoute']>>(
    ({ path, query }) => navigate({ to: path, search: query }),
    [navigate]
  )

  useEffect(() => {
    if (imageActionConsumer !== 'capture') return

    return () => rejectPendingAgentSessionImageActions(sessionId, new Error('Agent session image export was cancelled'))
  }, [imageActionConsumer, sessionId])

  const bindRuntime = useCallback(
    (runtime: MessageListRuntime) => {
      if (imageActionConsumer === 'capture') {
        return bindCaptureMessageImageRuntime({
          cancelMessage: 'Agent session image export was cancelled',
          consumePendingActions: consumePendingAgentSessionImageActions,
          rejectPendingActions: rejectPendingAgentSessionImageActions,
          runtime,
          settleActionRequest: settleAgentSessionImageActionRequest,
          targetId: sessionId
        })
      }

      agentMessageListRuntimes.set(topic.id, runtime)

      return () => {
        if (agentMessageListRuntimes.get(topic.id) === runtime) {
          agentMessageListRuntimes.delete(topic.id)
        }
      }
    },
    [imageActionConsumer, sessionId, topic.id]
  )

  const bindMessageRuntime = useCallback(
    (messageId: string, runtime: MessageRuntime) => {
      if (!normalInteractionsEnabled) return () => {}

      const unsubscribes = [EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, runtime.locateMessage)]

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

  const locateMessage = useCallback(
    (messageId: string, highlight?: boolean) => {
      locateAgentMessageInList(topic.id, messageId, highlight)
    },
    [topic.id]
  )

  const state = useMemo<MessageListState>(
    () => ({
      topic,
      messages: messageItems,
      partsByMessageId,
      streamingLayers,
      isInitialLoading: isLoading && messageItems.length === 0,
      hasOlder,
      messageNavigation,
      estimateSize: 400,
      overscan: 6,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 600,
      listKey: topic.id,
      readonly: true,
      renderConfig,
      menuConfig,
      selection: selectionController.selection,
      getMessageUiState: messageUiStateCache.getMessageUiState,
      getMessageActivityState,
      ...pickMessageLeafState(leafCapabilities)
    }),
    [
      getMessageActivityState,
      hasOlder,
      isLoading,
      leafCapabilities,
      menuConfig,
      messageUiStateCache.getMessageUiState,
      messageNavigation,
      messageItems,
      partsByMessageId,
      renderConfig,
      selectionController.selection,
      streamingLayers,
      topic
    ]
  )

  const actions = useMemo<MessageListActions>(
    () => ({
      loadOlder,
      bindRuntime,
      deleteMessage,
      ...exportActions,
      ...errorActions,
      ...pickMessageLeafActions(leafCapabilities),
      navigateToRoute,
      ...pickMessageHeaderActions(headerCapabilities),
      respondToolApproval,
      openPath,
      openInExternalApp,
      openArtifactFile,
      openCitationsPanel,
      openAgentToolFlow,
      showInFolder,
      isDirectory,
      abortTool,
      bindMessageRuntime,
      bindMessageGroupRuntime,
      locateMessage,
      ...selectionController.actions,
      updateMessageUiState: messageUiStateCache.updateMessageUiState,
      updateRenderConfig
    }),
    [
      abortTool,
      bindRuntime,
      bindMessageGroupRuntime,
      bindMessageRuntime,
      deleteMessage,
      errorActions,
      exportActions,
      headerCapabilities,
      isDirectory,
      leafCapabilities,
      navigateToRoute,
      loadOlder,
      locateMessage,
      messageUiStateCache.updateMessageUiState,
      openCitationsPanel,
      openArtifactFile,
      openAgentToolFlow,
      openInExternalApp,
      openPath,
      respondToolApproval,
      selectionController.actions,
      showInFolder,
      updateRenderConfig
    ]
  )

  const meta = useMemo<MessageListMeta>(
    () => ({
      selectionLayer: true,
      userProfile: headerCapabilities.userProfile,
      assistantProfile,
      imageExportFileName: topic.name
    }),
    [assistantProfile, headerCapabilities.userProfile, topic.name]
  )

  return useMemo(() => ({ state, actions, meta }), [actions, meta, state])
}
