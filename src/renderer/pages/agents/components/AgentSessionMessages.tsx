import { memo, useEffect, useMemo } from 'react'

import MessageList from '@renderer/components/chat/messages/MessageList'
import { MessageListProvider } from '@renderer/components/chat/messages/MessageListProvider'
import { AskUserQuestionOptimisticInputProvider } from '@renderer/components/chat/messages/tools/agent'
import type { MessageListState } from '@renderer/components/chat/messages/types'
import type {
  MessageListActions,
  MessageListSelectAllPagination,
  MessageStreamingLayers
} from '@renderer/components/chat/messages/types'
import { LocalAgentIcon } from '@renderer/components/icons/LocalAgentIcon'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { ProjectionReaderProvider } from '@renderer/hooks/agent/ProjectionReaderProvider'
import { useAgentSessionStreamTopic } from '@renderer/hooks/agent/useAgentSessionStreamTopic'
import { useSession } from '@renderer/hooks/agent/useSession'
import { useStableStringArray } from '@renderer/hooks/useStableStringArray'
import { ipcApi } from '@renderer/ipc'
import { messageProjectionService } from '@renderer/services/aiTransport'
import type { GetAgentResponse } from '@renderer/types/agent'
import { type Topic, TopicType } from '@renderer/types/topic'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { type MessagePartRows, messagePartsAt } from '@renderer/utils/message/messagePartRows'
import { buildAgentSessionTopicId } from '@shared/ai/agentSessionTopic'
import type { AgentSessionHistoryActions } from '@shared/data/api/schemas/agentSessionMessages'
import type { CherryUIMessage } from '@shared/data/types/message'

import { type NavigateToForkSource, useAgentMessageListProviderValue } from '../messages/agentMessageListAdapter'
import { AgentPendingAttachments } from '../messages/AgentPendingAttachments'
import AgentSessionBackgroundTasks from '../messages/AgentSessionBackgroundTasks'

type Props = {
  agentId?: string
  sessionId: string
  workspacePath?: string
  messages: CherryUIMessage[]
  historyActions?: Readonly<Record<string, AgentSessionHistoryActions | undefined>>
  activeAgent?: GetAgentResponse
  partsByMessageId: MessagePartRows
  streamingLayers?: MessageStreamingLayers
  optimisticAskUserQuestionInputsByToolCallId?: Record<string, unknown>
  isLoading: boolean
  /** Whether more older messages remain on the server (cursor pagination). */
  hasOlder?: boolean
  /** Trigger fetching the next older page. */
  loadOlder?: () => void
  /** Load-all handle for the multi-select "select all" action. */
  selectAllPagination?: MessageListSelectAllPagination
  onOpenCitationsPanel?: MessageListActions['openCitationsPanel']
  isAgentToolFlowActive?: MessageListActions['isAgentToolFlowActive']
  openAgentToolFlow?: MessageListActions['openAgentToolFlow']
  openArtifactFile?: MessageListActions['openArtifactFile']
  openBrowserUrl?: MessageListActions['openBrowserUrl']
  openExternalUrl?: MessageListActions['openExternalUrl']
  openDiagnosticReport?: MessageListActions['openDiagnosticReport']
  previewInputFile?: MessageListActions['previewInputFile']
  getMessageSiblings?: MessageListState['getMessageSiblings']
  setActiveBranch?: MessageListActions['setActiveBranch']
  deleteMessage?: MessageListActions['deleteMessage']
  startEditing?: (messageId: string) => Promise<void>
  editBusy?: boolean
  respondToolApproval?: MessageListActions['respondToolApproval']
  navigateToForkSource?: NavigateToForkSource
  onLocalRestoreChecked?: (unavailable: boolean) => void
}

const AgentSessionMessages = ({
  agentId,
  sessionId,
  workspacePath,
  messages,
  historyActions,
  activeAgent,
  partsByMessageId,
  streamingLayers,
  optimisticAskUserQuestionInputsByToolCallId = {},
  isLoading,
  hasOlder = false,
  loadOlder,
  selectAllPagination,
  onOpenCitationsPanel,
  isAgentToolFlowActive,
  openAgentToolFlow,
  openArtifactFile,
  openBrowserUrl,
  openExternalUrl,
  openDiagnosticReport,
  previewInputFile,
  deleteMessage,
  getMessageSiblings,
  setActiveBranch,
  startEditing,
  editBusy,
  respondToolApproval,
  navigateToForkSource,
  onLocalRestoreChecked
}: Props) => {
  const { session } = useSession(sessionId)
  useEffect(() => {
    if (!onLocalRestoreChecked) return
    onLocalRestoreChecked(false)
    return ipcApi.on('ai.local_agents.session_updated', (event) => {
      if (event.sessionId !== sessionId || (!event.info && !event.restoreUnavailable)) return
      onLocalRestoreChecked(event.restoreUnavailable === true)
    })
  }, [sessionId, onLocalRestoreChecked])

  const sessionTopicId = useMemo(() => buildAgentSessionTopicId(sessionId), [sessionId])
  const streamTopicId = useAgentSessionStreamTopic(sessionId)
  const target = useMemo(() => ({ kind: 'topic' as const, topicId: streamTopicId }), [streamTopicId])
  const partReader = useMemo(() => messageProjectionService.partsFor(target), [target])
  const [messageNavigation] = usePreference('chat.message.navigation_mode')

  const sessionAssistantId = session?.agentId ?? agentId
  const sessionName = session?.name ?? sessionId
  const sessionCreatedAt = session?.createdAt ?? session?.updatedAt ?? FALLBACK_TIMESTAMP
  const sessionLastActivityAt = session?.lastActivityAt ?? sessionCreatedAt
  const sessionUpdatedAt = session?.updatedAt ?? session?.createdAt ?? FALLBACK_TIMESTAMP
  const assistantProfile = useMemo(
    () =>
      activeAgent
        ? {
            id: activeAgent.id,
            name: activeAgent.name,
            avatarIcon: activeAgent.localRuntime ? (
              <LocalAgentIcon presetId={activeAgent.localRuntime.presetId} size={30} />
            ) : undefined,
            avatar: getAgentAvatarFromConfiguration(activeAgent.configuration, activeAgent.avatarSrc)
          }
        : undefined,
    [activeAgent]
  )
  const backgroundTaskAnchorMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.role !== 'assistant') continue
      const parts = messagePartsAt(partsByMessageId, message.id) ?? message.parts ?? []
      if (parts.length > 0 || message.metadata?.status === 'pending') return message.id
    }
    return undefined
  }, [messages, partsByMessageId])
  const messageTail = useMemo(
    () =>
      backgroundTaskAnchorMessageId
        ? {
            messageId: backgroundTaskAnchorMessageId,
            content: <AgentSessionBackgroundTasks sessionId={sessionId} />
          }
        : undefined,
    [backgroundTaskAnchorMessageId, sessionId]
  )

  const derivedTopic = useMemo<Topic>(
    () => ({
      id: sessionTopicId,
      type: TopicType.Session,
      assistantId: sessionAssistantId,
      name: sessionName,
      lastActivityAt: sessionLastActivityAt,
      createdAt: sessionCreatedAt,
      updatedAt: sessionUpdatedAt,
      messages: []
    }),
    [sessionTopicId, sessionAssistantId, sessionName, sessionLastActivityAt, sessionCreatedAt, sessionUpdatedAt]
  )
  const diagnosticReport = useMemo(() => ({ location: 'agent' }), [])

  const messageIds = useStableStringArray(messages.map((message) => message.id))
  const afterMessages = useMemo(
    () => <AgentPendingAttachments key={sessionId} sessionId={sessionId} messageIds={messageIds} />,
    [messageIds, sessionId]
  )
  const messageList = useAgentMessageListProviderValue({
    topic: derivedTopic,
    projectionTarget: target,
    messages,
    historyActions,
    partsByMessageId,
    streamingLayers,
    assistantProfile,
    assistantId: agentId,
    supportsNativeFork: !!activeAgent && activeAgent.type !== 'local',
    providerErrorSettingsPath:
      activeAgent?.type === 'local'
        ? `/settings/local-agents?id=${encodeURIComponent(activeAgent.localRuntime?.presetId ?? activeAgent.id)}`
        : undefined,
    isLoading,
    hasOlder,
    loadOlder,
    selectAllPagination,
    openCitationsPanel: onOpenCitationsPanel,
    isAgentToolFlowActive,
    openAgentToolFlow,
    openArtifactFile,
    openBrowserUrl,
    openExternalUrl,
    openDiagnosticReport,
    diagnosticReport,
    previewInputFile,
    getMessageSiblings,
    setActiveBranch,
    deleteMessage,
    startEditing,
    editBusy,
    respondToolApproval,
    navigateToForkSource,
    scrollToBottomOnSend: true,
    messageNavigation,
    workspacePath: workspacePath ?? session?.workspace?.path,
    messageTail,
    afterMessages
  })

  return (
    <AskUserQuestionOptimisticInputProvider value={optimisticAskUserQuestionInputsByToolCallId}>
      <ProjectionReaderProvider reader={partReader}>
        <MessageListProvider value={messageList} taskRows={partsByMessageId} taskTarget={target}>
          <MessageList enableSearch />
        </MessageListProvider>
      </ProjectionReaderProvider>
    </AskUserQuestionOptimisticInputProvider>
  )
}

const FALLBACK_TIMESTAMP = '1970-01-01T00:00:00.000Z'

export default memo(AgentSessionMessages)
