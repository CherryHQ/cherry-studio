import type { TopicDisplayMode, TopicSessionSortBy } from '@shared/data/preference/preferenceTypes'
import { Bot, Clock, History } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ConversationListOptionsMenu, TOPIC_SESSION_SORT_OPTIONS } from './ConversationListOptionsMenu'

const TOPIC_DISPLAY_OPTIONS: TopicDisplayMode[] = ['time', 'assistant']
const TOPIC_DISPLAY_LABEL_KEYS: Record<TopicDisplayMode, string> = {
  assistant: 'chat.topics.display.assistant',
  time: 'chat.topics.display.time'
}
const TOPIC_DISPLAY_ICONS: Record<TopicDisplayMode, ReactNode> = {
  assistant: <Bot size={16} />,
  time: <Clock size={16} />
}
type TopicListOptionsMenuProps = {
  historyRecordsActive?: boolean
  manageAssistantsActive?: boolean
  mode: TopicDisplayMode
  onChange: (mode: TopicDisplayMode) => void
  onManageAssistants?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSortByChange: (sortBy: TopicSessionSortBy) => void
  sectionIds?: readonly string[]
  sortBy: TopicSessionSortBy
}

export function TopicListOptionsMenu({
  historyRecordsActive,
  manageAssistantsActive,
  mode,
  onChange,
  onManageAssistants,
  onOpenHistoryRecords,
  onSortByChange,
  sectionIds,
  sortBy
}: TopicListOptionsMenuProps) {
  const { t } = useTranslation()

  return (
    <ConversationListOptionsMenu
      title={t('chat.topics.display.title')}
      mode={mode}
      onChange={onChange}
      options={TOPIC_DISPLAY_OPTIONS.map((option) => ({
        icon: TOPIC_DISPLAY_ICONS[option],
        label: t(TOPIC_DISPLAY_LABEL_KEYS[option]),
        value: option
      }))}
      sort={{
        onChange: onSortByChange,
        options: TOPIC_SESSION_SORT_OPTIONS.map((option) => ({
          icon: option.icon,
          label: t(option.labelKey),
          value: option.value
        })),
        title: t('common.sort.title'),
        value: sortBy
      }}
      sectionToggle={
        sectionIds
          ? {
              collapseLabel: t('chat.topics.group.collapse_all'),
              expandLabel: t('chat.topics.group.expand_all'),
              ids: sectionIds
            }
          : undefined
      }
      historyAction={
        onOpenHistoryRecords
          ? {
              active: historyRecordsActive,
              icon: <History size={16} />,
              label: t('history.records.shortTitle'),
              onSelect: onOpenHistoryRecords
            }
          : undefined
      }
      manageAction={
        onManageAssistants
          ? {
              active: manageAssistantsActive,
              icon: <Bot size={16} />,
              label: t('assistants.presets.manage.title'),
              onSelect: onManageAssistants
            }
          : undefined
      }
    />
  )
}
