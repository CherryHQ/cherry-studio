import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useCache } from '@renderer/data/hooks/useCache'
import { useMultiplePreferences } from '@renderer/data/hooks/usePreference'
import { useAgents } from '@renderer/hooks/agents/useAgent'
import { useAgentSessionStreamStatuses } from '@renderer/hooks/agents/useAgentSessionStreamStatuses'
import { useSessions, useUpdateSession } from '@renderer/hooks/agents/useSession'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { usePins } from '@renderer/hooks/usePins'
import { finishTopicRenaming, getTopicMessages, startTopicRenaming } from '@renderer/hooks/useTopic'
import { mapApiTopicToRendererTopic, useTopicMutations, useTopics } from '@renderer/hooks/useTopic'
import type { SessionActionContext } from '@renderer/pages/agents/components/sessionItemActions'
import {
  type SessionListItem,
  sortSessionsForDisplayGroups
} from '@renderer/pages/agents/components/sessionListHelpers'
import {
  createSessionActionContext,
  useSessionMenuPreset
} from '@renderer/pages/agents/components/useSessionMenuActions'
import type {
  TopicActionContext,
  TopicExportMenuOptions
} from '@renderer/pages/home/Tabs/components/topicContextMenuActions'
import { sortTopicsForDisplayGroups } from '@renderer/pages/home/Tabs/components/topicsHelpers'
import { createTopicActionContext, useTopicMenuPreset } from '@renderer/pages/home/Tabs/components/useTopicMenuActions'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic as RendererTopic } from '@renderer/types'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import { Bot, ChevronLeft } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import HistoryQueryForm, { type HistoryBulkMoveTarget } from './components/HistoryQueryForm'
import HistorySessionResultList from './components/HistorySessionResultList'
import HistorySourceSidebar, {
  type HistorySourceItem,
  type HistorySourceStatus,
  type HistoryStatusItem
} from './components/HistorySourceSidebar'
import HistoryTopicResultList from './components/HistoryTopicResultList'
import {
  ALL_SOURCE_ID,
  buildAgentSources,
  buildAgentStatusItems,
  buildAssistantSources,
  findAdjacentHistoryRecordAfterBulkDelete,
  getAgentHistoryStatus,
  getSessionAgentSourceId,
  getTopicSourceId
} from './historyRecordsHelpers'
import type { HistoryRecordsMode } from './historyRecordsTypes'

const logger = loggerService.withContext('HistoryRecordsPage')
type HistoryTopicItem = ApiTopic & {
  assistantId: string | undefined
  pinned: boolean
}

interface HistoryRecordsPageBaseProps {
  mode: HistoryRecordsMode
  open: boolean
  activeRecordId?: string | null
  onClose: () => void
}

type HistoryRecordsPageProps =
  | (HistoryRecordsPageBaseProps & {
      mode: 'assistant'
      onRecordSelect?: (topic: RendererTopic | null) => void
    })
  | (HistoryRecordsPageBaseProps & {
      mode: 'agent'
      onRecordSelect?: (sessionId: string | null) => void
    })

const HistoryRecordsPage = (props: HistoryRecordsPageProps) => {
  const { open } = props

  if (!open) return null

  return (
    <div className="absolute inset-0 z-40 flex bg-card [-webkit-app-region:none]" data-testid="history-records-page">
      {props.mode === 'assistant' ? (
        <AssistantHistoryRecordsContent
          activeRecordId={props.activeRecordId}
          onClose={props.onClose}
          onRecordSelect={props.onRecordSelect}
        />
      ) : (
        <AgentHistoryRecordsContent
          activeRecordId={props.activeRecordId}
          onClose={props.onClose}
          onRecordSelect={props.onRecordSelect}
        />
      )}
    </div>
  )
}

interface AssistantHistoryRecordsContentProps {
  activeRecordId?: string | null
  onClose: () => void
  onRecordSelect?: (topic: RendererTopic | null) => void
}

interface AgentHistoryRecordsContentProps {
  activeRecordId?: string | null
  onClose: () => void
  onRecordSelect?: (sessionId: string | null) => void
}

const AssistantHistoryRecordsContent = ({
  activeRecordId,
  onClose,
  onRecordSelect
}: AssistantHistoryRecordsContentProps) => {
  const { t } = useTranslation()
  const [selectedSourceId, setSelectedSourceId] = useState(ALL_SOURCE_ID)
  const [searchText, setSearchText] = useState('')
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([])
  const [groupNow] = useState(() => new Date())
  const conversationNav = useConversationNavigation('assistants')

  const { topics: rawTopics, isLoading: isTopicsLoading } = useTopics({ loadAll: true })
  const { assistants } = useAssistants()
  const [renamingTopics] = useCache('topic.renaming')
  const { notesPath } = useNotesSettings()
  const { updateTopic: patchTopic, deleteTopic: deleteTopicById, deleteTopics, batchUpdateTopics } = useTopicMutations()
  const [exportMenuOptions] = useMultiplePreferences({
    docx: 'data.export.menus.docx',
    image: 'data.export.menus.image',
    joplin: 'data.export.menus.joplin',
    markdown: 'data.export.menus.markdown',
    markdown_reason: 'data.export.menus.markdown_reason',
    notes: 'data.export.menus.notes',
    notion: 'data.export.menus.notion',
    obsidian: 'data.export.menus.obsidian',
    plain_text: 'data.export.menus.plain_text',
    siyuan: 'data.export.menus.siyuan',
    yuque: 'data.export.menus.yuque'
  })
  const { pinnedIds: topicPinnedIds, togglePin: toggleTopicPin } = usePins('topic')
  const topicPinnedIdSet = useMemo(() => new Set(topicPinnedIds), [topicPinnedIds])
  const isTopicPinned = useCallback((topicId: string) => topicPinnedIdSet.has(topicId), [topicPinnedIdSet])
  const renamingTopicIdSet = useMemo(
    () => new Set(Array.isArray(renamingTopics) ? renamingTopics : []),
    [renamingTopics]
  )
  const isTopicRenaming = useCallback((topicId: string) => renamingTopicIdSet.has(topicId), [renamingTopicIdSet])
  const topics = useMemo(
    (): HistoryTopicItem[] =>
      rawTopics.map((topic) => ({
        ...topic,
        assistantId: topic.assistantId,
        pinned: isTopicPinned(topic.id)
      })),
    [isTopicPinned, rawTopics]
  )
  const topicById = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics])
  const selectedDeletableTopicIds = useMemo(
    () => selectedTopicIds.filter((id) => topicById.get(id)?.pinned === false),
    [selectedTopicIds, topicById]
  )

  const assistantById = useMemo(() => new Map(assistants.map((assistant) => [assistant.id, assistant])), [assistants])
  const assistantRankById = useMemo(
    () => new Map(assistants.map((assistant, index) => [assistant.id, index])),
    [assistants]
  )
  const unlinkedAssistantLabel = t('history.records.sidebar.unknownAssistant')
  const timeSortedTopics = useMemo(
    () => sortTopicsForDisplayGroups(topics, { mode: 'time', now: groupNow }),
    [groupNow, topics]
  )
  const assistantSortedTopics = useMemo(
    () =>
      sortTopicsForDisplayGroups(topics, {
        assistantRankById,
        mode: 'assistant',
        now: groupNow
      }),
    [assistantRankById, groupNow, topics]
  )
  const rendererTopicById = useMemo(
    () =>
      new Map(
        topics.map((topic) => [
          topic.id,
          {
            ...mapApiTopicToRendererTopic(topic),
            pinned: isTopicPinned(topic.id)
          }
        ])
      ),
    [isTopicPinned, topics]
  )
  const getRendererTopic = useCallback(
    (topic: ApiTopic): RendererTopic =>
      rendererTopicById.get(topic.id) ?? {
        ...mapApiTopicToRendererTopic(topic),
        pinned: isTopicPinned(topic.id)
      },
    [isTopicPinned, rendererTopicById]
  )

  const assistantSources = useMemo(
    () => buildAssistantSources(topics, assistantById, assistantRankById, unlinkedAssistantLabel, t),
    [assistantById, assistantRankById, t, topics, unlinkedAssistantLabel]
  )
  const bulkMoveTargets = useMemo<HistoryBulkMoveTarget[]>(
    () =>
      assistants.map((assistant) => ({
        id: assistant.id,
        label: assistant.name || t('common.unnamed'),
        icon: assistant.emoji ? <span className="text-sm leading-none">{assistant.emoji}</span> : <Bot size={14} />
      })),
    [assistants, t]
  )

  const filteredTopics = useMemo(() => {
    const sortedTopics = selectedSourceId === ALL_SOURCE_ID ? timeSortedTopics : assistantSortedTopics
    if (selectedSourceId === ALL_SOURCE_ID) return sortedTopics

    return sortedTopics.filter((topic) => getTopicSourceId(topic, assistantById) === selectedSourceId)
  }, [assistantById, assistantSortedTopics, selectedSourceId, timeSortedTopics])

  const searchedTopics = useMemo(() => {
    const keywords = searchText.trim().toLowerCase()
    if (!keywords) return filteredTopics

    return filteredTopics.filter((topic) => {
      const topicName = topic.name || t('chat.default.topic.name')
      return topicName.toLowerCase().includes(keywords)
    })
  }, [filteredTopics, searchText, t])

  useEffect(() => {
    const visibleTopicIds = new Set(searchedTopics.filter((topic) => !topic.pinned).map((topic) => topic.id))
    setSelectedTopicIds((ids) => {
      const next = ids.filter((id) => visibleTopicIds.has(id))
      return next.length === ids.length ? ids : next
    })
  }, [searchedTopics])

  useEffect(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return
    if (assistantSources.some((source) => source.id === selectedSourceId)) return

    setSelectedSourceId(ALL_SOURCE_ID)
  }, [assistantSources, selectedSourceId])

  const handleTopicSelect = useCallback(
    (topic: ApiTopic) => {
      const title = topic.name || t('chat.default.topic.name')
      if (conversationNav.openConversationTab(topic.id, title, { forceNew: true })) return

      onRecordSelect?.(rendererTopicById.get(topic.id) ?? mapApiTopicToRendererTopic(topic))
      onClose()
    },
    [conversationNav, onClose, onRecordSelect, rendererTopicById, t]
  )

  const updateTopic = useCallback(
    (topic: RendererTopic) =>
      patchTopic(topic.id, {
        name: topic.name,
        isNameManuallyEdited: topic.isNameManuallyEdited
      }),
    [patchTopic]
  )

  const handlePinTopic = useCallback(
    async (topic: Pick<RendererTopic, 'id'>) => {
      const willPin = !isTopicPinned(topic.id)

      try {
        await toggleTopicPin(topic.id)
        if (willPin) {
          setSelectedTopicIds((ids) => ids.filter((id) => id !== topic.id))
        }
      } catch (err) {
        logger.error('Failed to toggle topic pin from history records', { topicId: topic.id, err })
      }
    },
    [isTopicPinned, toggleTopicPin]
  )

  const handleDeleteTopicFromMenu = useCallback(
    async (topic: RendererTopic) => {
      if (topic.pinned) return

      try {
        await deleteTopicById(topic.id)
      } catch (err) {
        logger.error('Failed to delete topic from history records', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        window.toast.error(message)
        return
      }

      if (topic.id === activeRecordId) {
        const nextTopic = findAdjacentHistoryRecordAfterBulkDelete(
          timeSortedTopics,
          [topic.id],
          topic.id,
          (candidate) => candidate.id
        )
        onRecordSelect?.(nextTopic ? getRendererTopic(nextTopic) : null)
      }
    },
    [activeRecordId, deleteTopicById, getRendererTopic, onRecordSelect, t, timeSortedTopics]
  )

  const handleBulkDeleteTopics = useCallback(async () => {
    const ids = selectedDeletableTopicIds
    if (ids.length === 0) return

    try {
      const result = await deleteTopics(ids)
      const deletedIdSet = new Set(result.deletedIds)
      setSelectedTopicIds((currentIds) => currentIds.filter((id) => !deletedIdSet.has(id)))

      if (activeRecordId && result.deletedIds.includes(activeRecordId)) {
        const nextTopic = findAdjacentHistoryRecordAfterBulkDelete(
          timeSortedTopics,
          result.deletedIds,
          activeRecordId,
          (candidate) => candidate.id
        )
        onRecordSelect?.(nextTopic ? getRendererTopic(nextTopic) : null)
      }
    } catch (err) {
      logger.error('Failed to bulk delete topics from history records', { ids, err })
      const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
      window.toast.error(message)
    }
  }, [activeRecordId, deleteTopics, getRendererTopic, onRecordSelect, selectedDeletableTopicIds, t, timeSortedTopics])

  const handleBulkMoveTopics = useCallback(
    async (targetAssistantId: string) => {
      const ids = selectedTopicIds.filter((id) => topics.some((topic) => topic.id === id))
      if (ids.length === 0) return

      try {
        const results = await batchUpdateTopics(ids.map((id) => ({ id, dto: { assistantId: targetAssistantId } })))
        const movedIds = ids.filter((_, index) => results[index]?.status === 'fulfilled')
        const failedResults = results.filter((result) => result.status === 'rejected')
        const movedIdSet = new Set(movedIds)

        if (movedIds.length > 0) {
          setSelectedTopicIds((current) => current.filter((id) => !movedIdSet.has(id)))
        }

        if (failedResults.length === 0) {
          setSelectedTopicIds([])
          window.toast.success(t('history.records.bulkMoveTopics.success', { count: ids.length }))
          return
        }

        logger.error('Failed to bulk move topics from history records', { ids, targetAssistantId, failedResults })
        if (movedIds.length > 0) {
          window.toast.warning(
            t('history.records.bulkMoveTopics.partialSuccess', {
              failed: failedResults.length,
              moved: movedIds.length,
              total: ids.length
            })
          )
          return
        }

        const firstReason = failedResults[0]?.reason
        const message = firstReason instanceof Error ? firstReason.message : t('history.records.bulkMoveTopics.error')
        window.toast.error(message)
      } catch (err) {
        logger.error('Failed to bulk move topics from history records', { ids, targetAssistantId, err })
        const message = err instanceof Error ? err.message : t('history.records.bulkMoveTopics.error')
        window.toast.error(message)
      }
    },
    [batchUpdateTopics, selectedTopicIds, t, topics]
  )

  const handleClearMessages = useCallback((topic: RendererTopic) => {
    void EventEmitter.emit(EVENT_NAMES.CLEAR_MESSAGES, topic)
  }, [])

  const handleAutoRename = useCallback(
    async (topic: RendererTopic) => {
      const messages = await getTopicMessages(topic.id)
      if (messages.length < 2) return

      startTopicRenaming(topic.id)
      try {
        const { text: summaryText, error: summaryError } = await fetchMessagesSummary({ messages })
        if (summaryText) {
          void updateTopic({ ...topic, name: summaryText, isNameManuallyEdited: false })
        } else if (summaryError) {
          window.toast?.error(`${t('message.error.fetchTopicName')}: ${summaryError}`)
        }
      } finally {
        finishTopicRenaming(topic.id)
      }
    },
    [t, updateTopic]
  )

  const handleRenameTopic = useCallback(
    async (topicId: string, name: string) => {
      const topic = rendererTopicById.get(topicId)
      const trimmedName = name.trim()
      if (!topic || !trimmedName || trimmedName === topic.name) return

      try {
        await updateTopic({ ...topic, name: trimmedName, isNameManuallyEdited: true })
        window.toast.success(t('common.saved'))
      } catch (err) {
        logger.error('Failed to rename topic from history records', { topicId, err })
        const message = err instanceof Error ? err.message : t('common.save_failed')
        window.toast.error(message)
      }
    },
    [rendererTopicById, t, updateTopic]
  )
  const getTopicActionContext = useCallback(
    (apiTopic: ApiTopic): TopicActionContext => {
      const topic = getRendererTopic(apiTopic)

      return createTopicActionContext({
        exportMenuOptions: exportMenuOptions as TopicExportMenuOptions,
        isActiveInCurrentTab: false,
        isRenaming: isTopicRenaming(topic.id),
        onAutoRename: handleAutoRename,
        onClearMessages: handleClearMessages,
        onDelete: handleDeleteTopicFromMenu,
        onPinTopic: handlePinTopic,
        onStartRename: () => undefined,
        notesPath,
        t,
        topic,
        topicsLength: topics.length
      })
    },
    [
      exportMenuOptions,
      getRendererTopic,
      handleAutoRename,
      handleClearMessages,
      handleDeleteTopicFromMenu,
      handlePinTopic,
      isTopicRenaming,
      notesPath,
      t,
      topics.length
    ]
  )

  const topicMenuPreset = useTopicMenuPreset<ApiTopic>({ getActionContext: getTopicActionContext })

  return (
    <HistoryRecordsLayout
      mode="assistant"
      onClose={onClose}
      sources={assistantSources}
      selectedSourceId={selectedSourceId}
      subtitle={t('history.records.assistantSubtitle', { count: topics.length })}
      resultCount={searchedTopics.length}
      searchText={searchText}
      bulkDeleteCount={selectedDeletableTopicIds.length}
      selectedCount={selectedTopicIds.length}
      bulkMoveTargets={bulkMoveTargets}
      onBulkDelete={handleBulkDeleteTopics}
      onBulkMove={handleBulkMoveTopics}
      onSearchTextChange={setSearchText}
      onSourceSelect={setSelectedSourceId}>
      <HistoryTopicResultList
        topics={searchedTopics}
        assistantById={assistantById}
        unlinkedAssistantLabel={unlinkedAssistantLabel}
        isLoading={isTopicsLoading}
        isTopicPinned={isTopicPinned}
        selectedTopicIds={selectedTopicIds}
        onToggleTopicPin={handlePinTopic}
        onSelectedTopicIdsChange={setSelectedTopicIds}
        topicMenuPreset={topicMenuPreset}
        onTopicRename={handleRenameTopic}
        onTopicSelect={handleTopicSelect}
      />
    </HistoryRecordsLayout>
  )
}

const AgentHistoryRecordsContent = ({ activeRecordId, onClose, onRecordSelect }: AgentHistoryRecordsContentProps) => {
  const { t } = useTranslation()
  const [selectedSourceId, setSelectedSourceId] = useState(ALL_SOURCE_ID)
  const [selectedStatus, setSelectedStatus] = useState<HistorySourceStatus>(ALL_SOURCE_ID)
  const [searchText, setSearchText] = useState('')
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([])
  const [groupNow] = useState(() => new Date())
  const conversationNav = useConversationNavigation('agents')

  const {
    sessions,
    pinIdBySessionId,
    isLoading: isSessionsLoading,
    deleteSession,
    deleteSessions,
    togglePin
  } = useSessions(undefined, {
    loadAll: true,
    pageSize: 50
  })
  const { agents } = useAgents()
  const isSessionPinned = useCallback((sessionId: string) => pinIdBySessionId.has(sessionId), [pinIdBySessionId])
  const sessionItems = useMemo<SessionListItem[]>(
    () => sessions.map((session) => ({ ...session, pinned: isSessionPinned(session.id) })),
    [isSessionPinned, sessions]
  )
  const sessionById = useMemo(() => new Map(sessionItems.map((session) => [session.id, session])), [sessionItems])
  const selectedDeletableSessionIds = useMemo(
    () => selectedSessionIds.filter((id) => sessionById.get(id)?.pinned === false),
    [selectedSessionIds, sessionById]
  )
  const timeSortedSessions = useMemo(
    () => sortSessionsForDisplayGroups(sessionItems, { mode: 'time', now: groupNow }),
    [groupNow, sessionItems]
  )
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const agentRankById = useMemo(() => new Map(agents.map((agent, index) => [agent.id, index])), [agents])
  const agentSortedSessions = useMemo(
    () =>
      sortSessionsForDisplayGroups(sessionItems, {
        agentRankById,
        mode: 'agent',
        now: groupNow
      }),
    [agentRankById, groupNow, sessionItems]
  )
  const sessionIds = useMemo(() => sessionItems.map((session) => session.id), [sessionItems])
  const streamStatusBySessionId = useAgentSessionStreamStatuses(sessionIds)

  const unknownAgentLabel = t('agent.session.group.unknown_agent')
  const statusItems = useMemo(
    () => buildAgentStatusItems(sessions, streamStatusBySessionId, t),
    [sessions, streamStatusBySessionId, t]
  )
  const agentSources = useMemo(
    () => buildAgentSources(sessionItems, agentById, agentRankById, unknownAgentLabel, t),
    [agentById, agentRankById, sessionItems, t, unknownAgentLabel]
  )

  const statusFilteredSessions = useMemo(() => {
    const sortedSessions = selectedSourceId === ALL_SOURCE_ID ? timeSortedSessions : agentSortedSessions
    if (selectedStatus === ALL_SOURCE_ID) return sortedSessions

    return sortedSessions.filter(
      (session) => getAgentHistoryStatus(streamStatusBySessionId.get(session.id)) === selectedStatus
    )
  }, [agentSortedSessions, selectedSourceId, selectedStatus, streamStatusBySessionId, timeSortedSessions])

  const filteredSessions = useMemo(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return statusFilteredSessions

    return statusFilteredSessions.filter((session) => getSessionAgentSourceId(session, agentById) === selectedSourceId)
  }, [agentById, selectedSourceId, statusFilteredSessions])

  const searchedSessions = useMemo(() => {
    const keywords = searchText.trim().toLowerCase()
    if (!keywords) return filteredSessions

    return filteredSessions.filter((session) => {
      const agent = session.agentId ? agentById.get(session.agentId) : undefined
      const searchFields = [session.name, session.description, agent?.name]

      return searchFields.some((value) => value?.toLowerCase().includes(keywords))
    })
  }, [agentById, filteredSessions, searchText])
  const { updateSession } = useUpdateSession()

  useEffect(() => {
    const visibleSessionIds = new Set(
      searchedSessions.filter((session) => !session.pinned).map((session) => session.id)
    )
    setSelectedSessionIds((ids) => {
      const next = ids.filter((id) => visibleSessionIds.has(id))
      return next.length === ids.length ? ids : next
    })
  }, [searchedSessions])

  useEffect(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return
    if (agentSources.some((source) => source.id === selectedSourceId)) return

    setSelectedSourceId(ALL_SOURCE_ID)
  }, [agentSources, selectedSourceId])

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      const session = sessions.find((candidate) => candidate.id === sessionId)
      const title = session?.name || t('common.unnamed')
      if (conversationNav.openConversationTab(sessionId, title, { forceNew: true })) return

      onRecordSelect?.(sessionId)
      onClose()
    },
    [conversationNav, onClose, onRecordSelect, sessions, t]
  )

  const handleDeleteSession = useCallback(
    async (id: string) => {
      if (isSessionPinned(id)) return

      const success = await deleteSession(id)
      if (success && activeRecordId === id) {
        const nextSession = findAdjacentHistoryRecordAfterBulkDelete(
          timeSortedSessions,
          [id],
          id,
          (session) => session.id
        )
        onRecordSelect?.(nextSession?.id ?? null)
      }
    },
    [activeRecordId, deleteSession, isSessionPinned, onRecordSelect, timeSortedSessions]
  )

  const handleBulkDeleteSessions = useCallback(async () => {
    const ids = selectedDeletableSessionIds
    if (ids.length === 0) return

    const result = await deleteSessions(ids)
    if (!result) return

    const deletedIdSet = new Set(result.deletedIds)
    setSelectedSessionIds((currentIds) => currentIds.filter((id) => !deletedIdSet.has(id)))

    if (activeRecordId && result.deletedIds.includes(activeRecordId)) {
      const nextSession = findAdjacentHistoryRecordAfterBulkDelete(
        timeSortedSessions,
        result.deletedIds,
        activeRecordId,
        (session) => session.id
      )
      onRecordSelect?.(nextSession?.id ?? null)
    }
  }, [activeRecordId, deleteSessions, onRecordSelect, selectedDeletableSessionIds, timeSortedSessions])

  const handleRenameSession = useCallback(
    async (id: string, name: string) => {
      const session = sessions.find((candidate) => candidate.id === id)
      const trimmedName = name.trim()
      if (!session || !trimmedName || trimmedName === session.name) return

      const updatedSession = await updateSession({ id, name: trimmedName }, { showSuccessToast: false })
      if (updatedSession) {
        window.toast.success(t('common.saved'))
      }
    },
    [sessions, t, updateSession]
  )
  const handleToggleSessionPin = useCallback(
    async (sessionId: string) => {
      const willPin = !isSessionPinned(sessionId)

      const didToggle = await togglePin(sessionId)
      if (didToggle !== false && willPin) {
        setSelectedSessionIds((ids) => ids.filter((id) => id !== sessionId))
      }
    },
    [isSessionPinned, togglePin]
  )
  const getSessionActionContext = useCallback(
    (session: AgentSessionEntity): SessionActionContext =>
      createSessionActionContext({
        isActiveInCurrentTab: false,
        onDelete: () => {
          void handleDeleteSession(session.id)
        },
        onTogglePin: () => {
          void handleToggleSessionPin(session.id)
        },
        pinned: isSessionPinned(session.id),
        sessionName: session.name ?? session.id,
        startEdit: () => undefined,
        t
      }),
    [handleDeleteSession, handleToggleSessionPin, isSessionPinned, t]
  )

  const sessionMenuPreset = useSessionMenuPreset<AgentSessionEntity>({ getActionContext: getSessionActionContext })

  return (
    <HistoryRecordsLayout
      mode="agent"
      onClose={onClose}
      sources={agentSources}
      selectedSourceId={selectedSourceId}
      selectedStatus={selectedStatus}
      statusItems={statusItems}
      subtitle={t('history.records.agentSubtitle', { count: sessions.length })}
      resultCount={searchedSessions.length}
      searchText={searchText}
      bulkDeleteCount={selectedDeletableSessionIds.length}
      selectedCount={selectedSessionIds.length}
      onBulkDelete={handleBulkDeleteSessions}
      onSearchTextChange={setSearchText}
      onSourceSelect={setSelectedSourceId}
      onStatusSelect={setSelectedStatus}>
      <HistorySessionResultList
        sessions={searchedSessions}
        agentById={agentById}
        isLoading={isSessionsLoading}
        isSessionPinned={isSessionPinned}
        selectedSessionIds={selectedSessionIds}
        onToggleSessionPin={handleToggleSessionPin}
        onSelectedSessionIdsChange={setSelectedSessionIds}
        sessionMenuPreset={sessionMenuPreset}
        onSessionRename={handleRenameSession}
        onSessionSelect={handleSessionSelect}
      />
    </HistoryRecordsLayout>
  )
}

interface HistoryRecordsLayoutProps {
  mode: HistoryRecordsMode
  onClose: () => void
  sources: HistorySourceItem[]
  selectedSourceId: string
  selectedStatus?: HistorySourceStatus
  selectedCount?: number
  statusItems?: HistoryStatusItem[]
  subtitle: string
  resultCount: number
  searchText: string
  bulkDeleteCount?: number
  bulkMoveTargets?: readonly HistoryBulkMoveTarget[]
  children: ReactNode
  onBulkDelete?: () => void | Promise<void>
  onBulkMove?: (targetId: string) => void | Promise<void>
  onSearchTextChange: (value: string) => void
  onSourceSelect: (sourceId: string) => void
  onStatusSelect?: (status: HistorySourceStatus) => void
}

const HistoryRecordsLayout = ({
  mode,
  onClose,
  sources,
  selectedSourceId,
  selectedStatus,
  selectedCount = 0,
  statusItems,
  subtitle,
  resultCount,
  searchText,
  bulkDeleteCount,
  bulkMoveTargets,
  children,
  onBulkDelete,
  onBulkMove,
  onSearchTextChange,
  onSourceSelect,
  onStatusSelect
}: HistoryRecordsLayoutProps) => {
  const { t } = useTranslation()
  const title = t('history.records.shortTitle')

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card pb-3 text-foreground" aria-label={title}>
      <header className="flex h-[52px] shrink-0 items-center bg-card px-4 [border-bottom:0.5px_solid_var(--color-border-subtle)]">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 min-h-7 shrink-0 rounded-md text-foreground-muted shadow-none hover:bg-accent hover:text-foreground"
            aria-label={t('common.back')}
            onClick={onClose}>
            <ChevronLeft className="size-4" />
          </Button>
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="truncate font-semibold text-base text-foreground leading-5">{title}</h2>
            <span className="truncate text-foreground-muted text-xs leading-4">{subtitle}</span>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <HistorySourceSidebar
          mode={mode}
          sources={sources}
          selectedSourceId={selectedSourceId}
          selectedStatus={selectedStatus}
          statusItems={statusItems}
          onSourceSelect={onSourceSelect}
          onStatusSelect={onStatusSelect}
        />

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <HistoryQueryForm
            mode={mode}
            bulkDeleteCount={bulkDeleteCount}
            bulkMoveTargets={bulkMoveTargets}
            resultCount={resultCount}
            searchText={searchText}
            selectedCount={selectedCount}
            onBulkDelete={onBulkDelete}
            onBulkMove={onBulkMove}
            onSearchTextChange={onSearchTextChange}
          />
          {children}
        </main>
      </div>
    </section>
  )
}

export default HistoryRecordsPage
