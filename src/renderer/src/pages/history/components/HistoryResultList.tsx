import { EmptyState } from '@cherrystudio/ui'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import type { HistoryPageV2Mode } from '@renderer/pages/history/HistoryPageV2'
import { cn } from '@renderer/utils'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'
import dayjs from 'dayjs'
import { Bot, MessageSquareText, Wrench } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const HISTORY_HEADER_GRID_CLASS =
  'grid min-w-[760px] grid-cols-[minmax(320px,1fr)_160px_72px_92px] gap-3 px-5 py-2.5 font-medium text-foreground-muted text-xs leading-4'
const HISTORY_ROW_GRID_CLASS =
  'grid w-full min-w-[736px] grid-cols-[minmax(320px,1fr)_160px_72px_92px] items-center gap-3 rounded-md px-3 text-sm leading-5'

interface HistoryResultListProps {
  mode: HistoryPageV2Mode
  topics: readonly Topic[]
  sessions: readonly AgentSessionEntity[]
  assistantById: ReadonlyMap<string, Assistant>
  agentById: ReadonlyMap<string, AgentEntity>
  defaultAssistantLabel: string
  unknownAgentLabel: string
  isLoading?: boolean
  onTopicSelect?: (topic: Topic) => void
  onSessionSelect?: (sessionId: string) => void
}

const HistoryResultList = ({
  mode,
  topics,
  sessions,
  assistantById,
  agentById,
  defaultAssistantLabel,
  unknownAgentLabel,
  isLoading = false,
  onTopicSelect,
  onSessionSelect
}: HistoryResultListProps) => {
  const { t } = useTranslation()
  const topicList = useMemo(() => Array.from(topics), [topics])
  const sessionList = useMemo(() => Array.from(sessions), [sessions])
  const itemCount = mode === 'assistant' ? topicList.length : sessionList.length
  const emptyTitle = isLoading
    ? mode === 'assistant'
      ? t('history.v2.loading.title', '正在加载话题')
      : t('history.v2.loading.sessionsTitle', '正在加载会话')
    : mode === 'assistant'
      ? t('history.v2.empty.title', '暂无话题')
      : t('history.v2.empty.sessionsTitle', '暂无会话')
  const emptyDescription = isLoading
    ? mode === 'assistant'
      ? t('history.v2.loading.description', '正在读取话题列表。')
      : t('history.v2.loading.sessionsDescription', '正在读取会话列表。')
    : mode === 'assistant'
      ? t('history.v2.empty.description', '当前筛选下没有可展示的话题。')
      : t('history.v2.empty.sessionsDescription', '当前筛选下没有可展示的会话。')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <HistoryListHeader
        titleLabel={mode === 'assistant' ? t('history.v2.table.title', '标题') : t('history.v2.table.session', '会话')}
        sourceLabel={mode === 'assistant' ? t('common.assistant', '助手') : t('common.agent', '智能体')}
        metadataLabel={t('history.v2.table.messages', '消息')}
        timeLabel={t('history.v2.table.time', '时间')}
      />

      {itemCount > 0 && mode === 'assistant' ? (
        <DynamicVirtualList
          list={topicList}
          estimateSize={() => 44}
          overscan={6}
          className="min-h-0 flex-1 bg-background"
          scrollerStyle={{ overflowX: 'hidden', padding: '4px 12px' }}>
          {(topic) => {
            const assistant = topic.assistantId ? assistantById.get(topic.assistantId) : undefined
            const sourceName = topic.assistantId
              ? (assistant?.name ?? t('history.v2.sidebar.unknownAssistant', '未知助手'))
              : defaultAssistantLabel

            return (
              <HistoryTopicRow
                topic={topic}
                assistant={assistant}
                sourceName={sourceName}
                emptyValue={t('history.v2.table.emptyValue', '—')}
                fallbackTitle={t('chat.default.topic.name', '新话题')}
                timeLabel={formatHistoryTime(topic.updatedAt, t)}
                onPress={onTopicSelect}
              />
            )
          }}
        </DynamicVirtualList>
      ) : itemCount > 0 ? (
        <DynamicVirtualList
          list={sessionList}
          estimateSize={() => 52}
          overscan={6}
          className="min-h-0 flex-1 bg-background"
          scrollerStyle={{ overflowX: 'hidden', padding: '4px 12px' }}>
          {(session) => {
            const agent = session.agentId ? agentById.get(session.agentId) : undefined
            const sourceName = agent?.name ?? unknownAgentLabel

            return (
              <HistorySessionRow
                session={session}
                agent={agent}
                sourceName={sourceName}
                emptyValue={t('history.v2.table.emptyValue', '—')}
                fallbackTitle={t('common.unnamed', '未命名')}
                timeLabel={formatHistoryTime(session.updatedAt, t)}
                onPress={onSessionSelect}
              />
            )
          }}
        </DynamicVirtualList>
      ) : (
        <div className="flex min-h-[320px] flex-1 items-center justify-center px-5 py-8">
          <EmptyState compact icon={MessageSquareText} title={emptyTitle} description={emptyDescription} />
        </div>
      )}
    </div>
  )
}

interface HistoryListHeaderProps {
  titleLabel: string
  sourceLabel: string
  metadataLabel: string
  timeLabel: string
}

const HistoryListHeader = ({ titleLabel, sourceLabel, metadataLabel, timeLabel }: HistoryListHeaderProps) => (
  <div className="shrink-0 overflow-hidden bg-background [border-bottom:0.5px_solid_var(--color-border-subtle)]">
    <div className={HISTORY_HEADER_GRID_CLASS}>
      <div>{titleLabel}</div>
      <div>{sourceLabel}</div>
      <div>{metadataLabel}</div>
      <div>{timeLabel}</div>
    </div>
  </div>
)

interface HistoryTopicRowProps {
  topic: Topic
  assistant?: Assistant
  sourceName: string
  emptyValue: string
  fallbackTitle: string
  timeLabel: string
  onPress?: (topic: Topic) => void
}

const HistoryTopicRow = ({
  topic,
  assistant,
  sourceName,
  emptyValue,
  fallbackTitle,
  timeLabel,
  onPress
}: HistoryTopicRowProps) => {
  return (
    <button
      type="button"
      className={cn(
        HISTORY_ROW_GRID_CLASS,
        'min-h-11 text-left',
        'bg-background text-foreground-secondary transition-colors hover:bg-muted/45'
      )}
      onClick={() => onPress?.(topic)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center text-foreground-muted text-sm leading-none">
          {assistant?.emoji ? <span aria-hidden>{assistant.emoji}</span> : <Bot size={14} />}
        </span>
        <span className="min-w-0 truncate font-medium text-foreground-secondary">{topic.name || fallbackTitle}</span>
      </div>
      <div className="truncate text-foreground-secondary text-xs">{sourceName}</div>
      <div className="text-foreground-muted text-xs">{emptyValue}</div>
      <div className="text-foreground-muted text-xs tabular-nums">{timeLabel}</div>
    </button>
  )
}

interface HistorySessionRowProps {
  session: AgentSessionEntity
  agent?: AgentEntity
  sourceName: string
  emptyValue: string
  fallbackTitle: string
  timeLabel: string
  onPress?: (sessionId: string) => void
}

const HistorySessionRow = ({
  session,
  agent,
  sourceName,
  emptyValue,
  fallbackTitle,
  timeLabel,
  onPress
}: HistorySessionRowProps) => {
  const avatar = agent?.configuration?.avatar?.trim()

  return (
    <button
      type="button"
      className={cn(
        HISTORY_ROW_GRID_CLASS,
        'min-h-13 text-left',
        'bg-background text-foreground-secondary transition-colors hover:bg-muted/45'
      )}
      onClick={() => onPress?.(session.id)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center text-foreground-muted text-sm leading-none">
          {avatar ? <span aria-hidden>{avatar}</span> : <Wrench size={14} />}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-foreground-secondary">{session.name || fallbackTitle}</span>
          {session.description && (
            <span className="mt-0.5 block truncate text-foreground-muted text-xs leading-4">{session.description}</span>
          )}
        </span>
      </div>
      <div className="truncate text-foreground-secondary text-xs">{sourceName}</div>
      <div className="text-foreground-muted text-xs">{emptyValue}</div>
      <div className="text-foreground-muted text-xs tabular-nums">{timeLabel}</div>
    </button>
  )
}

function formatHistoryTime(value: string, t: ReturnType<typeof useTranslation>['t']) {
  const date = dayjs(value)
  const now = dayjs()

  if (!date.isValid()) return t('history.v2.table.emptyValue', '—')
  if (date.isSame(now, 'day')) return date.format('HH:mm')
  if (date.isSame(now.subtract(1, 'day'), 'day')) return t('common.yesterday', '昨天')
  if (date.isSame(now, 'year')) return date.format('MM/DD')

  return date.format('YYYY/MM/DD')
}

export default HistoryResultList
