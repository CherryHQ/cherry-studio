import { EmptyState } from '@cherrystudio/ui'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import type { HistoryPageV2Mode } from '@renderer/pages/history/HistoryPageV2'
import { cn } from '@renderer/utils'
import type { Assistant } from '@shared/data/types/assistant'
import type { Topic } from '@shared/data/types/topic'
import dayjs from 'dayjs'
import { Bot, MessageSquareText } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface HistoryResultListProps {
  mode: HistoryPageV2Mode
  topics: readonly Topic[]
  assistantById: ReadonlyMap<string, Assistant>
  defaultAssistantLabel: string
  isLoading?: boolean
}

const HistoryResultList = ({
  mode,
  topics,
  assistantById,
  defaultAssistantLabel,
  isLoading = false
}: HistoryResultListProps) => {
  const { t } = useTranslation()
  const topicList = useMemo(() => Array.from(topics), [topics])
  const sourceColumn = mode === 'assistant' ? t('common.assistant', '助手') : t('history.v2.table.type', '类型')
  const emptyTitle = isLoading ? t('history.v2.loading.title', '正在加载话题') : t('history.v2.empty.title', '暂无话题')
  const emptyDescription = isLoading
    ? t('history.v2.loading.description', '正在读取话题列表。')
    : t('history.v2.empty.description', '当前筛选下没有可展示的话题。')

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <HistoryListHeader
        titleLabel={t('history.v2.table.title', '标题')}
        sourceLabel={sourceColumn}
        messagesLabel={t('history.v2.table.messages', '消息')}
        timeLabel={t('history.v2.table.time', '时间')}
      />

      {topicList.length > 0 ? (
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
                timeLabel={formatTopicTime(topic.updatedAt, t)}
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
  messagesLabel: string
  timeLabel: string
}

const HistoryListHeader = ({ titleLabel, sourceLabel, messagesLabel, timeLabel }: HistoryListHeaderProps) => (
  <div className="shrink-0 overflow-hidden bg-background [border-bottom:0.5px_solid_var(--color-border-subtle)]">
    <div className="grid min-w-[760px] grid-cols-[minmax(320px,1fr)_160px_72px_92px] gap-3 px-5 py-2.5 font-medium text-foreground-muted text-xs leading-4">
      <div>{titleLabel}</div>
      <div>{sourceLabel}</div>
      <div>{messagesLabel}</div>
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
}

const HistoryTopicRow = ({
  topic,
  assistant,
  sourceName,
  emptyValue,
  fallbackTitle,
  timeLabel
}: HistoryTopicRowProps) => (
  <div
    className={cn(
      'grid min-h-11 min-w-[736px] grid-cols-[minmax(320px,1fr)_160px_72px_92px] items-center gap-3 rounded-md px-3 text-sm leading-5',
      'bg-background text-foreground-secondary transition-colors hover:bg-muted/45'
    )}>
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center text-foreground-muted text-sm leading-none">
        {assistant?.emoji ? <span aria-hidden>{assistant.emoji}</span> : <Bot size={14} />}
      </span>
      <span className="min-w-0 truncate font-medium text-foreground-secondary">{topic.name || fallbackTitle}</span>
    </div>
    <div className="truncate text-foreground-secondary text-xs">{sourceName}</div>
    <div className="text-foreground-muted text-xs">{emptyValue}</div>
    <div className="text-foreground-muted text-xs tabular-nums">{timeLabel}</div>
  </div>
)

function formatTopicTime(value: string, t: ReturnType<typeof useTranslation>['t']) {
  const date = dayjs(value)
  const now = dayjs()

  if (!date.isValid()) return t('history.v2.table.emptyValue', '—')
  if (date.isSame(now, 'day')) return date.format('HH:mm')
  if (date.isSame(now.subtract(1, 'day'), 'day')) return t('common.yesterday', '昨天')
  if (date.isSame(now, 'year')) return date.format('MM/DD')

  return date.format('YYYY/MM/DD')
}

export default HistoryResultList
