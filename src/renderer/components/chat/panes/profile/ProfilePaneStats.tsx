import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import { formatCompactNumber } from '@renderer/utils/number'
import { formatRelativeTime } from '@renderer/utils/time'
import type { AssistantRecentTopic } from '@shared/data/api/schemas/assistants'

import { ProfilePaneFrame } from './ProfilePaneFrame'
import { ProfilePaneSection, ProfilePaneSectionAction } from './ProfilePaneParts'

/** The three usage tiles at the top of the Activity tab. */
export function ProfileStatTiles({ stats }: { stats: readonly { label: string; value: number }[] }) {
  return (
    <dl className="grid grid-cols-3 gap-1.5">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex flex-col-reverse items-center gap-0.5 rounded-xl border border-border-subtle py-2.5">
          <dt className="text-[11px] text-muted-foreground">{stat.label}</dt>
          <dd className="font-semibold text-base text-foreground tabular-nums leading-tight">
            {formatCompactNumber(stat.value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function RecentTopicsSection({
  topics,
  activeTopicId,
  onOpenTopic,
  onShowAll
}: {
  topics: readonly AssistantRecentTopic[]
  activeTopicId?: string
  onOpenTopic?: (topicId: string) => void
  onShowAll?: () => void
}) {
  const { t } = useTranslation()
  if (!topics.length) return null

  return (
    <ProfilePaneSection
      title={t('chat.profile_pane.recent_topics.title')}
      action={
        onShowAll ? <ProfilePaneSectionAction onClick={onShowAll}>{t('common.all')}</ProfilePaneSectionAction> : null
      }>
      {topics.map((topic) => (
        <TopicRow
          key={topic.id}
          topic={topic}
          current={topic.id === activeTopicId}
          onOpen={onOpenTopic && (() => onOpenTopic(topic.id))}
        />
      ))}
    </ProfilePaneSection>
  )
}

/** Every topic of one Assistant, most recently active first, on its own page inside the pane. */
export function AssistantTopicsPage({
  assistantId,
  activeTopicId,
  onOpenTopic,
  onBack
}: {
  assistantId: string
  activeTopicId?: string
  onOpenTopic?: (topicId: string) => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const { topics, isLoadingAll } = useAssistantTopicsSource()
  const own = topics
    .filter((topic) => topic.assistantId === assistantId)
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))

  return (
    <ProfilePaneFrame title={t('chat.profile_pane.all_topics.title')} onBack={onBack}>
      {own.length ? (
        <div className="rounded-xl border border-border-subtle px-3 py-1">
          {own.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              current={topic.id === activeTopicId}
              onOpen={onOpenTopic && (() => onOpenTopic(topic.id))}
            />
          ))}
        </div>
      ) : (
        <p role="status" className="px-1 text-muted-foreground text-xs">
          {isLoadingAll ? t('common.loading') : t('chat.topics.empty.title')}
        </p>
      )}
    </ProfilePaneFrame>
  )
}

function TopicRow({
  topic,
  current,
  onOpen
}: {
  topic: { name: string; lastActivityAt: string; messageCount?: number }
  current: boolean
  onOpen?: () => void
}) {
  const { t, i18n } = useTranslation()
  return (
    <button
      type="button"
      disabled={!onOpen}
      onClick={onOpen}
      className="flex min-h-12 w-full items-center gap-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground text-sm">{topic.name || t('chat.default.topic.name')}</span>
        <span className="block truncate text-muted-foreground text-xs">
          {formatRelativeTime(topic.lastActivityAt, i18n.language)}
          {topic.messageCount === undefined
            ? null
            : ` · ${t('chat.profile_pane.recent_topics.messages', { count: topic.messageCount })}`}
        </span>
      </span>
      {current ? (
        <span
          className="size-1.5 shrink-0 rounded-full bg-success"
          title={t('chat.profile_pane.recent_topics.current')}
        />
      ) : null}
    </button>
  )
}
