import type { AgentSessionDisplayMode, TopicSessionSortBy } from '@shared/data/preference/preferenceTypes'
import { Bot, Clock, Folder, History } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ConversationListOptionsMenu, TOPIC_SESSION_SORT_OPTIONS } from './ConversationListOptionsMenu'

const SESSION_DISPLAY_OPTIONS: AgentSessionDisplayMode[] = ['time', 'workdir', 'agent']
export const SESSION_DISPLAY_LABEL_KEYS: Record<AgentSessionDisplayMode, string> = {
  agent: 'agent.session.display.agent',
  time: 'agent.session.display.time',
  workdir: 'agent.session.display.workdir'
}
const SESSION_DISPLAY_ICONS: Record<AgentSessionDisplayMode, ReactNode> = {
  agent: <Bot size={16} />,
  time: <Clock size={16} />,
  workdir: <Folder size={16} />
}
type SessionListOptionsMenuProps = {
  historyRecordsActive?: boolean
  manageAgentsActive?: boolean
  mode: AgentSessionDisplayMode
  onChange: (mode: AgentSessionDisplayMode) => void
  onManageAgents?: () => void | Promise<void>
  onOpenHistoryRecords?: () => void
  onSortByChange: (sortBy: TopicSessionSortBy) => void
  sectionIds?: readonly string[]
  sortBy: TopicSessionSortBy
}

export function SessionListOptionsMenu({
  historyRecordsActive,
  manageAgentsActive,
  mode,
  onChange,
  onManageAgents,
  onOpenHistoryRecords,
  onSortByChange,
  sectionIds,
  sortBy
}: SessionListOptionsMenuProps) {
  const { t } = useTranslation()

  return (
    <ConversationListOptionsMenu
      title={t('agent.session.display.title')}
      mode={mode}
      onChange={onChange}
      options={SESSION_DISPLAY_OPTIONS.map((option) => ({
        icon: SESSION_DISPLAY_ICONS[option],
        label: t(SESSION_DISPLAY_LABEL_KEYS[option]),
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
              collapseLabel: t('agent.session.group.collapse_all'),
              expandLabel: t('agent.session.group.expand_all'),
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
        onManageAgents
          ? {
              active: manageAgentsActive,
              icon: <Bot size={16} />,
              label: t('agent.manage.title'),
              onSelect: onManageAgents
            }
          : undefined
      }
    />
  )
}
