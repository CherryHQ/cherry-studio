import { Button } from '@cherrystudio/ui'
import { useCache } from '@renderer/data/hooks/useCache'
import { useAgents } from '@renderer/hooks/agents/useAgentDataApi'
import {
  type AgentSessionStreamState,
  useAgentSessionStreamStatuses
} from '@renderer/hooks/agents/useAgentSessionStreamStatuses'
import { useSessions } from '@renderer/hooks/agents/useSessionDataApi'
import { useAssistants } from '@renderer/hooks/useAssistant'
import { usePins } from '@renderer/hooks/usePins'
import { mapApiTopicToRendererTopic, useAllTopics } from '@renderer/hooks/useTopicDataApi'
import type { Topic as RendererTopic } from '@renderer/types'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'
import { Bot, History, Wrench, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
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

export type HistoryPageV2Mode = 'assistant' | 'agent'

const ALL_SOURCE_ID = 'all'
const DEFAULT_ASSISTANT_SOURCE_ID = '__default_assistant__'
const UNKNOWN_AGENT_SOURCE_ID = '__unknown_agent__'
const EMPTY_ASSISTANT_BY_ID: ReadonlyMap<string, Assistant> = new Map()
const EMPTY_AGENT_BY_ID: ReadonlyMap<string, AgentEntity> = new Map()
const HISTORY_OVERLAY_OPEN_RADIUS = 12
const HISTORY_OVERLAY_RADIUS_PADDING = 24
const HISTORY_OVERLAY_TRANSITION = {
  duration: 0.28,
  ease: [0.22, 1, 0.36, 1]
} as const
type AgentHistorySessionStatus = Exclude<HistorySourceStatus, 'all'>

interface HistoryPageV2Props {
  mode: HistoryPageV2Mode
  open: boolean
  origin?: DOMRectReadOnly
  onClose: () => void
  onTopicSelect?: (topic: RendererTopic) => void
}

const HistoryPageV2 = ({ mode, open, origin, onClose, onTopicSelect }: HistoryPageV2Props) => {
  const prefersReducedMotion = useReducedMotion()
  const portalRootId = mode === 'assistant' ? 'home-page' : 'agent-page'
  const portalRoot = document.getElementById(portalRootId)
  const overlayMotion = useMemo(
    () => getHistoryOverlayMotion(portalRoot, origin, prefersReducedMotion === true),
    [origin, portalRoot, prefersReducedMotion]
  )

  if (!portalRoot) return null

  return createPortal(
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="history-page-v2"
          initial={overlayMotion.initial}
          animate={overlayMotion.animate}
          exit={overlayMotion.exit}
          transition={HISTORY_OVERLAY_TRANSITION}
          className="absolute inset-0 z-[1000] flex bg-background [-webkit-app-region:none]"
          data-testid="history-page-v2-motion"
          style={{ willChange: 'opacity, clip-path' }}>
          <HistoryPageV2Content mode={mode} onClose={onClose} onTopicSelect={onTopicSelect} />
        </motion.div>
      )}
    </AnimatePresence>,
    portalRoot
  )
}

interface HistoryPageV2ContentProps {
  mode: HistoryPageV2Mode
  onClose: () => void
  onTopicSelect?: (topic: RendererTopic) => void
}

const HistoryPageV2Content = ({ mode, onClose, onTopicSelect }: HistoryPageV2ContentProps) => {
  if (mode === 'assistant') {
    return <AssistantHistoryPageV2Content onClose={onClose} onTopicSelect={onTopicSelect} />
  }

  return <AgentHistoryPageV2Content onClose={onClose} />
}

interface HistoryPageV2ModeContentProps {
  onClose: () => void
  onTopicSelect?: (topic: RendererTopic) => void
}

const AssistantHistoryPageV2Content = ({ onClose, onTopicSelect }: HistoryPageV2ModeContentProps) => {
  const { t } = useTranslation()
  const [selectedSourceId, setSelectedSourceId] = useState(ALL_SOURCE_ID)
  const [searchText, setSearchText] = useState('')

  const { topics: rawTopics, isLoading: isTopicsLoading } = useAllTopics({ loadAll: true })
  const { assistants } = useAssistants()
  const { pinnedIds: topicPinnedIds } = usePins('topic')
  const topicPinnedIdSet = useMemo(() => new Set(topicPinnedIds), [topicPinnedIds])
  const isTopicPinned = useCallback((topicId: string) => topicPinnedIdSet.has(topicId), [topicPinnedIdSet])
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
      onTopicSelect?.(rendererTopicById.get(topic.id) ?? mapApiTopicToRendererTopic(topic))
      onClose()
    },
    [onClose, onTopicSelect, rendererTopicById]
  )

  return (
    <HistoryPageV2Layout
      mode="assistant"
      onClose={onClose}
      sources={assistantSources}
      selectedSourceId={selectedSourceId}
      subtitle={t('history.v2.assistantSubtitle', '{{count}} 个话题', { count: topics.length })}
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
        onTopicSelect={handleTopicSelect}
      />
    </HistoryPageV2Layout>
  )
}

const AgentHistoryPageV2Content = ({ onClose }: HistoryPageV2ModeContentProps) => {
  const { t } = useTranslation()
  const [selectedSourceId, setSelectedSourceId] = useState(ALL_SOURCE_ID)
  const [selectedStatus, setSelectedStatus] = useState<HistorySourceStatus>(ALL_SOURCE_ID)
  const [searchText, setSearchText] = useState('')
  const [, setActiveSessionId] = useCache('agent.active_session_id')

  const {
    sessions,
    pinIdBySessionId,
    isLoading: isSessionsLoading
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

  useEffect(() => {
    if (selectedSourceId === ALL_SOURCE_ID) return
    if (agentSources.some((source) => source.id === selectedSourceId)) return

    setSelectedSourceId(ALL_SOURCE_ID)
  }, [agentSources, selectedSourceId])

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId)
      onClose()
    },
    [onClose, setActiveSessionId]
  )

  return (
    <HistoryPageV2Layout
      mode="agent"
      onClose={onClose}
      sources={agentSources}
      selectedSourceId={selectedSourceId}
      selectedStatus={selectedStatus}
      statusItems={statusItems}
      subtitle={t('history.v2.agentSubtitle', '{{count}} 个会话', { count: sessions.length })}
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
        onSessionSelect={handleSessionSelect}
      />
    </HistoryPageV2Layout>
  )
}

interface HistoryPageV2LayoutProps {
  mode: HistoryPageV2Mode
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

const HistoryPageV2Layout = ({
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
}: HistoryPageV2LayoutProps) => {
  const { t } = useTranslation()
  const title =
    mode === 'assistant' ? t('history.v2.title', '话题历史记录') : t('history.v2.agentTitle', '智能体历史记录')

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground" aria-label={title}>
      <header className="flex h-[52px] shrink-0 items-center justify-between bg-background px-5 [border-bottom:0.5px_solid_var(--color-border-subtle)]">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-background text-foreground-secondary">
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

function getHistoryOverlayMotion(
  portalRoot: HTMLElement | null,
  origin: DOMRectReadOnly | undefined,
  prefersReducedMotion: boolean
) {
  if (!portalRoot || !origin || prefersReducedMotion) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 }
    }
  }

  const rootRect = portalRoot.getBoundingClientRect()
  const rootWidth = rootRect.width || window.innerWidth
  const rootHeight = rootRect.height || window.innerHeight
  const originX = origin.x - rootRect.left + origin.width / 2
  const originY = origin.y - rootRect.top + origin.height / 2
  const closedClipPath = `circle(${HISTORY_OVERLAY_OPEN_RADIUS}px at ${originX}px ${originY}px)`
  const openClipPath = `circle(${getHistoryOverlayRadius(rootWidth, rootHeight, originX, originY)}px at ${originX}px ${originY}px)`

  return {
    initial: { opacity: 0, clipPath: closedClipPath },
    animate: { opacity: 1, clipPath: openClipPath },
    exit: { opacity: 0, clipPath: closedClipPath }
  }
}

function getHistoryOverlayRadius(width: number, height: number, originX: number, originY: number) {
  return Math.ceil(
    Math.max(
      Math.hypot(originX, originY),
      Math.hypot(width - originX, originY),
      Math.hypot(originX, height - originY),
      Math.hypot(width - originX, height - originY)
    ) + HISTORY_OVERLAY_RADIUS_PADDING
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
      label: t('history.v2.status.running', '运行中'),
      count: counts.running,
      dotClassName: 'text-warning'
    },
    {
      id: 'completed',
      label: t('history.v2.status.completed', '已完成'),
      count: counts.completed,
      dotClassName: 'text-success'
    },
    {
      id: 'failed',
      label: t('history.v2.status.failed', '失败'),
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
      count: topics.length,
      icon: <Bot size={15} />
    },
    ...Array.from(counts.entries()).map(([sourceId, count]) => {
      const assistant = sourceId === DEFAULT_ASSISTANT_SOURCE_ID ? undefined : assistantById.get(sourceId)

      return {
        id: sourceId,
        label:
          sourceId === DEFAULT_ASSISTANT_SOURCE_ID
            ? defaultAssistantLabel
            : (assistant?.name ?? t('history.v2.sidebar.unknownAssistant', '未知助手')),
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
      count: sessions.length,
      icon: <Wrench size={15} />
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

export default HistoryPageV2
