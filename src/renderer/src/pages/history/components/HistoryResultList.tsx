import { EmptyState } from '@cherrystudio/ui'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import { ResourceList } from '@renderer/components/chat/resources'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import type { HistoryRecordsMode } from '@renderer/pages/history/HistoryRecordsPage'
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
const HISTORY_CONTEXT_MENU_CLASS = 'z-[1001]'
const HISTORY_CONFIRM_DIALOG_OVERLAY_CLASS = 'z-[1001]'
const HISTORY_CONFIRM_DIALOG_CONTENT_CLASS = 'z-[1002]'
const TopicHistoryResourceProvider = ResourceList.Provider<Topic>
const SessionHistoryResourceProvider = ResourceList.Provider<AgentSessionEntity>

type HistoryRowMenuPreset<T> = {
  getActions: (item: T) => readonly ResolvedAction[]
  onAction: (item: T, action: ResolvedAction) => void | Promise<void>
}

interface HistoryResultListProps {
  mode: HistoryRecordsMode
  topics: readonly Topic[]
  sessions: readonly AgentSessionEntity[]
  assistantById: ReadonlyMap<string, Assistant>
  agentById: ReadonlyMap<string, AgentEntity>
  defaultAssistantLabel: string
  unknownAgentLabel: string
  isLoading?: boolean
  topicMenuPreset?: HistoryRowMenuPreset<Topic>
  sessionMenuPreset?: HistoryRowMenuPreset<AgentSessionEntity>
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
  topicMenuPreset,
  sessionMenuPreset,
  onTopicSelect,
  onSessionSelect
}: HistoryResultListProps) => {
  const { t } = useTranslation()
  const topicList = useMemo(() => Array.from(topics), [topics])
  const sessionList = useMemo(() => Array.from(sessions), [sessions])
  const itemCount = mode === 'assistant' ? topicList.length : sessionList.length
  const emptyTitle = isLoading
    ? mode === 'assistant'
      ? t('history.records.loading.title', '正在加载话题')
      : t('history.records.loading.sessionsTitle', '正在加载会话')
    : mode === 'assistant'
      ? t('history.records.empty.title', '暂无话题')
      : t('history.records.empty.sessionsTitle', '暂无会话')
  const emptyDescription = isLoading
    ? mode === 'assistant'
      ? t('history.records.loading.description', '正在读取话题列表。')
      : t('history.records.loading.sessionsDescription', '正在读取会话列表。')
    : mode === 'assistant'
      ? t('history.records.empty.description', '当前筛选下没有可展示的话题。')
      : t('history.records.empty.sessionsDescription', '当前筛选下没有可展示的会话。')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-gutter:stable] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:h-1.5">
        <div className="flex min-h-0 min-w-[760px] flex-1 flex-col">
          <HistoryListHeader
            titleLabel={
              mode === 'assistant'
                ? t('history.records.table.title', '标题')
                : t('history.records.table.session', '会话')
            }
            sourceLabel={mode === 'assistant' ? t('common.assistant', '助手') : t('common.agent', '智能体')}
            metadataLabel={t('history.records.table.messages', '消息')}
            timeLabel={t('history.records.table.time', '时间')}
          />

          {itemCount > 0 && mode === 'assistant' ? (
            <TopicHistoryResourceProvider items={topicList} variant="history">
              <DynamicVirtualList
                list={topicList}
                estimateSize={() => 44}
                overscan={6}
                className="min-h-0 flex-1 bg-background"
                scrollerStyle={{ overflowX: 'hidden', padding: '4px 12px' }}>
                {(topic) => {
                  const assistant = topic.assistantId ? assistantById.get(topic.assistantId) : undefined
                  const sourceName = topic.assistantId
                    ? (assistant?.name ?? t('history.records.sidebar.unknownAssistant', '未知助手'))
                    : defaultAssistantLabel

                  return (
                    <HistoryTopicRow
                      topic={topic}
                      assistant={assistant}
                      sourceName={sourceName}
                      emptyValue={t('history.records.table.emptyValue', '—')}
                      fallbackTitle={t('chat.default.topic.name', '新话题')}
                      timeLabel={formatHistoryTime(topic.updatedAt, t)}
                      menuPreset={topicMenuPreset}
                      onPress={onTopicSelect}
                    />
                  )
                }}
              </DynamicVirtualList>
            </TopicHistoryResourceProvider>
          ) : itemCount > 0 ? (
            <SessionHistoryResourceProvider items={sessionList} variant="history">
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
                      emptyValue={t('history.records.table.emptyValue', '—')}
                      fallbackTitle={t('common.unnamed', '未命名')}
                      timeLabel={formatHistoryTime(session.updatedAt, t)}
                      menuPreset={sessionMenuPreset}
                      onPress={onSessionSelect}
                    />
                  )
                }}
              </DynamicVirtualList>
            </SessionHistoryResourceProvider>
          ) : (
            <div className="flex min-h-[320px] flex-1 items-center justify-center px-5 py-8">
              <EmptyState compact icon={MessageSquareText} title={emptyTitle} description={emptyDescription} />
            </div>
          )}
        </div>
      </div>
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
  menuPreset?: HistoryRowMenuPreset<Topic>
  onPress?: (topic: Topic) => void
}

const HistoryTopicRow = ({
  topic,
  assistant,
  sourceName,
  emptyValue,
  fallbackTitle,
  timeLabel,
  menuPreset,
  onPress
}: HistoryTopicRowProps) => {
  const menuActions = menuPreset?.getActions(topic)
  const row = (
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

  if (!menuPreset || !menuActions) return row

  return (
    <ResourceList.ContextMenu
      item={topic}
      actions={menuActions}
      menuClassName={HISTORY_CONTEXT_MENU_CLASS}
      confirmDialogOverlayClassName={HISTORY_CONFIRM_DIALOG_OVERLAY_CLASS}
      confirmDialogContentClassName={HISTORY_CONFIRM_DIALOG_CONTENT_CLASS}
      onAction={(action) => menuPreset.onAction(topic, action)}>
      {row}
    </ResourceList.ContextMenu>
  )
}

interface HistorySessionRowProps {
  session: AgentSessionEntity
  agent?: AgentEntity
  sourceName: string
  emptyValue: string
  fallbackTitle: string
  timeLabel: string
  menuPreset?: HistoryRowMenuPreset<AgentSessionEntity>
  onPress?: (sessionId: string) => void
}

const HistorySessionRow = ({
  session,
  agent,
  sourceName,
  emptyValue,
  fallbackTitle,
  timeLabel,
  menuPreset,
  onPress
}: HistorySessionRowProps) => {
  const avatar = agent?.configuration?.avatar?.trim()
  const menuActions = menuPreset?.getActions(session)

  const row = (
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

  if (!menuPreset || !menuActions) return row

  return (
    <ResourceList.ContextMenu
      item={session}
      actions={menuActions}
      menuClassName={HISTORY_CONTEXT_MENU_CLASS}
      confirmDialogOverlayClassName={HISTORY_CONFIRM_DIALOG_OVERLAY_CLASS}
      confirmDialogContentClassName={HISTORY_CONFIRM_DIALOG_CONTENT_CLASS}
      onAction={(action) => menuPreset.onAction(session, action)}>
      {row}
    </ResourceList.ContextMenu>
  )
}

function formatHistoryTime(value: string, t: ReturnType<typeof useTranslation>['t']) {
  const date = dayjs(value)
  const now = dayjs()

  if (!date.isValid()) return t('history.records.table.emptyValue', '—')
  if (date.isSame(now, 'day')) return date.format('HH:mm')
  if (date.isSame(now.subtract(1, 'day'), 'day')) return t('common.yesterday', '昨天')
  if (date.isSame(now, 'year')) return date.format('MM/DD')

  return date.format('YYYY/MM/DD')
}

export default HistoryResultList
