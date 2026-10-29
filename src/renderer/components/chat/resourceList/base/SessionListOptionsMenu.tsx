import { Bot, Clock, Folder, History, ListTodo } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { AgentSessionDisplayMode } from '@shared/data/preference/preferenceTypes'

import { ConversationListOptionsMenu } from './ConversationListOptionsMenu'

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
  sectionIds?: readonly string[]
}

export function SessionListOptionsMenu({
  historyRecordsActive,
  manageAgentsActive,
  mode,
  onChange,
  onManageAgents,
  onOpenHistoryRecords,
  sectionIds
}: SessionListOptionsMenuProps) {
  const { t } = useTranslation()
  const [showTaskDashboard, setShowTaskDashboard] = usePreference('agent.task_dashboard.visible')
  const [showRestoreHint, setShowRestoreHint] = useState(false)

  useEffect(() => EventEmitter.on(EVENT_NAMES.TASK_DASHBOARD_HIDDEN, () => setShowRestoreHint(true)), [])
  useEffect(() => {
    if (!showRestoreHint) return
    const timer = window.setTimeout(() => setShowRestoreHint(false), 8000)
    return () => window.clearTimeout(timer)
  }, [showRestoreHint])

  return (
    <ConversationListOptionsMenu
      title={t('agent.session.display.title')}
      triggerHint={{
        content: t('agent.task_dashboard.restore_hint', {
          menu: t('agent.session.display.title'),
          panel: t('agent.task_dashboard.title')
        }),
        open: showRestoreHint,
        onDismiss: () => setShowRestoreHint(false)
      }}
      mode={mode}
      onChange={onChange}
      options={SESSION_DISPLAY_OPTIONS.map((option) => ({
        icon: SESSION_DISPLAY_ICONS[option],
        label: t(SESSION_DISPLAY_LABEL_KEYS[option]),
        value: option
      }))}
      visibilityAction={{
        active: showTaskDashboard,
        icon: <ListTodo size={16} />,
        label: t('agent.task_dashboard.title'),
        onSelect: async () => {
          await setShowTaskDashboard(!showTaskDashboard)
          setShowRestoreHint(showTaskDashboard)
        }
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
