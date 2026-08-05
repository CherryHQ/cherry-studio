import { dataApiService } from '@data/DataApiService'
import { isHiddenPart } from '@renderer/components/chat/messages/blocks/messagePartLayouts'
import { useMessageListAdapterCapabilities } from '@renderer/components/chat/messages/hooks/useMessageListAdapterCapabilities'
import {
  pickMessageHeaderActions,
  pickMessageLeafActions,
  pickMessageLeafState
} from '@renderer/components/chat/messages/messageListProviderBuilder'
import { hasPartParentToolCallId } from '@renderer/components/chat/messages/tools/toolParentMetadata'
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
import { dispatchLocateMessage } from '@renderer/components/chat/messages/utils/dispatchLocateMessage'
import { parseMessagePartId, withMessagePartDiagnosis } from '@renderer/components/chat/messages/utils/messageDiagnosis'
import { bindCaptureMessageImageRuntime } from '@renderer/components/chat/messages/utils/messageImageRuntimeActions'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { ipcApi } from '@renderer/ipc'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import type { Topic } from '@renderer/types/topic'
import { extractAgentSessionIdFromTopicId } from '@renderer/utils/agentSession'
import type { DiagnosisResult } from '@renderer/utils/errorDiagnosis'
import { normalizeInlineFilePath, resolveInlineFilePath } from '@renderer/utils/filePath'
import type { ResponseForPath } from '@shared/data/api/paths'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import AgentSessionApiRetryStatus from './AgentSessionApiRetryStatus'
import {
  consumePendingAgentSessionImageActions,
  rejectPendingAgentSessionImageActions,
  settleAgentSessionImageActionRequest
} from './agentSessionImageActionBus'

const agentMessageListRuntimes = new Map<string, MessageListRuntime>()

function withTerminalErrorFallback(
  messages: CherryUIMessage[],
  partsByMessageId: Record<string, CherryMessagePart[]>,
  noResponseMessage: string
): Record<string, CherryMessagePart[]> {
  let next = partsByMessageId

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const status = message.metadata?.status
    const parts = partsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
    const hasVisiblePart = parts.some((part) => !isHiddenPart(part))
    const needsFallback =
      (status === 'error' && !parts.some((part) => part.type === 'data-error')) ||
      (status === 'success' && !hasVisiblePart)
    if (!needsFallback) continue

    if (next === partsByMessageId) next = { ...partsByMessageId }
    next[message.id] = [
      ...parts,
      {
        type: 'data-error',
        data: { name: 'AgentRuntimeError', message: noResponseMessage, stack: null }
      }
    ]
  }

  return next
}

export function locateAgentMessageInList(topicId: string, messageId: string, highlight?: boolean): boolean {
  const runtime = agentMessageListRuntimes.get(topicId) ?? null
  dispatchLocateMessage(runtime, messageId, highlight)
  return runtime !== null
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
  messageTail?: MessageListState['messageTail']
}

/**
 * Resolve a tool-reported path to a branded absolute path, applying the session
 * workspace as the root for relative input.
 *
 * Returns `null` when no absolute path exists — the only real case being a
 * relative path with no workspace root to resolve it against. The user-facing
 * open/reveal actions turn that into an error so the shared UI can report it.
 *
 * `workspacePath` arrives as a bare `string`: main normalizes and enforces
 * absoluteness before persisting (`@main/utils/agentWorkspacePath`), but
 * `AgentWorkspacePathSchema` is only `z.string().min(1)`, so the guarantee does
 * not survive the process boundary as a type. Re-asserting it here is the cost
 * of that gap, not redundant validation — tracked in
 * https://github.com/CherryHQ/cherry-studio/issues/17431.
 */
const resolveWorkspaceFilePath = (workspacePath: string | undefined, rawPath: string): AbsoluteFilePath | null => {
  const normalizedPath = normalizeInlineFilePath(resolveInlineFilePath(rawPath))
  const isAlreadyAbsolute = AbsoluteFilePathSchema.safeParse(normalizedPath).success

  const candidate =
    !workspacePath || isAlreadyAbsolute
      ? normalizedPath
      : `${workspacePath.replace(/[\\/]+$/g, '')}/${normalizedPath.replace(/^\.?[\\/]+/g, '')}`

  return AbsoluteFilePathSchema.safeParse(candidate).data ?? null
}

/** Resolve for an action the user explicitly asked for — an unresolvable path is an error they must see. */
const requireWorkspaceFilePath = (workspacePath: string | undefined, rawPath: string): AbsoluteFilePath => {
  const resolved = resolveWorkspaceFilePath(workspacePath, rawPath)
  if (!resolved) throw new Error(`Cannot resolve "${rawPath}" to an absolute path without a workspace root`)
  return resolved
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
  workspacePath,
  messageTail
}: AgentMessageListParams): MessageListProviderValue {
  const { t } = useTranslation()
  const sessionId = useMemo(() => extractAgentSessionIdFromTopicId(topic.id), [topic.id])
  const preparingPhrases = useMemo(
    () => [
      t('message.tools.placeholder.preparing_phrases.ideas_bubbling'),
      t('message.tools.placeholder.preparing_phrases.gears_turning'),
      t('message.tools.placeholder.preparing_phrases.catching_inspiration'),
      t('message.tools.placeholder.preparing_phrases.connecting_clues'),
      t('message.tools.placeholder.preparing_phrases.answer_on_the_way'),
      t('message.tools.placeholder.preparing_phrases.answer_puzzle'),
      t('message.tools.placeholder.preparing_phrases.brewing_solid_answer'),
      t('message.tools.placeholder.preparing_phrases.ideas_lining_up'),
      t('message.tools.placeholder.preparing_phrases.mental_notebook'),
      t('message.tools.placeholder.preparing_phrases.mulling_it_over'),
      t('message.tools.placeholder.preparing_phrases.polishing_answer'),
      t('message.tools.placeholder.preparing_phrases.sparking_ideas'),
      t('message.tools.placeholder.preparing_phrases.brain_cells_huddle'),
      t('message.tools.placeholder.preparing_phrases.inspiration_radar'),
      t('message.tools.placeholder.preparing_phrases.changing_angle'),
      t('message.tools.placeholder.preparing_phrases.answer_warming_up'),
      t('message.tools.placeholder.preparing_phrases.finding_right_words'),
      t('message.tools.placeholder.preparing_phrases.mining_ideas'),
      t('message.tools.placeholder.preparing_phrases.thought_around_corner'),
      t('message.tools.placeholder.preparing_phrases.serving_fresh_answer')
    ],
    [t]
  )
  const resolvedAgentId = assistantId ?? topic.assistantId
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
  const displayPartsByMessageId = useMemo(
    () => withTerminalErrorFallback(messages, partsByMessageId, t('error.no_response')),
    [messages, partsByMessageId, t]
  )
  const displayStreamingLayers = useMemo(() => {
    if (!streamingLayers) return undefined

    const historyPartsByMessageId = withTerminalErrorFallback(
      messages,
      streamingLayers.historyPartsByMessageId,
      t('error.no_response')
    )
    if (historyPartsByMessageId === streamingLayers.historyPartsByMessageId) return streamingLayers

    return { ...streamingLayers, historyPartsByMessageId }
  }, [messages, streamingLayers, t])
  const visibleMessages = useMemo(
    () =>
      messages.filter((message) => {
        const parts = displayPartsByMessageId[message.id] ?? ((message.parts ?? []) as CherryMessagePart[])
        if (parts.length === 0) return true
        return parts.some((part) => !hasPartParentToolCallId(part))
      }),
    [displayPartsByMessageId, messages]
  )
  const messageItems = useMemo(() => {
    return visibleMessages.map((message) => {
      const cached = messageItemCacheRef.current.get(message)
      if (cached && cached.assistantId === resolvedAgentId && cached.topicId === topic.id) {
        return cached.item
      }

      const item = toMessageListItem(message, {
        assistantId: resolvedAgentId,
        topicId: topic.id
      })
      messageItemCacheRef.current.set(message, {
        assistantId: resolvedAgentId,
        item,
        topicId: topic.id
      })
      return item
    })
  }, [resolvedAgentId, visibleMessages, topic.id])

  const persistDiagnosis = useCallback(
    async (partId: string, diagnosis: DiagnosisResult) => {
      const parsed = parseMessagePartId(partId)
      if (!parsed) return

      const persistedMessage = (await dataApiService.get(
        `/agent-sessions/${sessionId}/messages/${parsed.messageId}`
      )) as ResponseForPath<'/agent-sessions/:sessionId/messages/:messageId', 'GET'>
      const updatedParts = withMessagePartDiagnosis(persistedMessage.data.parts ?? [], parsed.partIndex, diagnosis)
      if (!updatedParts) return

      await dataApiService.patch(`/agent-sessions/${sessionId}/messages/${parsed.messageId}`, {
        body: { data: { parts: updatedParts } }
      })
    },
    [sessionId]
  )
  const {
    errorActions,
    exportActions,
    getMessageActivityState,
    headerCapabilities,
    leafCapabilities,
    menuConfig,
    messageUiStateCache,
    renderConfig,
    selectionController,
    updateRenderConfig
  } = useMessageListAdapterCapabilities({
    topicId: topic.id,
    topicName: topic.name,
    messages: messageItems,
    partsByMessageId: displayPartsByMessageId,
    streamingLayers: displayStreamingLayers,
    deleteMessage,
    persistDiagnosis
  })
  const normalInteractionsEnabled = imageActionConsumer !== 'capture'

  const openPath = useCallback(
    (path: string) => {
      return window.api.file.openPath(requireWorkspaceFilePath(workspacePath, path))
    },
    [workspacePath]
  )

  const showInFolder = useCallback(
    (path: string) => {
      return window.api.file.showInFolder(requireWorkspaceFilePath(workspacePath, path))
    },
    [workspacePath]
  )

  const openInExternalApp = useMemo<MessageListActions['openInExternalApp']>(() => {
    const open = leafCapabilities.openInExternalApp
    if (!open) return undefined

    return (app, path) => open(app, requireWorkspaceFilePath(workspacePath, path))
  }, [leafCapabilities.openInExternalApp, workspacePath])

  const abortTool = useCallback((toolId: string) => {
    return ipcApi.request('mcp.tool.abort_call', { callId: toolId })
  }, [])

  const navigateToRoute = useCallback<NonNullable<MessageListActions['navigateToRoute']>>(
    ({ path, query }) => openRoute(path, query),
    []
  )

  useEffect(() => {
    if (imageActionConsumer !== 'capture') return

    return () => rejectPendingAgentSessionImageActions(sessionId, new Error('Agent session image export was cancelled'))
  }, [imageActionConsumer, sessionId])

  const bindRuntime = useCallback(
    (runtime: MessageListRuntime) => {
      if (imageActionConsumer === 'capture') {
        const unbindCaptureRuntime = bindCaptureMessageImageRuntime({
          cancelMessage: 'Agent session image export was cancelled',
          consumePendingActions: consumePendingAgentSessionImageActions,
          rejectPendingActions: rejectPendingAgentSessionImageActions,
          runtime,
          settleActionRequest: settleAgentSessionImageActionRequest,
          targetId: sessionId
        })
        return unbindCaptureRuntime
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

  // Replaces the live turn's placeholder with the api-retry line while retrying, otherwise the
  // placeholder itself (the component decides from session-scoped cache).
  const renderActiveTurnStatus = useCallback(
    (placeholder: ReactNode) => <AgentSessionApiRetryStatus sessionId={sessionId} fallback={placeholder} />,
    [sessionId]
  )

  const state = useMemo<MessageListState>(
    () => ({
      topic,
      messages: messageItems,
      partsByMessageId: displayPartsByMessageId,
      streamingLayers: displayStreamingLayers,
      activeTurnStatus: normalInteractionsEnabled ? renderActiveTurnStatus : undefined,
      messageTail: normalInteractionsEnabled ? messageTail : undefined,
      isInitialLoading: isLoading && messageItems.length === 0,
      hasOlder,
      messageNavigation,
      ...DEFAULT_MESSAGE_LIST_CONFIG,
      listKey: resolvedAgentId,
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
      messageTail,
      normalInteractionsEnabled,
      displayPartsByMessageId,
      renderActiveTurnStatus,
      renderConfig,
      resolvedAgentId,
      selectionController.selection,
      displayStreamingLayers,
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
      imageExportFileName: topic.name,
      preparingPhrases,
      aiUsageMessageKind: 'agent-session'
    }),
    [assistantProfile, headerCapabilities.userProfile, preparingPhrases, topic.name]
  )

  return useMemo(() => ({ state, actions, meta }), [actions, meta, state])
}
