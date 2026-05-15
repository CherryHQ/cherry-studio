import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useCache } from '@renderer/data/hooks/useCache'
import { useMultiplePreferences } from '@renderer/data/hooks/usePreference'
import { useAgents } from '@renderer/hooks/agents/useAgentDataApi'
import {
  type AgentSessionStreamState,
  useAgentSessionStreamStatuses
} from '@renderer/hooks/agents/useAgentSessionStreamStatuses'
import { useSessions, useUpdateSession } from '@renderer/hooks/agents/useSessionDataApi'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { useNotesSettings } from '@renderer/hooks/useNotesSettings'
import { usePins } from '@renderer/hooks/usePins'
import { finishTopicRenaming, getTopicMessages, startTopicRenaming } from '@renderer/hooks/useTopic'
import { mapApiTopicToRendererTopic, useAllTopics, useTopicMutations } from '@renderer/hooks/useTopicDataApi'
import type { SessionActionContext } from '@renderer/pages/agents/components/sessionItemActions'
import {
  createSessionActionContext,
  useSessionMenuPreset
} from '@renderer/pages/agents/components/useSessionMenuActions'
import type {
  TopicActionContext,
  TopicExportMenuOptions
} from '@renderer/pages/home/Tabs/components/topicContextMenuActions'
import { createTopicActionContext, useTopicMenuPreset } from '@renderer/pages/home/Tabs/components/useTopicMenuActions'
import { fetchMessagesSummary } from '@renderer/services/ApiService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Topic as RendererTopic } from '@renderer/types'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'
import { Bot, History, Wrench, X } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import HistoryQueryForm from './components/HistoryQueryForm'
import HistoryResultList from './components/HistoryResultList'
import HistorySourceSidebar, {
  type HistorySourceItem,
  type HistorySourceStatus,
  type HistoryStatusItem
} from './components/HistorySourceSidebar'

export type HistoryRecordsMode = 'assistant' | 'agent'

const ALL_SOURCE_ID = 'all'
const DEFAULT_ASSISTANT_SOURCE_ID = '__default_assistant__'
const UNKNOWN_AGENT_SOURCE_ID = '__unknown_agent__'
const EMPTY_ASSISTANT_BY_ID: ReadonlyMap<string, Assistant> = new Map()
const EMPTY_AGENT_BY_ID: ReadonlyMap<string, AgentEntity> = new Map()
const logger = loggerService.withContext('HistoryRecordsPage')
type AgentHistorySessionStatus = Exclude<HistorySourceStatus, 'all'>

interface HistoryRecordsPageBaseProps {
  mode: HistoryRecordsMode
  open: boolean
  activeRecordId?: string | null
  origin?: DOMRectReadOnly
  onClose: () => void
}

type HistoryRecordsPageProps =
  | (HistoryRecordsPageBaseProps & {
      mode: 'assistant'
      onRecordSelect?: (topic: RendererTopic) => void
    })
  | (HistoryRecordsPageBaseProps & {
      mode: 'agent'
      onRecordSelect?: (sessionId: string | null) => void
    })

const HistoryRecordsPage = (props: HistoryRecordsPageProps) => {
  const { mode, open } = props
  const portalRootId = mode === 'assistant' ? 'home-page' : 'agent-page'
  const portalRoot = document.getElementById(portalRootId)

  if (!portalRoot || !open) return null

  return createPortal(
    <div className="absolute inset-0 z-40 flex bg-card [-webkit-app-region:none]" data-testid="history-records-page">
      {props.mode === 'assistant' ? (
        <HistoryRecordsContent
          mode="assistant"
          activeRecordId={props.activeRecordId}
          onClose={props.onClose}
          onRecordSelect={props.onRecordSelect}
        />
      ) : (
        <HistoryRecordsContent
          mode="agent"
          activeRecordId={props.activeRecordId}
          onClose={props.onClose}
          onRecordSelect={props.onRecordSelect}
        />
      )}
    </div>,
    portalRoot
  )
}

type HistoryRecordsContentProps =
  | {
      mode: 'assistant'
      activeRecordId?: string | null
      onClose: () => void
      onRecordSelect?: (topic: RendererTopic) => void
    }
  | {
      mode: 'agent'
      activeRecordId?: string | null
      onClose: () => void
      onRecordSelect?: (sessionId: string | null) => void
    }

const HistoryRecordsContent = (props: HistoryRecordsContentProps) => {
  if (props.mode === 'assistant') {
    return (
      <AssistantHistoryRecordsContent
        activeRecordId={props.activeRecordId}
        onClose={props.onClose}
        onRecordSelect={props.onRecordSelect}
      />
    )
  }

  return (
    <AgentHistoryRecordsContent
      activeRecordId={props.activeRecordId}
      onClose={props.onClose}
      onRecordSelect={props.onRecordSelect}
    />
  )
}

interface AssistantHistoryRecordsContentProps {
  activeRecordId?: string | null
  onClose: () => void
  onRecordSelect?: (topic: RendererTopic) => void
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

  const { topics: rawTopics, isLoading: isTopicsLoading } = useAllTopics({ loadAll: true })
  const { assistants } = useAssistants()
  const [renamingTopics] = useCache('topic.renaming')
  const { notesPath } = useNotesSettings()
  const { updateTopic: patchTopic, deleteTopic: deleteTopicById } = useTopicMutations()
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
    () =>
      sortHistoryEntries(
        rawTopics,
        (topic) => isTopicPinned(topic.id),
        (topic) => topic.updatedAt
      ),
    [isTopicPinned, rawTopics]
  )

  const assistantById = useMemo(() => new Map(assistants.map((assistant) => [assistant.id, assistant])), [assistants])
  const defaultAssistantLabel = t('chat.default.name', '默认助手')
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
    (topic: Topic): RendererTopic =>
      rendererTopicById.get(topic.id) ?? {
        ...mapApiTopicToRendererTopic(topic),
        pinned: isTopicPinned(topic.id)
      },
    [isTopicPinned, rendererTopicById]
  )

  const assistantSources = useMemo(
    () => buildAssistantSources(topics, assistantById, defaultAssistantLabel, t),
    [assistantById, defaultAssistantLabel, t, topics]
  )

  const filteredTopics = useMemo(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return topics

    return topics.filter((topic) => getTopicSourceId(topic) === selectedSourceId)
  }, [selectedSourceId, topics])

  const searchedTopics = useMemo(() => {
    const keywords = searchText.trim().toLowerCase()
    if (!keywords) return filteredTopics

    return filteredTopics.filter((topic) => {
      const topicName = topic.name || t('chat.default.topic.name', '新话题')
      return topicName.toLowerCase().includes(keywords)
    })
  }, [filteredTopics, searchText, t])

  useEffect(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return
    if (assistantSources.some((source) => source.id === selectedSourceId)) return

    setSelectedSourceId(ALL_SOURCE_ID)
  }, [assistantSources, selectedSourceId])

  const handleTopicSelect = useCallback(
    (topic: Topic) => {
      onRecordSelect?.(rendererTopicById.get(topic.id) ?? mapApiTopicToRendererTopic(topic))
      onClose()
    },
    [onClose, onRecordSelect, rendererTopicById]
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
    async (topic: RendererTopic) => {
      try {
        await toggleTopicPin(topic.id)
      } catch (err) {
        logger.error('Failed to toggle topic pin from history records', { topicId: topic.id, err })
      }
    },
    [toggleTopicPin]
  )

  const handleDeleteTopicFromMenu = useCallback(
    async (topic: RendererTopic) => {
      try {
        await deleteTopicById(topic.id)
      } catch (err) {
        logger.error('Failed to delete topic from history records', { topicId: topic.id, err })
        const message = err instanceof Error ? err.message : t('chat.topics.manage.delete.error')
        window.toast.error(message)
        return
      }

      if (topic.id === activeRecordId && topics.length > 1) {
        const nextTopic = findAdjacentHistoryRecord(topics, topic.id, (candidate) => candidate.id)
        if (nextTopic) {
          onRecordSelect?.(getRendererTopic(nextTopic))
        }
      }
    },
    [activeRecordId, deleteTopicById, getRendererTopic, onRecordSelect, t, topics]
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
    (topicId: string, name: string) => {
      const topic = rendererTopicById.get(topicId)
      const trimmedName = name.trim()
      if (!topic || !trimmedName || trimmedName === topic.name) return

      void updateTopic({ ...topic, name: trimmedName, isNameManuallyEdited: true })
      window.toast.success(t('common.saved'))
    },
    [rendererTopicById, t, updateTopic]
  )

  const getTopicActionContext = useCallback(
    (apiTopic: Topic): TopicActionContext => {
      const topic = getRendererTopic(apiTopic)

      return createTopicActionContext({
        exportMenuOptions: exportMenuOptions as TopicExportMenuOptions,
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

  const topicMenuPreset = useTopicMenuPreset<Topic>({ getActionContext: getTopicActionContext })

  return (
    <HistoryRecordsLayout
      mode="assistant"
      onClose={onClose}
      sources={assistantSources}
      selectedSourceId={selectedSourceId}
      subtitle={t('history.records.assistantSubtitle', '{{count}} 个话题', { count: topics.length })}
      resultCount={searchedTopics.length}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      onSourceSelect={setSelectedSourceId}>
      <HistoryResultList
        mode="assistant"
        topics={searchedTopics}
        sessions={[]}
        assistantById={assistantById}
        agentById={EMPTY_AGENT_BY_ID}
        defaultAssistantLabel={defaultAssistantLabel}
        unknownAgentLabel=""
        isLoading={isTopicsLoading}
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

  const {
    sessions,
    pinIdBySessionId,
    isLoading: isSessionsLoading,
    deleteSession,
    togglePin
  } = useSessions(undefined, {
    loadAll: true,
    pageSize: 50
  })
  const { agents, isLoading: isAgentsLoading } = useAgents()
  const sortedSessions = useMemo(
    () =>
      sortHistoryEntries(
        sessions,
        (session) => pinIdBySessionId.has(session.id),
        (session) => session.updatedAt
      ),
    [pinIdBySessionId, sessions]
  )
  const sessionIds = useMemo(() => sortedSessions.map((session) => session.id), [sortedSessions])
  const streamStatusBySessionId = useAgentSessionStreamStatuses(sessionIds)

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const unknownAgentLabel = t('agent.session.group.unknown_agent', '未知智能体')
  const statusItems = useMemo(
    () => buildAgentStatusItems(sessions, streamStatusBySessionId, t),
    [sessions, streamStatusBySessionId, t]
  )
  const agentSources = useMemo(
    () => buildAgentSources(sessions, agents, agentById, unknownAgentLabel, t),
    [agentById, agents, sessions, t, unknownAgentLabel]
  )

  const statusFilteredSessions = useMemo(() => {
    if (selectedStatus === ALL_SOURCE_ID) return sortedSessions

    return sortedSessions.filter(
      (session) => getAgentHistoryStatus(streamStatusBySessionId.get(session.id)) === selectedStatus
    )
  }, [selectedStatus, sortedSessions, streamStatusBySessionId])

  const filteredSessions = useMemo(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return statusFilteredSessions

    return statusFilteredSessions.filter((session) => getSessionSourceId(session) === selectedSourceId)
  }, [selectedSourceId, statusFilteredSessions])

  const searchedSessions = useMemo(() => {
    const keywords = searchText.trim().toLowerCase()
    if (!keywords) return filteredSessions

    return filteredSessions.filter((session) => {
      const agent = session.agentId ? agentById.get(session.agentId) : undefined
      const searchFields = [session.name, session.description, agent?.name]

      return searchFields.some((value) => value?.toLowerCase().includes(keywords))
    })
  }, [agentById, filteredSessions, searchText])
  const sessionUpdateAgentId = useMemo(
    () =>
      searchedSessions.find((session) => session.agentId)?.agentId ??
      sessions.find((session) => session.agentId)?.agentId ??
      agents[0]?.id ??
      null,
    [agents, searchedSessions, sessions]
  )
  const { updateSession } = useUpdateSession(sessionUpdateAgentId)

  useEffect(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return
    if (agentSources.some((source) => source.id === selectedSourceId)) return

    setSelectedSourceId(ALL_SOURCE_ID)
  }, [agentSources, selectedSourceId])

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      onRecordSelect?.(sessionId)
      onClose()
    },
    [onClose, onRecordSelect]
  )

  const handleDeleteSession = useCallback(
    async (id: string) => {
      const success = await deleteSession(id)
      if (success && activeRecordId === id) {
        const nextSession = findAdjacentHistoryRecord(sortedSessions, id, (session) => session.id)
        onRecordSelect?.(nextSession?.id ?? null)
      }
    },
    [activeRecordId, deleteSession, onRecordSelect, sortedSessions]
  )

  const handleRenameSession = useCallback(
    async (id: string, name: string) => {
      const session = sessions.find((candidate) => candidate.id === id)
      const trimmedName = name.trim()
      if (!session || !trimmedName || trimmedName === session.name) return

      try {
        const updatedSession = await updateSession({ id, name: trimmedName }, { showSuccessToast: false })
        if (updatedSession) {
          window.toast.success(t('common.saved'))
        }
      } catch (err) {
        logger.error('Failed to rename session from history records', { err, sessionId: id })
        window.toast.error(t('agent.session.update.error.failed'))
      }
    },
    [sessions, t, updateSession]
  )

  const getSessionActionContext = useCallback(
    (session: AgentSessionEntity): SessionActionContext =>
      createSessionActionContext({
        onDelete: () => {
          void handleDeleteSession(session.id)
        },
        onTogglePin: () => {
          void togglePin(session.id)
        },
        pinned: pinIdBySessionId.has(session.id),
        sessionName: session.name ?? session.id,
        startEdit: () => undefined,
        t
      }),
    [handleDeleteSession, pinIdBySessionId, t, togglePin]
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
      subtitle={t('history.records.agentSubtitle', '{{count}} 个会话', { count: sessions.length })}
      resultCount={searchedSessions.length}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      onSourceSelect={setSelectedSourceId}
      onStatusSelect={setSelectedStatus}>
      <HistoryResultList
        mode="agent"
        topics={[]}
        sessions={searchedSessions}
        assistantById={EMPTY_ASSISTANT_BY_ID}
        agentById={agentById}
        defaultAssistantLabel=""
        unknownAgentLabel={unknownAgentLabel}
        isLoading={isSessionsLoading || isAgentsLoading}
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
  statusItems?: HistoryStatusItem[]
  subtitle: string
  resultCount: number
  searchText: string
  children: ReactNode
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
  statusItems,
  subtitle,
  resultCount,
  searchText,
  children,
  onSearchTextChange,
  onSourceSelect,
  onStatusSelect
}: HistoryRecordsLayoutProps) => {
  const { t } = useTranslation()
  const title =
    mode === 'assistant'
      ? t('history.records.title', '话题历史记录')
      : t('history.records.agentTitle', '智能体历史记录')

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card pb-3 text-foreground" aria-label={title}>
      <header className="flex h-[52px] shrink-0 items-center justify-between bg-card px-5 [border-bottom:0.5px_solid_var(--color-border-subtle)]">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-card text-foreground-secondary">
            <History size={16} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-base text-foreground leading-5">{title}</h2>
            <p className="mt-0.5 truncate text-foreground-muted text-xs leading-4">{subtitle}</p>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 min-h-7 rounded-md text-foreground-muted shadow-none hover:bg-accent hover:text-foreground"
          aria-label={t('common.close', '关闭')}
          onClick={onClose}>
          <X className="size-4" />
        </Button>
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
            resultCount={resultCount}
            searchText={searchText}
            onSearchTextChange={onSearchTextChange}
          />
          {children}
        </main>
      </div>
    </section>
  )
}

function getTopicSourceId(topic: Topic) {
  return topic.assistantId ?? DEFAULT_ASSISTANT_SOURCE_ID
}

function getSessionSourceId(session: AgentSessionEntity) {
  return session.agentId ?? UNKNOWN_AGENT_SOURCE_ID
}

function getAgentHistoryStatus(streamStatus?: AgentSessionStreamState): AgentHistorySessionStatus {
  if (streamStatus?.isPending === true) return 'running'
  if (streamStatus?.status === 'error') return 'failed'

  return 'completed'
}

function sortHistoryEntries<T>(
  items: readonly T[],
  isPinned: (item: T) => boolean,
  getUpdatedAt: (item: T) => string
): T[] {
  return [...items].sort((left, right) => {
    const pinnedDelta = Number(isPinned(right)) - Number(isPinned(left))
    if (pinnedDelta !== 0) return pinnedDelta

    return getHistoryTimestamp(getUpdatedAt(right)) - getHistoryTimestamp(getUpdatedAt(left))
  })
}

function findAdjacentHistoryRecord<T>(
  items: readonly T[],
  deletedId: string,
  getId: (item: T) => string
): T | undefined {
  const index = items.findIndex((item) => getId(item) === deletedId)
  if (index < 0) return undefined

  return items[index + 1 === items.length ? index - 1 : index + 1]
}

function getHistoryTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function buildAgentStatusItems(
  sessions: readonly AgentSessionEntity[],
  streamStatusBySessionId: ReadonlyMap<string, AgentSessionStreamState>,
  t: ReturnType<typeof useTranslation>['t']
): HistoryStatusItem[] {
  const counts: Record<AgentHistorySessionStatus, number> = {
    running: 0,
    completed: 0,
    failed: 0
  }

  for (const session of sessions) {
    counts[getAgentHistoryStatus(streamStatusBySessionId.get(session.id))] += 1
  }

  return [
    {
      id: ALL_SOURCE_ID,
      label: t('common.all', '全部'),
      count: sessions.length
    },
    {
      id: 'running',
      label: t('history.records.status.running', '运行中'),
      count: counts.running,
      dotClassName: 'text-warning'
    },
    {
      id: 'completed',
      label: t('history.records.status.completed', '已完成'),
      count: counts.completed,
      dotClassName: 'text-success'
    },
    {
      id: 'failed',
      label: t('history.records.status.failed', '失败'),
      count: counts.failed,
      dotClassName: 'text-destructive'
    }
  ]
}

function buildAssistantSources(
  topics: readonly Topic[],
  assistantById: ReadonlyMap<string, Assistant>,
  defaultAssistantLabel: string,
  t: ReturnType<typeof useTranslation>['t']
): HistorySourceItem[] {
  const counts = new Map<string, number>()

  for (const topic of topics) {
    const sourceId = getTopicSourceId(topic)
    counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1)
  }

  return [
    {
      id: ALL_SOURCE_ID,
      label: t('common.all', '全部'),
      count: topics.length
    },
    ...Array.from(counts.entries()).map(([sourceId, count]) => {
      const assistant = sourceId === DEFAULT_ASSISTANT_SOURCE_ID ? undefined : assistantById.get(sourceId)

      return {
        id: sourceId,
        label:
          sourceId === DEFAULT_ASSISTANT_SOURCE_ID
            ? defaultAssistantLabel
            : (assistant?.name ?? t('history.records.sidebar.unknownAssistant', '未知助手')),
        count,
        icon: assistant?.emoji ? <span className="text-sm leading-none">{assistant.emoji}</span> : <Bot size={15} />
      }
    })
  ]
}

function buildAgentSources(
  sessions: readonly AgentSessionEntity[],
  agents: readonly AgentEntity[],
  agentById: ReadonlyMap<string, AgentEntity>,
  unknownAgentLabel: string,
  t: ReturnType<typeof useTranslation>['t']
): HistorySourceItem[] {
  const counts = new Map<string, number>()

  for (const session of sessions) {
    const sourceId = getSessionSourceId(session)
    counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1)
  }

  return [
    {
      id: ALL_SOURCE_ID,
      label: t('common.all', '全部'),
      count: sessions.length
    },
    ...agents.map((agent) => {
      const avatar = agent.configuration?.avatar?.trim()

      return {
        id: agent.id,
        label: agent.name,
        count: counts.get(agent.id) ?? 0,
        icon: avatar ? <span className="text-sm leading-none">{avatar}</span> : <Wrench size={15} />
      }
    }),
    ...Array.from(counts.entries())
      .filter(([sourceId]) => sourceId === UNKNOWN_AGENT_SOURCE_ID || !agentById.has(sourceId))
      .map(([sourceId, count]) => ({
        id: sourceId,
        label: unknownAgentLabel,
        count,
        icon: <Wrench size={15} />
      }))
  ]
}

export default HistoryRecordsPage
