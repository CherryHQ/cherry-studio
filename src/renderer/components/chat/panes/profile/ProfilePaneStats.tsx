import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatCompactNumber } from '@renderer/utils/number'
import { formatRelativeTime } from '@renderer/utils/time'
import type { AssistantRecentTopic } from '@shared/data/api/schemas/assistants'

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
  const { t, i18n } = useTranslation()
  if (!topics.length) return null

  return (
    <ProfilePaneSection
      title={t('chat.profile_pane.recent_topics.title')}
      action={
        onShowAll ? <ProfilePaneSectionAction onClick={onShowAll}>{t('common.all')}</ProfilePaneSectionAction> : null
      }>
      {topics.map((topic) => (
        <button
          key={topic.id}
          type="button"
          disabled={!onOpenTopic}
          onClick={() => onOpenTopic?.(topic.id)}
          className="flex min-h-12 w-full items-center gap-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-foreground text-sm">{topic.name || t('chat.default.topic.name')}</span>
            <span className="block truncate text-muted-foreground text-xs">
              {formatRelativeTime(topic.lastActivityAt, i18n.language)} ·{' '}
              {t('chat.profile_pane.recent_topics.messages', { count: topic.messageCount })}
            </span>
          </span>
          {topic.id === activeTopicId ? (
            <span
              className="size-1.5 shrink-0 rounded-full bg-success"
              title={t('chat.profile_pane.recent_topics.current')}
            />
          ) : null}
        </button>
      ))}
    </ProfilePaneSection>
  )
}
