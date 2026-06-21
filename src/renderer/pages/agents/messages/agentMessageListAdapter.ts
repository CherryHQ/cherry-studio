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
  MessageListMeta,
  MessageListProviderValue,
  MessageListRuntime,
  MessageListState,
  MessageRuntime
} from '@renderer/components/chat/messages/types'
import { normalizeInlineFilePath, resolveInlineFilePath } from '@renderer/components/chat/messages/utils/filePath'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic } from '@renderer/types'
import type { CherryMessagePart, CherryUIMessage, ModelSnapshot } from '@shared/data/types/message'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'

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
  assistantProfile?: {
    name?: string
    avatar?: string
  }
  assistantId?: string
  modelFallback?: ModelSnapshot
  isLoading: boolean
  hasOlder?: boolean
  loadOlder?: () => void
  openCitationsPanel?: MessageListActions['openCitationsPanel']
  openAgentToolFlow?: MessageListActions['openAgentToolFlow']
  openArtifactFile?: MessageListActions['openArtifactFile']
  deleteMessage?: MessageListActions['deleteMessage']
  respondToolApproval?: MessageListActions['respondToolApproval']
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
  assistantProfile,
  assistantId,
  modelFallback,
  isLoading,
  hasOlder = false,
  loadOlder,
  openCitationsPanel,
  openAgentToolFlow,
  openArtifactFile,
  deleteMessage,
  respondToolApproval,
  messageNavigation,
  workspacePath
}: AgentMessageListParams): MessageListProviderValue {
  const navigate = useNavigate()
  const visibleMessages = useMemo(
    () =>
      messages.filter((message) => {
        const parts = partsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
        if (parts.length === 0) return true
        return parts.some((part) => !hasPartParentToolCallId(part))
      }),
    [messages, partsByMessageId]
  )
  const messageItems = useMemo(
    () =>
      visibleMessages.map((message) =>
        toMessageListItem(message, {
          assistantId: assistantId ?? topic.assistantId,
          topicId: topic.id,
          modelFallback
        })
      ),
    [assistantId, visibleMessages, modelFallback, topic.assistantId, topic.id]
  )

  const getMessageActivityState = useMessageActivityState(topic.id, partsByMessageId)
  const { renderConfig, updateRenderConfig } = useMessageListRenderConfig()
  const menuConfig = useMessageMenuConfig()
  const exportActions = useMessageExportActions({ topicName: topic.name })
  const errorActions = useMessageErrorActions()
  const leafCapabilities = useMessageLeafCapabilities({ partsByMessageId })
  const headerCapabilities = useMessageHeaderCapabilities()
  const messageUiStateCache = useMessageUiStateCache()
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

  const abortTool = useCallback((toolId: string) => {
    return window.api.mcp.abortTool(toolId)
  }, [])

  const navigateToRoute = useCallback<NonNullable<MessageListActions['navigateToRoute']>>(
    ({ path, query }) => navigate({ to: path, search: query }),
    [navigate]
  )

  const bindRuntime = useCallback(
    (runtime: MessageListRuntime) => {
      agentMessageListRuntimes.set(topic.id, runtime)

      return () => {
        if (agentMessageListRuntimes.get(topic.id) === runtime) {
          agentMessageListRuntimes.delete(topic.id)
        }
      }
    },
    [topic.id]
  )

  const bindMessageRuntime = useCallback((messageId: string, runtime: MessageRuntime) => {
    const unsubscribes = [EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, runtime.locateMessage)]

    return () => unsubscribes.forEach((unsub) => unsub())
  }, [])

  const bindMessageGroupRuntime = useCallback((messageIds: string[], runtime: MessageGroupRuntime) => {
    const unsubscribes = messageIds.map((messageId) =>
      EventEmitter.on(EVENT_NAMES.LOCATE_MESSAGE + ':' + messageId, () => runtime.locateMessage(messageId))
    )

    return () => unsubscribes.forEach((unsub) => unsub())
  }, [])

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
      openArtifactFile,
      openCitationsPanel,
      openAgentToolFlow,
      showInFolder,
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
      leafCapabilities,
      navigateToRoute,
      loadOlder,
      locateMessage,
      messageUiStateCache.updateMessageUiState,
      openCitationsPanel,
      openArtifactFile,
      openAgentToolFlow,
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
      assistantProfile
    }),
    [assistantProfile, headerCapabilities.userProfile]
  )

  return useMemo(() => ({ state, actions, meta }), [actions, meta, state])
}
